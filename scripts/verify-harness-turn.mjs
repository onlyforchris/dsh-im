// Exercise the real DSH gateway and agent loop with an offline model and no IM credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const host = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Pass the directory containing the original DSH node_modules.');
const root = resolve(process.argv[3] ?? join(import.meta.dirname, '..'));
const run = await mkdtemp(join(resolve(import.meta.dirname, '..'), '.harness-turn-'));
const profile = join(run, 'home/profiles/web');
const probe = join(run, 'probe');
await mkdir(profile, { recursive: true });
await mkdir(probe);
const url = path => JSON.stringify(pathToFileURL(path).href);
await writeFile(join(probe, 'package.json'), JSON.stringify({ name: 'im-turn-probe', type: 'module', main: 'index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' }, compatibility: { dshReleases: { '0.2.1-rc.2': 'compatible' }, profiles: ['web'] } } }));
await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - id: im-turn-probe\n      name: im-turn-probe\n');
await writeFile(join(probe, 'index.mjs'), `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { LlmAdapter } from ${url(join(host, 'node_modules/@deepseek-ai/dsh-llm/lib/index.js'))};
import { HarnessClient } from ${url(join(root, 'src/channels/shared/harness-client.mjs'))};
import { harnessConnection } from ${url(join(root, 'plugin-src/host/harness-connection.mjs'))};
import { createHarnessCommandExecutor } from ${url(join(root, 'plugin-src/host/harness-command-executor.mjs'))};
class OfflineAdapter extends LlmAdapter {
  async listModels(provider) { return [{ provider, id: 'echo', name: 'Offline smoke', contextWindow: 64000 }]; }
  async *stream() {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'IM_SMOKE_OK' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'IM_SMOKE_OK' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export function apply(parent) {
  console.log('IM_SMOKE_PROBE_LOADED');
  parent.inject(['llm', 'typertGateway', 'connection'], ctx => {
    console.log('IM_SMOKE_SERVICES_READY');
    ctx.llm.registerAdapter(['im-smoke'], new OfflineAdapter());
    const timer = setTimeout(async () => {
      const results = [];
      try {
        for (const mode of ['plain', 'live']) {
          const client = new HarnessClient({ ...harnessConnection(ctx), commandExecutor: createHarnessCommandExecutor(ctx), workspace: ${JSON.stringify(run)}, rpcIdPrefix: 'im-smoke' });
          const sessionId = await client.createSession();
          await client.selectSessionModel(sessionId, { provider: 'im-smoke', model: 'echo' });
          const updates = [];
          const answer = await client.ask(sessionId, 'Offline smoke: reply briefly.', {
            timeoutMs: 10000, signal: AbortSignal.timeout(20000),
            ...(mode === 'live' ? { progressMode: 'live', onUpdate: update => updates.push(update), onInteraction: () => {} } : {}),
          });
          assert.equal(answer, 'IM_SMOKE_OK');
          const command = await client.executeCommand(sessionId, '/compact', { signal: AbortSignal.timeout(10000) });
          assert.equal(typeof command.commandId, 'string');
          results.push({ mode, answer, updates: updates.length, compact: command.result.kind });
        }
        await writeFile(${JSON.stringify(join(run, 'result.json'))}, JSON.stringify({ ok: true, results }));
      } catch (error) {
        await writeFile(${JSON.stringify(join(run, 'result.json'))}, JSON.stringify({ ok: false, results, error: { name: error.name, code: error.code, message: error.message, stack: error.stack, details: error.details, reason: error.reason } }));
      }
    }, 1000);
    ctx.effect(() => () => clearTimeout(timer));
  });
}
`);
const packages = {
  '@deepseek-ai/dsh-base': join(host, 'node_modules/@deepseek-ai/dsh-base'),
  '@deepseek-ai/dsh-web-app': join(host, 'node_modules/@deepseek-ai/dsh-web-app'),
  '@onlyforchris/dsh-im': root,
  'im-turn-probe': probe,
};
for (const [name, target] of Object.entries(packages)) {
  const link = join(profile, 'node_modules', name);
  await mkdir(dirname(link), { recursive: true });
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'im-smoke', private: true, dependencies: Object.fromEntries(Object.entries(packages).map(([name, path]) => [name, `link:${path}`])), dsh: { profile: { bundles: Object.keys(packages) } } }));
await writeFile(join(profile, 'cordis.yml'), '[]\n');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DSH_/i.test(key) && !/(?:KEY|SECRET|TOKEN|PASSWORD|PROXY)/i.test(key)));
let output = '';
const child = spawn(process.execPath, [join(host, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
  cwd: run, env: { ...env, DSH_HOME: join(run, 'home'), DSH_AGENTS_HOME: join(run, 'agents'), DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logging = Promise.resolve();
function capture(value) {
  output += value;
  logging = logging.then(() => writeFile(join(run, 'host.log'), output.replace(/([?&]token=)[^\s)]+/g, '$1<redacted>')));
}
child.stdout.on('data', capture);
child.stderr.on('data', capture);
try {
  const deadline = Date.now() + 60000;
  let result;
  while (Date.now() < deadline) {
    try { result = JSON.parse(await readFile(join(run, 'result.json'), 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (child.exitCode !== null) break;
    await delay(200);
  }
  await logging;
  console.log(JSON.stringify({ directory: run, ...result }, null, 2));
  assert(result?.ok, 'Real DSH turn failed; inspect result.json and host.log in the reported directory.');
} finally {
  const exited = new Promise(done => child.once('exit', done));
  if (child.exitCode === null) { child.kill(); await exited; }
}
