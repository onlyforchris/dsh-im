import assert from 'node:assert/strict';
import test from 'node:test';
import { installImPreAsk } from '../src/channels/shared/im-pre-ask.mjs';
import { askInWorkspaceSession } from '../src/channels/shared/workspace-session.mjs';

test('without a pre-ask runner the upstream path does not resolve extra workspace RPCs', async () => {
  const result = await askInWorkspaceSession({
    harness: {
      resolveConversationWorkspace: () => assert.fail('optional recruiting gate is not installed'),
      sessionExists: async () => true,
      ask: async () => 'upstream answer',
    },
    state: { sessionFor: () => 'session' }, key: 'chat', text: 'hello',
  });
  assert.equal(result.answer, 'upstream answer');
});

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

for (const resolveWorkspace of [true, false]) {
  test(`pre-ask uses the committed conversation workspace (resolver=${resolveWorkspace})`, async () => {
    let workspace = '/old';
    let finishSwitch;
    const pending = new Promise(resolve => { finishSwitch = resolve; });
    const signal = new AbortController().signal;
    const harness = {
      workspace: '/bot-default',
      pendingConversationWorkspaceSwitch: key => { assert.equal(key, 'chat'); return pending; },
      currentWorkspace: () => '/bot-default',
      currentConversationWorkspace: key => { assert.equal(key, 'chat'); return workspace; },
      ...(resolveWorkspace ? { resolveConversationWorkspace(key, options) {
        assert.equal(key, 'chat');
        assert.equal(options.signal, signal);
        return Promise.resolve(workspace);
      } } : {}),
      ask: () => assert.fail('a fixed reply must bypass the model'),
    };
    const dispose = installImPreAsk(payload => {
      assert.equal(payload.workspace, '/conversation');
      return { kind: 'reply', text: 'handled' };
    });
    try {
      const result = askInWorkspaceSession({ harness, state: { sessionFor: () => '' },
        key: 'chat', text: 'hello', existsOptions: { signal } });
      workspace = '/conversation';
      finishSwitch();
      assert.equal((await result).answer, 'handled');
    } finally { dispose(); }
  });
}
