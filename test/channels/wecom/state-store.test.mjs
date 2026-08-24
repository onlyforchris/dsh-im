import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WecomStateStore } from '../../../src/channels/wecom/state-store.mjs';

test('Enterprise WeChat keeps its private push target when Session bindings are cleared', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wecom-state-'));
  const path = join(root, 'state.json');
  const state = await new WecomStateStore(path).load();
  await state.setSession('direct:user', 'session-one');
  await state.setConnectionTestTarget({ chatId: 'user' });
  await state.clearSessions();

  const restored = await new WecomStateStore(path).load();
  assert.equal(restored.sessionFor('direct:user'), null);
  assert.deepEqual(restored.connectionTestTarget(), { chatId: 'user' });
});
