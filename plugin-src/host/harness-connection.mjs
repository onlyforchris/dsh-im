/**
 * `dsh-im` 与 Host 建立连接的策略（按优先级）：
 *
 * 1. 显式 `harnessBaseUrl` —— 直接 HTTP/WebSocket，永不读 Host 服务。
 * 2. Host 提供进程内 `apiProxy`（DSH Desktop）—— in-process 通道。
 * 3. 回退：`webServer.port` 拼回环 HTTP/WebSocket（`dsh web` CLI 模式，
 *    f0b6b38 之前的 harnessOrigin 行为）。
 *
 * 注意：cordis 的 context proxy 对「未提供的服务」读取一律抛
 * `cannot get property ... without inject`，可选链无法绕过。apiProxy 已从
 * 各插件 inject 列表移除（否则 `dsh web` 下激活会永远 pending），因此
 * 探测必须走 peekService 容错读取，不能直接 `ctx?.apiProxy`。
 */

function peekService(ctx, prop) {
  if (!ctx) return undefined;
  try {
    return ctx[prop];
  } catch (error) {
    if (String(error?.message ?? '').includes(`cannot get property "${prop}"`)) {
      return undefined;
    }
    throw error;
  }
}

export function harnessConnection(ctx, config = {}) {
  if (config.harnessBaseUrl !== undefined) {
    return { baseUrl: new URL(config.harnessBaseUrl) };
  }
  const apiProxy = peekService(ctx, 'apiProxy');
  if (apiProxy) {
    return {
      apiProxy,
      // Cordis child contexts share one root; different Hosts must not share
      // ownership of pending questions and approvals.
      interactionScope: peekService(ctx, 'root') ?? ctx,
    };
  }
  const port = peekService(ctx, 'webServer')?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError(
      'dsh-im requires the Host apiProxy service, a webServer port, or an explicit harnessBaseUrl',
    );
  }
  return { baseUrl: new URL(`http://127.0.0.1:${port}`) };
}
