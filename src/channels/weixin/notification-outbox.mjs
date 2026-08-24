import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

class InvalidNotification extends Error {}

export class NotificationOutbox {
  #dir;
  #send;
  #logger;
  #pollIntervalMs;
  #timer = null;
  #running = null;

  constructor({ dir, send, logger = console, pollIntervalMs = 5_000 }) {
    if (!dir) throw new TypeError('notification outbox dir is required');
    if (typeof send !== 'function') throw new TypeError('notification send function is required');
    this.#dir = resolve(dir);
    this.#send = send;
    this.#logger = logger;
    this.#pollIntervalMs = pollIntervalMs;
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
      await this.#send(event.text);
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
    if (event.type !== 'recruiting.score_ready') throw new InvalidNotification('unsupported event type');
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(event.event_id ?? '')) throw new InvalidNotification('invalid event_id');
    if (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 12_000) {
      throw new InvalidNotification('invalid text');
    }
  }
}
