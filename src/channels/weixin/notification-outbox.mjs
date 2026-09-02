import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

class InvalidNotification extends Error {}

export class NotificationOutbox {
  #dir;
  #send;
  #logger;
  #pollIntervalMs;
  #mediaDir;
  #timer = null;
  #running = null;

  constructor({ dir, send, logger = console, pollIntervalMs = 5_000, mediaDir }) {
    if (!dir) throw new TypeError('notification outbox dir is required');
    if (typeof send !== 'function') throw new TypeError('notification send function is required');
    this.#dir = resolve(dir);
    this.#send = send;
    this.#logger = logger;
    this.#pollIntervalMs = pollIntervalMs;
    this.#mediaDir = resolve(mediaDir ?? join(this.#dir, '..', 'dsh_media'));
  }

  async start() {
    await Promise.all(['processing', 'sent', 'failed'].map((name) => mkdir(join(this.#dir, name), { recursive: true })));
    for (const name of await readdir(join(this.#dir, 'processing'))) {
      if (!name.endsWith('.json')) continue;
      try {
        await rename(join(this.#dir, 'processing', name), join(this.#dir, name));
      } catch (error) {
        if (error?.code !== 'ENOENT') this.#logger.warn?.(`[dsh-weixin] could not recover ${name}:`, error);
      }
    }
    await this.scan();
    this.#timer = setInterval(() => void this.scan(), this.#pollIntervalMs);
    this.#timer.unref?.();
    return this;
  }

  scan() {
    if (this.#running) return this.#running;
    this.#running = this.#scan().finally(() => { this.#running = null; });
    return this.#running;
  }

  async close() {
    clearInterval(this.#timer);
    this.#timer = null;
    await this.#running;
  }

  async #scan() {
    const entries = await readdir(this.#dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) await this.#process(entry.name);
    }
  }

  async #process(name) {
    const pending = join(this.#dir, name);
    const processing = join(this.#dir, 'processing', name);
    try {
      await rename(pending, processing);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    try {
      const event = JSON.parse(await readFile(processing, 'utf8'));
      this.#validate(event);
      const media = await this.#validatedMedia(event.media);
      // send 第三参透传 event（只读，供 wiring 按通知类型审计/路由；向后兼容）
      const delivery = await this.#send(event.text, media, event);
      if (delivery?.mode === 'image' || delivery?.mode === 'text' || delivery?.mode === 'text-fallback') {
        event.delivery = {
          mode: delivery.mode,
          delivered_at: new Date().toISOString(),
          ...(delivery.provider ? { provider: delivery.provider } : {}),
        };
        await writeFile(processing, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
      }
      await rename(processing, join(this.#dir, 'sent', name));
    } catch (error) {
      if (error instanceof InvalidNotification || error instanceof SyntaxError) {
        await rename(processing, join(this.#dir, 'failed', name));
        this.#logger.warn?.(`[dsh-weixin] rejected notification ${name}: ${error.message}`);
        return;
      }
      // ponytail: 文件投递为至少一次；若进程恰在平台接收后退出，可能重复一条。
      await rename(processing, pending);
      this.#logger.warn?.(`[dsh-weixin] notification ${name} will retry:`, error);
    }
  }

  #validate(event) {
    if (!event || event.schema_version !== 1) throw new InvalidNotification('unsupported schema_version');
    // type 仅要求非空且为点分/连字符风格的事件名；具体取值由生产方自行定义，
    // 消费方不消费该字段，这里只做防垃圾校验，不做业务白名单。
    if (typeof event.type !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(event.type)) {
      throw new InvalidNotification('invalid event type');
    }
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(event.event_id ?? '')) throw new InvalidNotification('invalid event_id');
    if (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 12_000) {
      throw new InvalidNotification('invalid text');
    }
  }

  async #validatedMedia(media) {
    if (media === undefined) return undefined;
    if (media?.type !== 'image' || typeof media.path !== 'string' || !isAbsolute(media.path)) {
      throw new InvalidNotification('invalid media');
    }
    if (!['.png', '.jpg', '.jpeg'].includes(extname(media.path).toLowerCase())) {
      throw new InvalidNotification('unsupported media type');
    }
    try {
      const [root, file] = await Promise.all([realpath(this.#mediaDir), realpath(media.path)]);
      const rel = relative(root, file);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new InvalidNotification('media path is outside notification media directory');
      }
      const info = await stat(file);
      if (!info.isFile() || info.size === 0 || info.size > 10 * 1024 * 1024) {
        throw new InvalidNotification('invalid media file');
      }
      return { type: 'image', path: file };
    } catch (error) {
      if (error instanceof InvalidNotification) throw error;
      throw new InvalidNotification('media file is unavailable');
    }
  }
}
