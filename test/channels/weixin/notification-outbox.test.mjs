import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NotificationOutbox } from '../../../src/channels/weixin/notification-outbox.mjs';

test('notification outbox retries once then archives the sent event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-im-outbox-'));
  const event = {
    schema_version: 1,
    event_id: 'score-ready-test',
    type: 'recruiting.score_ready',
    text: '招聘评分更新',
  };
  await writeFile(join(dir, 'score-ready-test.json'), JSON.stringify(event));
  let ready = false;
  const sent = [];
  const outbox = new NotificationOutbox({
    dir,
    pollIntervalMs: 60_000,
    logger: { warn() {} },
    send: async (text) => {
      if (!ready) throw new Error('offline');
      sent.push(text);
      return { mode: 'text', provider: { accepted: true, ret: 0, errcode: null } };
    },
  });
  try {
    await outbox.start();
    assert.equal(await readFile(join(dir, 'score-ready-test.json'), 'utf8'), JSON.stringify(event));
    ready = true;
    await outbox.scan();
    assert.deepEqual(sent, ['招聘评分更新']);
    const archived = JSON.parse(await readFile(join(dir, 'sent', 'score-ready-test.json')));
    assert.equal(archived.event_id, event.event_id);
    assert.deepEqual(archived.delivery.provider, { accepted: true, ret: 0, errcode: null });
  } finally {
    await outbox.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('notification outbox accepts any well-formed event type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-im-outbox-type-'));
  await writeFile(join(dir, 'lead-contact.json'), JSON.stringify({
    schema_version: 1,
    event_id: 'lead-contact-test',
    type: 'recruiting.lead_contact_acquired',
    text: '新联系人通知',
  }));
  const sent = [];
  const outbox = new NotificationOutbox({
    dir,
    pollIntervalMs: 60_000,
    logger: { warn() {} },
    send: async (text) => { sent.push(text); },
  });
  try {
    await outbox.start();
    await outbox.scan();
    assert.deepEqual(sent, ['新联系人通知']);
    assert.equal(JSON.parse(await readFile(join(dir, 'sent', 'lead-contact.json'))).type, 'recruiting.lead_contact_acquired');
  } finally {
    await outbox.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('notification outbox delivers recruiting.needs_human to owner (阶段A)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-im-outbox-human-'));
  // 与 event_router._emit_outbox_needs_human 写出的完整 payload 形状一致：
  // 连字符 event_id + type=recruiting.needs_human + meta.notification_kind/source_event_id
  const event = {
    schema_version: 1,
    event_id: 'recruiting-needs-human-zljd-20260831-0042-7',
    type: 'recruiting.needs_human',
    tenant_id: 'test-tenant',
    created_at: '2026-08-31T20:00:00+08:00',
    text: '⚠️ 招聘自动化需人工处理：zl_jd_post 连续 3 次失败（写操作失败 rc=1，副作用不确定，禁止自动重试）。事件 evt-42 已暂停，请查看并决定下一步。',
    meta: {
      notification_kind: 'needs_human',
      channel: 'wecom',
      target_alias: 'owner',
      source_event_id: 'evt-42',
    },
  };
  await writeFile(join(dir, `${event.event_id}.json`), JSON.stringify(event));
  const sent = [];
  const outbox = new NotificationOutbox({
    dir,
    pollIntervalMs: 60_000,
    logger: { warn() {} },
    send: async (text, media, e) => {
      sent.push({ text, media, event: e });
      return { mode: 'text', provider: { accepted: true, ret: 0, errcode: null } };
    },
  });
  try {
    await outbox.start();
    await outbox.scan();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, event.text);
    // send 第三参透传完整事件（wiring 靠 meta.notification_kind 打 needs_human 审计日志）
    assert.equal(sent[0].event.type, 'recruiting.needs_human');
    assert.equal(sent[0].event.meta.notification_kind, 'needs_human');
    assert.equal(sent[0].event.meta.source_event_id, 'evt-42');
    const archived = JSON.parse(await readFile(join(dir, 'sent', `${event.event_id}.json`), 'utf8'));
    assert.equal(archived.event_id, event.event_id);
    assert.equal(archived.delivery.mode, 'text');
    assert.equal(archived.meta.source_event_id, 'evt-42');
  } finally {
    await outbox.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('notification outbox rejects malformed event types', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-im-outbox-badtype-'));
  await writeFile(join(dir, 'bad-type.json'), JSON.stringify({
    schema_version: 1,
    event_id: 'bad-type-test',
    type: '',
    text: '空类型',
  }));
  const outbox = new NotificationOutbox({
    dir,
    pollIntervalMs: 60_000,
    logger: { warn() {} },
    send: async () => { throw new Error('should not be called'); },
  });
  try {
    await outbox.start();
    await outbox.scan();
    assert.ok(await readFile(join(dir, 'failed', 'bad-type.json')));
  } finally {
    await outbox.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('notification outbox sends only images from its controlled media directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-im-media-outbox-'));
  const dir = join(root, 'dsh_outbox');
  const mediaDir = join(root, 'dsh_media');
  await Promise.all([mkdir(dir, { recursive: true }), mkdir(mediaDir, { recursive: true })]);
  const image = join(mediaDir, 'digest.png');
  await writeFile(image, Buffer.from('png'));
  await writeFile(join(dir, 'digest.json'), JSON.stringify({
    schema_version: 1,
    event_id: 'digest-test',
    type: 'recruiting.score_ready',
    text: '招聘摘要',
    media: { type: 'image', path: image },
  }));
  const sent = [];
  const outbox = new NotificationOutbox({
    dir,
    mediaDir,
    pollIntervalMs: 60_000,
    send: async (text, media) => {
      sent.push({ text, media });
      return { sent: true, mode: 'image' };
    },
  });
  try {
    await outbox.start();
    assert.equal(sent[0].text, '招聘摘要');
    assert.equal(sent[0].media.path, image);
    const archived = JSON.parse(await readFile(join(dir, 'sent', 'digest.json'), 'utf8'));
    assert.equal(archived.delivery.mode, 'image');
  } finally {
    await outbox.close();
    await rm(root, { recursive: true, force: true });
  }
});
