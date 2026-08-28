import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { WeixinConfigStore } from '../../../../src/channels/weixin/config-store.mjs';
import { HarnessClient } from '../../../../src/channels/weixin/harness-client.mjs';
import { WeixinStateStore } from '../../../../src/channels/weixin/state-store.mjs';
import { createWeixinApi } from '../../../../src/channels/weixin/weixin-api.mjs';
import { WeixinController } from '../../../../src/channels/weixin/weixin-controller.mjs';
import { WeixinRuntime } from '../../../../src/channels/weixin/weixin-runtime.mjs';
import { NotificationOutbox } from '../../../../src/channels/weixin/notification-outbox.mjs';
import {
  BotWorkspaceStore,
  createBotWorkspaceScope,
  createWorkspaceAwareController,
  observeBotWorkspaceRemovals,
} from '../../../../src/channels/shared/bot-workspace-store.mjs';
import { createConnectionSupervisor } from './connection-supervisor.mjs';
import { createHarnessCommandExecutor } from '../../harness-command-executor.mjs';
import { createHarnessSessionExecutors } from '../../harness-session-coordinator.mjs';

function harnessOrigin(webServer, configured) {
  if (configured !== undefined) return new URL(configured);
  const port = webServer?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh-weixin requires an initialized DSH webServer port');
  }
  return new URL(`http://127.0.0.1:${port}`);
}

function pluginPaths(config) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const root = resolve(config.dataDir ?? join(dshHome, 'integrations', 'dsh-weixin'));
  return {
    root,
    config: resolve(config.configPath ?? join(root, 'config.json')),
    accounts: resolve(config.accountsDir ?? join(root, 'accounts')),
    workspaces: resolve(config.workspacesPath ?? join(root, 'workspaces.json')),
  };
}

