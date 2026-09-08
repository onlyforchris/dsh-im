import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { after, describe, it } from 'node:test';

import { WeixinStateStore } from '../../../src/channels/weixin/state-store.mjs';

const created = [];

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-weixin-state-'));
  created.push(dir);
  return { store: await new WeixinStateStore(join(dir, 'state.json')).load(), dir };
}

after(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('WeixinStateStore 送达目标持久化', () => {
  it('默认没有送达目标', async () => {
    const { store } = await makeStore();
    assert.equal(store.connectionTestTarget(), null);
  });

  it('setConnectionTestTarget 后重新 load 仍在（重启不丢）', async () => {
    const { store, dir } = await makeStore();
    await store.setConnectionTestTarget({ toUserId: 'o9cq807T@im.wechat' });

    const reloaded = await new WeixinStateStore(join(dir, 'state.json')).load();
    assert.deepEqual(reloaded.connectionTestTarget(), { toUserId: 'o9cq807T@im.wechat' });

    const onDisk = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    assert.deepEqual(onDisk.connectionTestTarget, { toUserId: 'o9cq807T@im.wechat' });
  });

  it('与既有字段共存，不破坏 getUpdatesBuf / recentOutboundMessages', async () => {
    const { store, dir } = await makeStore();
    await store.setGetUpdatesBuf('cursor-1');
    await store.rememberOutboundMessage({ toUserId: 'u1', text: 'hi', sentAt: Date.now() });
    await store.setConnectionTestTarget({ toUserId: 'u1' });

    const reloaded = await new WeixinStateStore(join(dir, 'state.json')).load();
    assert.equal(reloaded.getUpdatesBuf(), 'cursor-1');
    assert.equal(reloaded.snapshot().recentOutboundMessages.length, 1);
    assert.deepEqual(reloaded.connectionTestTarget(), { toUserId: 'u1' });
  });

  it('非法目标 fail-closed：抛错且不落盘', async () => {
    const { store, dir } = await makeStore();
    await assert.rejects(() => store.setConnectionTestTarget(null), TypeError);
    await assert.rejects(() => store.setConnectionTestTarget({}), TypeError);
    await assert.rejects(() => store.setConnectionTestTarget('u1'), TypeError);

    const reloaded = await new WeixinStateStore(join(dir, 'state.json')).load();
    assert.equal(reloaded.connectionTestTarget(), null);
  });
});
