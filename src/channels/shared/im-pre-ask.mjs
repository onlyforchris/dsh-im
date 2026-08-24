/**
 * IM 入站 pre-ask 扩展点（产品无关）。
 *
 * dsh-im host 在 apply 时 installImPreAsk(runner)。
 * 业务插件（如 recruiting-flow-bus）监听 Cordis 事件 `im/pre-ask`：
 *   payload: { channelLabel, fromUserId, msgId, text, content }
 *   返回: { kind: 'continue' } | { kind: 'reply', text } | { kind: 'silent' }
 *
 * askInWorkspaceSession 在调用 Harness 前先 runImPreAsk；
 * reply/silent 时不进 LLM。
 */
let preAskRunner = null;

export function installImPreAsk(runner) {
  preAskRunner = typeof runner === 'function' ? runner : null;
  return () => {
    if (preAskRunner === runner) preAskRunner = null;
  };
}

export async function runImPreAsk(payload = {}) {
  if (!preAskRunner) return { kind: 'continue' };
  try {
    const decision = await preAskRunner(payload);
    if (!decision || typeof decision !== 'object') return { kind: 'continue' };
    if (decision.kind === 'reply' && typeof decision.text === 'string') {
      return { kind: 'reply', text: decision.text };
    }
    if (decision.kind === 'silent') return { kind: 'silent' };
    return { kind: 'continue' };
  } catch (error) {
    payload?.logger?.warn?.('[im/pre-ask] runner failed:', error?.message ?? error);
    return { kind: 'continue' };
  }
}
