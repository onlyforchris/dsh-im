import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    },
  });
  try {
    await outbox.start();
    assert.equal(await readFile(join(dir, 'score-ready-test.json'), 'utf8'), JSON.stringify(event));
    ready = true;
    await outbox.scan();
    assert.deepEqual(sent, ['招聘评分更新']);
    assert.equal(JSON.parse(await readFile(join(dir, 'sent', 'score-ready-test.json'))).event_id, event.event_id);
  } finally {
    await outbox.close();
    await rm(dir, { recursive: true, force: true });
  }
});
