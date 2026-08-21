import * as React from 'react';

import {
  DingtalkLogoGlyph,
  DiscordLogoGlyph,
  FeishuLogoGlyph,
  OfficeLogoGlyph,
  QqLogoGlyph,
  SlackLogoGlyph,
  TelegramLogoGlyph,
  WecomLogoGlyph,
  WeixinLogoGlyph,
  WhatsappLogoGlyph,
} from './channel-logos.js';
import { DINGTALK_RPC_CHANNEL } from './channels/dingtalk/api.js';
import { DingtalkSettingsTab } from './channels/dingtalk/index.js';
import { DISCORD_RPC_CHANNEL } from './channels/discord/api.js';
import { DiscordSettingsTab } from './channels/discord/index.js';
import { installDiscordStyles } from './channels/discord/styles.js';
import { FeishuSettingsTab } from './channels/feishu/index.js';
import { FEISHU_RPC_CHANNEL } from './channels/feishu/api.js';
import { installFeishuStyles } from './channels/feishu/styles.js';
import { QQ_RPC_CHANNEL } from './channels/qq/api.js';
import { QqSettingsTab } from './channels/qq/index.js';
import { installQqStyles } from './channels/qq/styles.js';
import { OFFICE_RPC_CHANNEL } from './channels/office/api.js';
import { OfficeSettingsTab } from './channels/office/index.js';
import { installOfficeStyles } from './channels/office/styles.js';
import { SLACK_RPC_CHANNEL } from './channels/slack/api.js';
import { SlackSettingsTab } from './channels/slack/index.js';
import { installSlackStyles } from './channels/slack/styles.js';
import { TELEGRAM_RPC_CHANNEL } from './channels/telegram/api.js';
import { TelegramSettingsTab } from './channels/telegram/index.js';
import { installTelegramStyles } from './channels/telegram/styles.js';
import { WECOM_RPC_CHANNEL } from './channels/wecom/api.js';
import { WecomSettingsTab } from './channels/wecom/index.js';
import { installWecomStyles } from './channels/wecom/styles.js';
import { WeixinSettingsTab } from './channels/weixin/index.js';
import { WEIXIN_RPC_CHANNEL } from './channels/weixin/api.js';
import { installWeixinStyles } from './channels/weixin/styles.js';
import { WHATSAPP_RPC_CHANNEL } from './channels/whatsapp/api.js';
import { WhatsappSettingsTab } from './channels/whatsapp/index.js';
import { installWhatsappStyles } from './channels/whatsapp/styles.js';
import { en, h, IM_LOCALE_NAMESPACE, setImTranslator, zh } from './i18n.js';
import { installImStyles } from './styles.js';
import { WorkspaceDirectoryPickerContext } from './workspace-editor.js';

export const name = 'im-settings';
export const inject = ['slots', 'connection', 'locale', 'workspaces'];

// 个人 fork 调整：按实际使用频率排序（飞书/钉钉/企微为主力渠道）。
const CHANNELS = Object.freeze([
  { id: 'feishu', label: '飞书' },
  { id: 'dingtalk', label: '钉钉' },
  { id: 'wecom', label: '企业微信' },
  { id: 'weixin', label: '微信' },
  { id: 'qq', label: 'QQ' },
  { id: 'slack', label: 'Slack' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'discord', label: 'Discord' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'office', label: 'AI Office', note: '（实验功能）' },
]);

const CHANNEL_STATUS_LABELS = Object.freeze({
  connected: '已连接',
  offline: '已配置，未连接',
  unconfigured: '未配置',
  unknown: '状态未知',
});

function unwrapStatusValue(result) {
  if (result && typeof result === 'object' && result.ok === true) return result.value;
  return result;
}

function channelStatusFromSnapshot(value) {
  const bots = Array.isArray(value?.bots) ? value.bots : [];
  if (bots.length > 0) {
    return bots.some((bot) => bot?.connected === true) ? 'connected' : 'offline';
  }
  if (value?.configured === true) return value?.connected === true ? 'connected' : 'offline';
  return 'unconfigured';
}

