import { apply as applyDingtalk } from './channels/dingtalk/index.mjs';
import { apply as applyDiscord } from './channels/discord/index.mjs';
import { apply as applyOffice } from './channels/office/index.mjs';
import { apply as applyFeishu } from './channels/feishu/index.mjs';
import { apply as applyQq } from './channels/qq/index.mjs';
import { apply as applySlack } from './channels/slack/index.mjs';
import { apply as applyTelegram } from './channels/telegram/index.mjs';
import { apply as applyWecom } from './channels/wecom/index.mjs';
import { apply as applyWeixin } from './channels/weixin/index.mjs';
import { apply as applyWhatsapp } from './channels/whatsapp/index.mjs';
import { installImPreAsk } from '../../src/channels/shared/im-pre-ask.mjs';

export const name = 'dsh-im-host';
export const inject = ['connection', 'credentials', 'webServer', 'typertGateway'];

function channelConfig(config, name) {
  const channel = config[name] ?? {};
  return config.rpcAuthority === undefined
    ? channel
    : { ...channel, rpcAuthority: config.rpcAuthority };
}

export function createImHostPlugin(internals = {}) {
  const startFeishu = internals.applyFeishu ?? applyFeishu;
  const startWeixin = internals.applyWeixin ?? applyWeixin;
  const startDingtalk = internals.applyDingtalk ?? applyDingtalk;
  const startWecom = internals.applyWecom ?? applyWecom;
  const startQq = internals.applyQq ?? applyQq;
  const startSlack = internals.applySlack ?? applySlack;
  const startTelegram = internals.applyTelegram ?? applyTelegram;
  const startDiscord = internals.applyDiscord ?? applyDiscord;
  const startOffice = internals.applyOffice ?? applyOffice;
  const startWhatsapp = internals.applyWhatsapp ?? applyWhatsapp;
  return Object.freeze({
    name,
    inject,
    async apply(ctx, config = {}) {
      // 通用扩展点：业务插件 ctx.on('im/pre-ask') 可短路固定回执（不进 LLM）
      const disposePreAsk = installImPreAsk(async (payload) => {
        if (typeof ctx.waterfall !== 'function') return { kind: 'continue' };
        return ctx.waterfall(
          'im/pre-ask',
          payload,
          () => Promise.resolve({ kind: 'continue' }),
        );
      });
      ctx.effect(() => disposePreAsk, 'dsh-im: im/pre-ask gate');

      await startFeishu(ctx, channelConfig(config, 'feishu'));
      await startWeixin(ctx, channelConfig(config, 'weixin'));
      await startDingtalk(ctx, channelConfig(config, 'dingtalk'));
      await startWecom(ctx, channelConfig(config, 'wecom'));
      await startQq(ctx, channelConfig(config, 'qq'));
      await startSlack(ctx, channelConfig(config, 'slack'));
      await startTelegram(ctx, channelConfig(config, 'telegram'));
      await startDiscord(ctx, channelConfig(config, 'discord'));
      await startWhatsapp(ctx, channelConfig(config, 'whatsapp'));
      await startOffice(ctx, channelConfig(config, 'office'));
    },
  });
}

export async function apply(ctx, config = {}) {
  return createImHostPlugin().apply(ctx, config);
}