export async function createProductionController(ctx, config = {}, internals = {}) {
  if (!ctx?.credentials) throw new TypeError('dsh-weixin requires ctx.credentials');
  if (!ctx?.webServer) throw new TypeError('dsh-weixin requires ctx.webServer');

  const ConfigStore = internals.ConfigStore ?? WeixinConfigStore;
  const StateStore = internals.StateStore ?? WeixinStateStore;
  const Harness = internals.HarnessClient ?? HarnessClient;
  const Controller = internals.Controller ?? WeixinController;
  const Runtime = internals.Runtime ?? WeixinRuntime;
  const api = internals.api ?? createWeixinApi();
  const createSupervisor = internals.createConnectionSupervisor ?? createConnectionSupervisor;
  const logger = typeof ctx.logger === 'function'
    ? ctx.logger('dsh-weixin')
    : (ctx.logger ?? console);
  const paths = pluginPaths(config);
  const configStore = await new ConfigStore(paths.config).load();
  const defaultWorkspace = resolve(config.workspace ?? process.cwd());
  const WorkspaceStore = internals.WorkspaceStore ?? BotWorkspaceStore;
  const workspaces = internals.workspaces
    ?? await new WorkspaceStore(paths.workspaces, { defaultWorkspace }).load();
  const configuredBots = configStore.list();
  await workspaces.reconcile(configuredBots.map((bot) => bot.botId));
  await Promise.all(configuredBots.map((bot) => workspaces.ensure(bot.botId)));
  const observedConfigStore = typeof configStore.remove === 'function'
    ? observeBotWorkspaceRemovals(configStore, { workspaces })
    : configStore;
  const stateStores = new Map();

  const statePath = (botId) => resolve(paths.accounts, botId, 'state.json');
  const stateFor = async (botId) => {
    let state = stateStores.get(botId);
    if (!state) {
      state = await new StateStore(statePath(botId)).load();
      stateStores.set(botId, state);
    }
    return state;
  };
  const commandExecutor = createHarnessCommandExecutor(ctx, internals.commandExecutor);
  const { controlExecutor, sessionMaintenanceExecutor } = createHarnessSessionExecutors(ctx, {
    controlExecutor: internals.controlExecutor,
    sessionMaintenanceExecutor: internals.sessionMaintenanceExecutor,
  });
  const harness = new Harness({
    baseUrl: harnessOrigin(ctx.webServer, config.harnessBaseUrl),
    workspace: defaultWorkspace,
    ...(config.agentPreset == null ? {} : { agentPreset: config.agentPreset }),
    autostart: false,
    dshBin: config.dshBin ?? 'dsh',
    ...(commandExecutor ? { commandExecutor } : {}),
    ...(controlExecutor ? { controlExecutor } : {}),
    ...(sessionMaintenanceExecutor ? { sessionMaintenanceExecutor } : {}),
  });
  const coreController = new Controller({
    api,
    credentials: ctx.credentials,
    configStore: observedConfigStore,
    logger,
    createRuntime: async ({ botId, config: accountConfig, token }) => {
      const state = await stateFor(botId);
      await workspaces.ensure(botId);
      const workspaceScope = createBotWorkspaceScope(harness, { botId, workspaces, state });
      return new Runtime({
        api,
        config: accountConfig,
        token,
        sourceChannelLabel: '微信',
        harness: workspaceScope.harness,
        state: workspaceScope.state,
        replyTimeoutMs: config.replyTimeoutMs ?? 600_000,
        maxMessageChars: config.maxMessageChars ?? 4_000,
        workspaceSessionCommandsEnabled: config.workspaceSessionCommandsEnabled !== false,
        logger: {
          error: (...args) => logger.error?.(`[${botId}]`, ...args),
          warn: (...args) => logger.warn?.(`[${botId}]`, ...args),
          info: (...args) => logger.info?.(`[${botId}]`, ...args),
          debug: (...args) => logger.debug?.(`[${botId}]`, ...args),
        },
      });
    },
    deleteState: async ({ botId }) => {
      const state = stateStores.get(botId);
      stateStores.delete(botId);
      if (state && typeof state.remove === 'function') {
        await state.remove();
      } else {
        try {
          await unlink(statePath(botId));
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
    },
  });
  const controller = createWorkspaceAwareController(coreController, { workspaces, stateFor });
  const notificationOutbox = config.notificationOutboxDir
    ? new NotificationOutbox({
        dir: config.notificationOutboxDir,
        pollIntervalMs: config.notificationPollIntervalMs ?? 5_000,
        logger,
        send: (text, media) => {
          // 动态解析 botId，防 rebind 后配置漂移（不再依赖硬编码配置）：
          // 1. 优先配置的 botId（若仍在账号表）
          // 2. 否则回落到账号表里最近连接的账号
          // 3. 都没有则报错抛出（由 NotificationOutbox 转为 retry）
          const configuredId = config.notificationBotId;
          const bots = configStore.list();
          const fallbackBot = bots
            .slice()
            .sort((a, b) => {
              const ra = String(a?.connectedAt ?? '').localeCompare(String(b?.connectedAt ?? ''));
              return ra; // 升序 → 最后一个即 connectedAt 最新
            })
            .at(-1);
          const botId = bots.some((bot) => bot.botId === configuredId)
            ? configuredId
            : (fallbackBot?.botId ?? configuredId);
          if (!botId) throw new TypeError('dsh-weixin: no bot account available for notification delivery');
          return controller.sendNotification(botId, text, media);
        },
      })
    : null;
  const supervisor = createSupervisor({
    controller,
    harness,
    logger,
    retryDelaysMs: config.retryDelaysMs,
    healthyIntervalMs: config.healthyIntervalMs,
  }).start();
  await notificationOutbox?.start();
  return {
    controller,
    ready: supervisor.ready,
    async close() {
      await notificationOutbox?.close();
      await supervisor.close();
      await controller.close();
      harness.stopManagedProcess();
    },
  };
}