// 轮询全部渠道的 connection.status，驱动左栏状态点与头部汇总。
function useChannelStatuses(rpcCalls) {
  const [statuses, setStatuses] = React.useState({});
  React.useEffect(() => {
    let disposed = false;
    const fetchAll = async () => {
      const entries = await Promise.all(CHANNELS.map(async (channel) => {
        const rpcCall = rpcCalls[channel.id];
        if (typeof rpcCall !== 'function') return [channel.id, 'unknown'];
        try {
          const snapshot = unwrapStatusValue(await rpcCall('connection.status', {}));
          return [channel.id, channelStatusFromSnapshot(snapshot)];
        } catch {
          return [channel.id, 'unknown'];
        }
      }));
      if (!disposed) setStatuses(Object.fromEntries(entries));
    };
    void fetchAll();
    const timer = setInterval(fetchAll, 15_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
    // rpcCalls 在 apply 中创建一次，引用稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return statuses;
}

function ChannelStatusDot({ state }) {
  const tone = CHANNEL_STATUS_LABELS[state] ? state : 'unknown';
  return h('span', {
    className: `dim-channelStatus dim-channelStatus-${tone}`,
    title: CHANNEL_STATUS_LABELS[tone],
    'aria-label': CHANNEL_STATUS_LABELS[tone],
    role: 'status',
  });
}

function WeixinLogo() {
  return h('span', { className: 'dim-logo dim-logoWeixin', 'aria-hidden': 'true' },
    h(WeixinLogoGlyph));
}

function FeishuLogo() {
  return h('span', { className: 'dim-logo dim-logoFeishu', 'aria-hidden': 'true' },
    h(FeishuLogoGlyph));
}

function DingtalkLogo() {
  return h('span', { className: 'dim-logo dim-logoDingtalk', 'aria-hidden': 'true' },
    h(DingtalkLogoGlyph));
}

function QqLogo() {
  return h('span', { className: 'dim-logo dim-logoQq', 'aria-hidden': 'true' }, h(QqLogoGlyph));
}

function WecomLogo() {
  return h('span', { className: 'dim-logo dim-logoWecom', 'aria-hidden': 'true' }, h(WecomLogoGlyph));
}

function TelegramLogo() {
  return h('span', { className: 'dim-logo dim-logoTelegram', 'aria-hidden': 'true' },
    h(TelegramLogoGlyph));
}

function SlackLogo() {
  return h('span', { className: 'dim-logo dim-logoSlack', 'aria-hidden': 'true' },
    h(SlackLogoGlyph));
}

function DiscordLogo() {
  return h('span', { className: 'dim-logo dim-logoDiscord', 'aria-hidden': 'true' },
    h(DiscordLogoGlyph));
}

function WhatsappLogo() {
  return h('span', { className: 'dim-logo dim-logoWhatsapp', 'aria-hidden': 'true' },
    h(WhatsappLogoGlyph));
}

function OfficeLogo() {
  return h('span', { className: 'dim-logo dim-logoOffice', 'aria-hidden': 'true' },
    h(OfficeLogoGlyph));
}

function ChannelLogo({ channel }) {
  if (channel === 'weixin') return h(WeixinLogo);
  if (channel === 'feishu') return h(FeishuLogo);
  if (channel === 'dingtalk') return h(DingtalkLogo);
  if (channel === 'wecom') return h(WecomLogo);
  if (channel === 'qq') return h(QqLogo);
  if (channel === 'slack') return h(SlackLogo);
  if (channel === 'telegram') return h(TelegramLogo);
  if (channel === 'discord') return h(DiscordLogo);
  if (channel === 'whatsapp') return h(WhatsappLogo);
  return h(OfficeLogo);
}

export function IMSettingsTab({
  dingtalkRpcCall,
  discordRpcCall,
  feishuRpcCall,
  qqRpcCall,
  slackRpcCall,
  telegramRpcCall,
  wecomRpcCall,
  weixinRpcCall,
  whatsappRpcCall,
  officeRpcCall,
  workspaceDirectoryPicker,
}) {
  const [selected, setSelected] = React.useState('feishu');
  const githubTooltipId = React.useId();
  const statuses = useChannelStatuses({
    dingtalk: dingtalkRpcCall,
    discord: discordRpcCall,
    feishu: feishuRpcCall,
    qq: qqRpcCall,
    slack: slackRpcCall,
    telegram: telegramRpcCall,
    wecom: wecomRpcCall,
    weixin: weixinRpcCall,
    whatsapp: whatsappRpcCall,
    office: officeRpcCall,
  });
  const statusCounts = CHANNELS.reduce((counts, channel) => {
    const state = statuses[channel.id];
    if (state === 'connected') counts.connected += 1;
    else if (state === 'offline') counts.offline += 1;
    return counts;
  }, { connected: 0, offline: 0 });
  const unconfigured = CHANNELS.length - statusCounts.connected - statusCounts.offline;
  const active = CHANNELS.find((channel) => channel.id === selected) ?? CHANNELS[0];
  return h(WorkspaceDirectoryPickerContext.Provider, { value: workspaceDirectoryPicker },
    h('section', { className: 'dim-page', 'aria-label': 'IM机器人设置' },
    h('header', { className: 'dim-title' },
      h('div', { className: 'dim-brand' },
        h('strong', { className: 'dim-brandName' }, 'DSH-IM'),
        h('p', null, '让 DeepSeek Harness 触手可及'),
        h('p', { className: 'dim-channelSummary', role: 'status' },
          `已连接 ${statusCounts.connected} · 未连接 ${statusCounts.offline} · 未配置 ${unconfigured}`)),
      h('span', { className: 'dim-githubAction' },
        h('a', {
          className: 'dim-githubLink',
          href: 'https://github.com/onlyforchris/dsh-im',
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': 'dsh-im GitHub',
          'aria-describedby': githubTooltipId,
        },
        h('span', null, 'GitHub'),
        h('span', { className: 'dim-githubArrow', 'aria-hidden': 'true' }, '↗')),
        h('span', {
          id: githubTooltipId,
          className: 'dim-githubTooltip',
          role: 'tooltip',
        }, '帮助与反馈 · 前往 GitHub')),
    ),
    h('div', { className: 'dim-layout' },
      h('nav', { className: 'dim-rail', role: 'tablist', 'aria-label': 'IM 渠道' },
        CHANNELS.map((channel) => h('button', {
          key: channel.id,
          type: 'button',
          role: 'tab',
          id: `dim-tab-${channel.id}`,
          className: 'dim-channel',
          'aria-selected': channel.id === active.id,
          'aria-controls': `dim-panel-${channel.id}`,
          onClick: () => setSelected(channel.id),
        },
        h(ChannelLogo, { channel: channel.id }),
        h('span', { className: 'dim-channelCopy' },
          h('strong', null, channel.label),
          channel.note ? h('small', { className: 'dim-channelNote' }, channel.note) : null,
        ),
        h(ChannelStatusDot, { state: statuses[channel.id] })))),
      h('div', { className: 'dim-divider', 'aria-hidden': 'true' }),
      h('main', {
        className: 'dim-panel',
        role: 'tabpanel',
        id: `dim-panel-${active.id}`,
        'aria-labelledby': `dim-tab-${active.id}`,
      }, active.id === 'weixin'
        ? h(WeixinSettingsTab, { rpcCall: weixinRpcCall })
        : active.id === 'feishu'
          ? h(FeishuSettingsTab, { rpcCall: feishuRpcCall })
          : active.id === 'dingtalk'
            ? h(DingtalkSettingsTab, { rpcCall: dingtalkRpcCall })
            : active.id === 'wecom'
              ? h(WecomSettingsTab, { rpcCall: wecomRpcCall })
              : active.id === 'qq'
                ? h(QqSettingsTab, { rpcCall: qqRpcCall })
                : active.id === 'slack'
                  ? h(SlackSettingsTab, { rpcCall: slackRpcCall })
                : active.id === 'telegram'
                  ? h(TelegramSettingsTab, { rpcCall: telegramRpcCall })
                  : active.id === 'discord'
                    ? h(DiscordSettingsTab, { rpcCall: discordRpcCall })
                    : active.id === 'whatsapp'
                      ? h(WhatsappSettingsTab, { rpcCall: whatsappRpcCall })
                      : h(OfficeSettingsTab, { rpcCall: officeRpcCall })),
    ),
  ));
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(IM_LOCALE_NAMESPACE, { zh, en }),
    'im-settings: bilingual dictionaries',
  );
  const t = ctx.locale.bind(IM_LOCALE_NAMESPACE);
  setImTranslator(t);

  ctx.effect(() => {
    const disposers = [
      installFeishuStyles(),
      installWeixinStyles(),
      installWecomStyles(),
      installQqStyles(),
      installSlackStyles(),
      installTelegramStyles(),
      installDiscordStyles(),
      installWhatsappStyles(),
      installOfficeStyles(),
      installImStyles(),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  }, 'im-settings: install combined channel styles');

  const feishuRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal);
  const weixinRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(WEIXIN_RPC_CHANNEL, endpoint, payload, signal);
  const dingtalkRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(DINGTALK_RPC_CHANNEL, endpoint, payload, signal);
  const qqRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(QQ_RPC_CHANNEL, endpoint, payload, signal);
  const wecomRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(WECOM_RPC_CHANNEL, endpoint, payload, signal);
  const telegramRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(TELEGRAM_RPC_CHANNEL, endpoint, payload, signal);
  const discordRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(DISCORD_RPC_CHANNEL, endpoint, payload, signal);
  const whatsappRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(WHATSAPP_RPC_CHANNEL, endpoint, payload, signal);
  const slackRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(SLACK_RPC_CHANNEL, endpoint, payload, signal);
  const officeRpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(OFFICE_RPC_CHANNEL, endpoint, payload, signal);
  const workspaceDirectoryPicker = Object.freeze({
    listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
    pickDirectory: () => ctx.workspaces.pickDirectory(),
  });

  // 个人 fork 调整：从「设置 → 插件」子标签提升为设置页一级菜单（顶部导航可见）。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'im',
    order: 20,
    label: () => t('IM机器人'),
    locale: IM_LOCALE_NAMESPACE,
    inject: () => ({
      dingtalkRpcCall,
      discordRpcCall,
      feishuRpcCall,
      qqRpcCall,
      slackRpcCall,
      telegramRpcCall,
      wecomRpcCall,
      weixinRpcCall,
      whatsappRpcCall,
      officeRpcCall,
      workspaceDirectoryPicker,
    }),
  }, IMSettingsTab));
}
