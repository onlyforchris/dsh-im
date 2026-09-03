import { WSAuthFailureError, WSClient, WSReconnectExhaustedError } from '@wecom/aibot-node-sdk';

import { createWecomBridgeStatus, WecomHarnessBridge, sendWecomImage } from './wecom-bridge.mjs';
import {
  connectionTestTarget,
  connectionTestTargetUnavailable,
  sendRememberedConnectionTest,
} from '../shared/connection-test.mjs';
import { t } from '../shared/i18n.mjs';

// 通知图片上传超时；独立于回复链路的 replyTimeoutMs。
const NOTIFICATION_FILE_UPLOAD_TIMEOUT_MS = 30_000;

function timeoutError() {
  const error = new Error('Enterprise WeChat WebSocket authentication timed out');
  error.code = 'connect-timeout';
  return error;
}

export function createWecomRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    wecomConnectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...createWecomBridgeStatus(),
  };
}

export class WecomRuntime {
  #config;
  #secret;
  #harness;
  #state;
  #contextEnhancement;
  #accessPolicy;
  #logger;
  #replyTimeoutMs;
  #connectTimeoutMs;
  #maxReconnectAttempts;
  #createClient;
  #sourceChannelLabel;
  #status = createWecomRuntimeStatus();
  #client = null;
  #bridge = null;
  #starting = null;
  #startController = null;
  #runtimeController = null;

  constructor({
    config,
    secret,
    sourceChannelLabel,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    logger = console,
    replyTimeoutMs = 600_000,
    connectTimeoutMs = 20_000,
    maxReconnectAttempts = 10,
    createClient = (options) => new WSClient(options),
  }) {
    if (!config || !secret || !harness || !state) {
      throw new TypeError('WecomRuntime requires config, secret, Harness, and state');
    }
    this.#config = config;
    this.#secret = secret;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#maxReconnectAttempts = maxReconnectAttempts;
    this.#createClient = createClient;
    this.#sourceChannelLabel = sourceChannelLabel;
  }

  get status() {
    return structuredClone(this.#status);
  }

  async start() {
    if (this.#status.ready && this.#client) return this.status;
    if (this.#starting) return this.#starting;
    this.#runtimeController?.abort(new DOMException('Enterprise WeChat runtime replaced', 'AbortError'));
    const controller = new AbortController();
    this.#startController = controller;
    this.#runtimeController = controller;
    this.#starting = this.#start(controller.signal).finally(() => {
      if (this.#startController === controller) this.#startController = null;
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start(signal) {
    await this.#stopActive();
    signal.throwIfAborted();
    this.#status.startedAt = new Date().toISOString();
    this.#status.wecomConnectionState = 'connecting';
    this.#status.lastError = null;
    await this.#harness.ensureRunning();
    this.#status.harnessReachable = true;

    const silentSdkLogger = { debug() {}, info() {}, warn() {}, error() {} };
    const client = this.#createClient({
      botId: this.#config.remoteBotId,
      secret: this.#secret,
      logger: silentSdkLogger,
      maxReconnectAttempts: this.#maxReconnectAttempts,
    });
    if (!client || typeof client.connect !== 'function' || typeof client.disconnect !== 'function') {
      throw new TypeError('Enterprise WeChat client factory returned an invalid client');
    }
    this.#client = client;
    this.#bridge = new WecomHarnessBridge({
      client,
      harness: this.#harness,
      state: this.#state,
      contextEnhancement: this.#contextEnhancement,
      accessPolicy: this.#accessPolicy,
      status: this.#status,
      logger: this.#logger,
      replyTimeoutMs: this.#replyTimeoutMs,
      sourceChannelLabel: this.#sourceChannelLabel,
      signal,
    });

    let readyResolve;
    let readyReject;
    let authenticated = false;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const onAuthenticated = () => {
      if (this.#client !== client || signal.aborted) return;
      authenticated = true;
      const now = Date.now();
      this.#status.ready = true;
      this.#status.wecomConnectionState = 'connected';
      this.#status.lastCheckedAt = now;
      this.#status.lastConnectedAt = now;
      this.#status.lastError = null;
      readyResolve();
    };
    const onDisconnected = () => {
      if (this.#client !== client) return;
      this.#status.ready = false;
      this.#status.wecomConnectionState = 'connecting';
      this.#status.lastCheckedAt = Date.now();
    };
    const onReconnecting = () => {
      if (this.#client !== client) return;
      this.#status.ready = false;
      this.#status.wecomConnectionState = 'connecting';
      this.#status.lastCheckedAt = Date.now();
    };
    const onError = (error) => {
      if (this.#client !== client) return;
      const terminal = error instanceof WSAuthFailureError || error instanceof WSReconnectExhaustedError;
      if (!authenticated && terminal) readyReject(error);
      if (terminal) {
        this.#status.ready = false;
        this.#status.wecomConnectionState = 'failed';
      }
      this.#status.lastError = terminal ? error.name : 'connection-error';
      this.#logger.warn?.(`[dsh-im:wecom] bot ${this.#config.botId} connection error`);
    };
    const onMessage = (frame) => this.#bridge?.accept(frame);
    client.on('authenticated', onAuthenticated);
    client.on('disconnected', onDisconnected);
    client.on('reconnecting', onReconnecting);
    client.on('error', onError);
    client.on('message', onMessage);

    let timer;
    try {
      client.connect();
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(timeoutError()), this.#connectTimeoutMs);
        }),
      ]);
      return this.status;
    } catch (error) {
      if (signal.aborted) {
        await this.#stopActive();
        throw error;
      }
      this.#status.ready = false;
      this.#status.wecomConnectionState = 'failed';
      this.#status.lastError = error?.message ?? String(error);
      await this.#stopActive();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async stop() {
    const starting = this.#starting;
    this.#startController?.abort(new DOMException('Enterprise WeChat runtime stopped', 'AbortError'));
    this.#runtimeController?.abort(new DOMException('Enterprise WeChat runtime stopped', 'AbortError'));
    this.#runtimeController = null;
    await this.#stopActive();
    await starting?.catch(() => undefined);
    return this.status;
  }

  async sendConnectionTest(text) {
    const result = await sendRememberedConnectionTest({
      state: this.#state,
      text,
      channelLabel: t('企业微信机器人'),
      send: async ({ chatId }, content) => {
        if (!this.#status.ready || !this.#client) {
          throw new Error('Enterprise WeChat runtime is not connected');
        }
        await this.#client.sendMessage(chatId, {
          msgtype: 'markdown',
          markdown: { content },
        });
        return { mode: 'text' };
      },
    });
    return { ...result, mode: 'text' };
  }

