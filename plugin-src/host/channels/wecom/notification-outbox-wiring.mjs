import { NotificationOutbox } from '../../../../src/channels/weixin/notification-outbox.mjs';

/**
 * WeCom production 入口的 S5 通知 outbox 接线（04_13 P0-B）。
 *
 * cordis patch（profile）配置键（onlyforchris-dsh-im → config.wecom）：
 *   - notificationOutboxDir:       资产池 notifications/dsh_outbox 绝对路径（必填才启用）
 *   - notificationBotId:           送达用的企业微信 bot（controller 内的 botId 键，必填）
 *   - notificationPollIntervalMs:  轮询间隔，默认 5000
 *
 * 契约：事件不携带收件人；发送目标由 WecomRuntime.sendNotification 使用记住的
 * 私聊 target 解析。发送失败/目标未知时事件留在 outbox 重试（fail-closed）。
 * 仅在 class 存在而不由运行入口实例化不算接通 —— 本函数即唯一实例化点。
 *
 * 阶段A扩展（2026-08-31）：recruiting.needs_human 与既有 score_ready 等走同一
 * 消费路径（NotificationOutbox 不做 type 白名单）；send 第三参拿到 event 后，
 * 对 notification_kind=needs_human 单独打审计日志，确保「实际通知负责人」可归因。
 */
export async function startNotificationOutbox({ config = {}, controller, logger = console }) {
  const dir = config.notificationOutboxDir;
  if (!dir) return null;
  const botId = config.notificationBotId;
  if (!botId) {
    throw new TypeError('notificationBotId is required when notificationOutboxDir is configured');
  }
  const outbox = new NotificationOutbox({
    dir,
    pollIntervalMs: config.notificationPollIntervalMs ?? 5_000,
    logger,
    send: (text, media, event) => {
      if (event?.meta?.notification_kind === 'needs_human') {
        logger.info?.(`[dsh-wecom] needs_human 待人工处理已通知负责人: source_event_id=${event.meta?.source_event_id ?? event.event_id}`);
      }
      return controller.sendNotification(botId, text, media);
    },
  });
  await outbox.start();
  return outbox;
}
