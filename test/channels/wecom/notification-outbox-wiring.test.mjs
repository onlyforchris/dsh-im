import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { startNotificationOutbox } from '../../../plugin-src/host/channels/wecom/notification-outbox-wiring.mjs';

// 04_13 P0-B：当前 WeCom production 入口必须实例化并使用 NotificationOutbox，
// 消费 profile 配置的 outbox 目录 / bot / 轮询间隔。本测试用受控假事件验证
// 消费契约（进入 sent/ 或留在 pending 重试），绝不发送真实企微。

function fakeController({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async sendNotification(botId, text, media) {
      calls.push({ botId, text, media });
      if (fail) throw new Error('runtime not connected');
      return { mode: media?.type === 'image' ? 'image' : 'text' };
    },
  };
}

function writeEvent(dir, event) {
  return writeFile(join(dir, `${event.event_id}.json`), JSON.stringify(event, null, 2), 'utf8');
}

const BASE_EVENT = {
  schema_version: 1,
  type: 'recruiting.score_ready',
  tenant_id: 'hr-zhang',
  text: '招聘评分更新',
};

test('wecom production wiring consumes a fake outbox event into sent/', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wecom-outbox-'));
  try {
    const controller = fakeController();
    const outbox = await startNotificationOutbox({
      config: {
        notificationOutboxDir: dir,
        notificationBotId: 'wecom_test-bot',
        notificationPollIntervalMs: 60_000,
      },
      controller,
      logger: { warn() {}, error() {} },
    });
    assert.ok(outbox, 'outbox must be instantiated by the production wiring');
    const event = { ...BASE_EVENT, event_id: 'score-ready-fake-1' };
    await writeEvent(dir, event);
    await outbox.scan();
    assert.equal(controller.calls.length, 1);
    assert.equal(controller.calls[0].botId, 'wecom_test-bot');
    assert.equal(controller.calls[0].text, '招聘评分更新');
    assert.equal(controller.calls[0].media, undefined);
    const sent = await readFile(join(dir, 'sent', 'score-ready-fake-1.json'), 'utf8');
    assert.equal(JSON.parse(sent).event_id, 'score-ready-fake-1');
    assert.equal(JSON.parse(sent).delivery.mode, 'text');
    await outbox.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('wecom wiring keeps the event pending when send fails (fail-closed retry)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wecom-outbox-fail-'));
  try {
    const controller = fakeController({ fail: true });
    const outbox = await startNotificationOutbox({
      config: { notificationOutboxDir: dir, notificationBotId: 'wecom_test-bot' },
      controller,
      logger: { warn() {}, error() {} },
    });
    await writeEvent(dir, { ...BASE_EVENT, event_id: 'score-ready-fake-2' });
    await outbox.scan();
    const names = await readdir(dir);
    assert.ok(names.includes('score-ready-fake-2.json'), 'event must remain pending for retry');
    await outbox.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('wecom wiring routes malformed events to failed/ without sending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wecom-outbox-bad-'));
  try {
    const controller = fakeController();
    const outbox = await startNotificationOutbox({
      config: { notificationOutboxDir: dir, notificationBotId: 'wecom_test-bot' },
      controller,
      logger: { warn() {}, error() {} },
    });
    await writeEvent(dir, { ...BASE_EVENT, event_id: 'score-ready-bad', schema_version: 99 });
    await outbox.scan();
    assert.equal(controller.calls.length, 0, 'malformed event must not reach the send path');
    assert.ok((await readdir(join(dir, 'failed'))).includes('score-ready-bad.json'));
    await outbox.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('wecom wiring requires notificationBotId when outbox dir is configured', async () => {
  await assert.rejects(
    () => startNotificationOutbox({ config: { notificationOutboxDir: 'X' }, controller: fakeController() }),
    /notificationBotId/,
  );
});

test('wecom wiring is a no-op without notificationOutboxDir', async () => {
  assert.equal(await startNotificationOutbox({ config: {}, controller: fakeController() }), null);
});

test('media image path must stay inside the notification media directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wecom-outbox-media-'));
  try {
    const mediaDir = join(dir, 'dsh_media');
    await mkdir(mediaDir, { recursive: true });
    const controller = fakeController();
    const outbox = await startNotificationOutbox({
      config: { notificationOutboxDir: dir, notificationBotId: 'wecom_test-bot' },
      controller,
      logger: { warn() {}, error() {} },
    });
    await writeEvent(dir, {
      ...BASE_EVENT,
      event_id: 'score-ready-media',
      media: { type: 'image', path: 'C:/definitely/outside/score-ready-media.png' },
    });
    await outbox.scan();
    assert.equal(controller.calls.length, 0, 'outside-media path must be rejected');
    assert.ok((await readdir(join(dir, 'failed'))).includes('score-ready-media.json'));
    await outbox.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
