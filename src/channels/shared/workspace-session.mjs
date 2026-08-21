import { withSessionBindingLock } from './session-binding-lock.mjs';

export const WORKSPACE_SESSION_STALE = 'workspace-session-stale';

function workspaceSession(harness, sessionId) {
  if (typeof harness.workspaceSession === 'function') {
    return harness.workspaceSession(sessionId);
  }
  return Object.freeze({
    sessionId,
    sessionExists: (...args) => harness.sessionExists(sessionId, ...args),
    models: (...args) => harness.getSessionModels(sessionId, ...args),
    selectModel: (...args) => harness.selectSessionModel(sessionId, ...args),
    isRunning: (...args) => harness.isSessionRunning(sessionId, ...args),
    hasActiveTurn: (...args) => harness.hasActiveTurn(sessionId, ...args),
    stopActiveTurn: (...args) => harness.stopActiveTurn(sessionId, ...args),
    steerActiveTurn: (...args) => harness.steerActiveTurn(sessionId, ...args),
    ask: (...args) => harness.ask(sessionId, ...args),
  });
}

async function sessionExists(session, options) {
  return options === undefined
    ? session.sessionExists()
    : session.sessionExists(options);
}

async function createSession(harness, options) {
  return options === undefined
    ? harness.createSession()
    : harness.createSession(options);
}

/**
 * Tag an inbound prompt with its source channel so the agent can attribute
 * work (e.g. cross-channel work logs) without guessing from context.
 */
export function tagPromptWithChannel(text, content, channelLabel) {
  const label = typeof channelLabel === 'string' ? channelLabel.trim() : '';
  if (!label) return { text, content };
  const tag = `[来源渠道:${label}]`;
  if (Array.isArray(content)) {
    const tagged = content.slice();
    const index = tagged.findIndex((item) => item?.type === 'text');
    if (index === -1) {
      tagged.unshift({ type: 'text', text: tag });
    } else {
      const body = typeof tagged[index].text === 'string' ? tagged[index].text : '';
      tagged[index] = { ...tagged[index], text: body ? `${tag}\n${body}` : tag };
    }
    return { text, content: tagged };
  }
  return { text: text ? `${tag}\n${text}` : tag, content };
}

/**
 * Resolve, persist, and ask through a session that belongs to the bot's
 * current workspace. A concurrent workspace switch invalidates the scoped
 * session and retries before any prompt is sent to the stale session.
 */
export async function askInWorkspaceSession({
  harness,
  state,
  key,
  text,
  content,
  channelLabel,
  createOptions,
  existsOptions,
  askOptions,
}) {
  const prompt = tagPromptWithChannel(text, content, channelLabel);
  while (true) {
    try {
      const binding = await withSessionBindingLock(state, key, async () => {
        let sessionId = state.sessionFor(key);
        let session = sessionId ? workspaceSession(harness, sessionId) : null;
        if (!session || !(await sessionExists(session, existsOptions))) {
          sessionId = await createSession(harness, createOptions);
          if (await state.setSession(key, sessionId) === false) return null;
          session = workspaceSession(harness, sessionId);
        }
        return { sessionId, session };
      });
      if (!binding) continue;
      return {
        sessionId: binding.sessionId,
        answer: await binding.session.ask(prompt.content ?? prompt.text, askOptions),
      };
    } catch (error) {
      if (error?.code !== WORKSPACE_SESSION_STALE) throw error;
    }
  }
}
