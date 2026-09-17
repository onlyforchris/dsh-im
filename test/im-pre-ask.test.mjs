import assert from 'node:assert/strict';
import test from 'node:test';
import { installImPreAsk } from '../src/channels/shared/im-pre-ask.mjs';
import { askInWorkspaceSession } from '../src/channels/shared/workspace-session.mjs';

test('pre-ask replies bypass Harness and continuing preserves upstream guidance', async () => {
  let decision = { kind: 'reply', text: 'handled' };
  const dispose = installImPreAsk(async payload => {
    assert.equal(payload.channelLabel, '微信');
    assert.equal(payload.text, 'hello');
    return decision;
  });
  const calls = [];
  const harness = {
    async sessionExists() { return true; },
    async ask(id, prompt, options) {
      calls.push({ id, prompt, options });
      return 'answer';
    },
  };
  const args = { harness, state: { sessionFor: () => 'session-1' },
    key: 'chat', text: 'hello', channelLabel: '微信', sourceGuidance: 'guidance' };
  try {
    assert.equal((await askInWorkspaceSession(args)).answer, 'handled');
    assert.equal(calls.length, 0);
    decision = { kind: 'continue' };
    assert.equal((await askInWorkspaceSession(args)).answer, 'answer');
    assert.equal(calls.length, 1);
    assert.match(calls[0].prompt, /^\[来源渠道:微信/);
    assert.equal(calls[0].options.sourceGuidance, 'guidance');
  } finally { dispose(); }
});