  /**
   * 发送主动通知（S5 outbox 消费路径，04_13 P0-B）。
   * 目标固定为已绑定机器人后记住的私聊 target（outbox 事件按契约不携带收件人）。
   * 图片不可用时退化为纯文本（text-fallback），通知事实不因表现层失败而丢失；
   * 无记住目标或连接未就绪时抛错，由 outbox 保留事件等待重试（fail-closed）。
   */
  async sendNotification(text, media) {
    const target = connectionTestTarget(this.#state);
    if (!target) throw connectionTestTargetUnavailable(t('企业微信机器人'));
    if (!this.#status.ready || !this.#client) {
      throw new Error('Enterprise WeChat runtime is not connected');
    }
    const chatId = target.chatId;
    let mode = 'text';
    if (media?.type === 'image') {
      try {
        await sendWecomImage(this.#client, chatId, media.path, {
          timeoutMs: NOTIFICATION_FILE_UPLOAD_TIMEOUT_MS,
        });
        mode = 'image';
      } catch {
        mode = 'text-fallback';
      }
    }
    await this.#client.sendMessage(chatId, {
      msgtype: 'markdown',
      markdown: { content: text },
    });
    return { sent: true, mode };
  }

  async sendProactiveText(target, text, { signal } = {}) {
    const chatId = typeof target?.route?.chatId === 'string'
      ? target.route.chatId.trim() : '';
    if ((target?.kind !== 'user' && target?.kind !== 'group') || !chatId) {
      const error = new TypeError('Invalid Enterprise WeChat proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    if (!this.#status.ready || !this.#client) {
      const error = new Error('Enterprise WeChat runtime is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    signal?.throwIfAborted();
    await this.#client.sendMessage(chatId, {
      msgtype: 'markdown',
      markdown: { content: text },
    });
    return { sent: true };
  }

  async #stopActive() {
    const client = this.#client;
    const bridge = this.#bridge;
    this.#client = null;
    this.#bridge = null;
    try {
      client?.disconnect();
      client?.removeAllListeners?.();
    } catch (error) {
      this.#logger.warn?.(`[dsh-im:wecom] bot ${this.#config.botId} failed to stop cleanly`);
    }
    await bridge?.waitForIdle();
    this.#status.ready = false;
    this.#status.wecomConnectionState = 'idle';
  }
}
