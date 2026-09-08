import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { after, beforeEach, describe, it } from 'node:test';

import { WecomStateStore } from '../../../src/channels/wecom/state-store.mjs';

const created = [];

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wecom-state-'));
  created.push(dir);
  return { store: await new WecomStateStore(join(dir, 'state.json')).load(), dir };
}

after(async () => {
  await Promise.all(created.map((dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))));
});

describe('WecomStateStore 送达目标持久化', () => {
  beforeEach(() => {
    created.length = 0;
  });

  it('默认没有送达目标', async () => {
    const { store } = await makeStore();
    assert.equal(store.connectionTestTarget(), null);
  });

  it('setConnectionTestTarget 后重新 load 仍在（重启不丢）', async () => {
    const { store, dir } = await makeStore();
    await store.setConnectionTestTarget({ chatId: 'ZhangJiMin' });

    const reloaded = await new WecomStateStore(join(dir, 'state.json')).load();
    assert.deepEqual(reloaded.connectionTestTarget(), { chatId: 'ZhangJiMin' });

    const onDisk = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    assert.deepEqual(onDisk.connectionTestTarget, { chatId: 'ZhangJiMin' });
  });

  it('返回副本：改返回值不污染内部状态', async () => {
    const { store } = await makeStore();
    await store.setConnectionTestTarget({ chatId: 'A' });
    const first = store.connectionTestTarget();
    first.chatId = 'tampered';
    assert.equal(store.connectionTestTarget().chatId, 'A');
  });

  it('非法目标 fail-closed：抛错且不落盘', async () => {
    const { store, dir } = await makeStore();
    await assert.rejects(() => store.setConnectionTestTarget(null), TypeError);
    await assert.rejects(() => store.setConnectionTestTarget({}), TypeError);
    await assert.rejects(() => store.setConnectionTestTarget(['chatId']), TypeError);
    await assert.rejects(() => store.setConnectionTestTarget('ZhangJiMin'), TypeError);
    assert.equal(store.connectionTestTarget(), null);

    const reloaded = await new WecomStateStore(join(dir, 'state.json')).load();
    assert.equal(reloaded.connectionTestTarget(), null);
  });

  it('旧版 state.json（无该字段）可读且目标为 null', async () => {
    const { store } = await makeStore();
    assert.equal(store.connectionTestTarget(), null);
    assert.deepEqual(store.snapshot().sessions, {});
  });
});
