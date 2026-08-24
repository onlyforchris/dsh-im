const targets = new WeakMap();

export const CONNECTION_TEST_STATE_IDENTITY = Symbol('dsh-im.connection-test-state-identity');

function stateIdentity(state) {
  return state?.[CONNECTION_TEST_STATE_IDENTITY] ?? state;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function rememberConnectionTestTarget(state, target) {
  if (!state || !target || typeof target !== 'object') return false;
  try {
    targets.set(stateIdentity(state), structuredClone(target));
    return typeof stateIdentity(state)?.setConnectionTestTarget === 'function'
      ? stateIdentity(state).setConnectionTestTarget(target)
      : true;
  } catch {
    return false;
  }
}

export function connectionTestTarget(state) {
  const identity = stateIdentity(state);
  const target = identity
    ? targets.get(identity) ?? identity.connectionTestTarget?.()
    : null;
  return target ? structuredClone(target) : null;
}

export function latestBoundConversation(state, prefix) {
  const normalizedPrefix = cleanText(prefix);
  const sessions = stateIdentity(state)?.snapshot?.()?.sessions;
  if (!normalizedPrefix || !sessions || typeof sessions !== 'object') return null;
  const key = Object.keys(sessions).findLast((value) => value.startsWith(normalizedPrefix));
  const id = key ? cleanText(key.slice(normalizedPrefix.length)) : null;
  return id ? { key, id } : null;
}

export function connectionTestMessage(botName, channelLabel = '机器人') {
  const name = cleanText(botName) ?? channelLabel;
  return `✅ DeepSeek Harness 连接测试成功\n这条消息由插件页面中的“${name}”机器人卡片发出。`;
}

export function connectionTestTargetUnavailable(channelLabel = '机器人') {
  const error = new Error(`${channelLabel}尚未收到可用于测试的私聊消息。`);
  error.code = 'test-target-unavailable';
  return error;
}

export async function sendRememberedConnectionTest({ state, send, text, channelLabel }) {
  const target = connectionTestTarget(state);
  if (!target) throw connectionTestTargetUnavailable(channelLabel);
  await send(target, text);
  return { sent: true };
}

export function publicConnectionTestResult(error) {
  if (!error) return Object.freeze({ sent: true });
  return Object.freeze({
    sent: false,
    code: error?.code === 'test-target-unavailable'
      ? 'test-target-unavailable'
      : 'test-message-failed',
  });
}
