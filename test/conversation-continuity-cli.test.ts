import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Store } from '../src/store.ts';

async function until<T>(read: () => T | Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { const value = await read(); if (ready(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Social CLI fixture timed out');
}

test('actual serving reviews a persisted deferral without a prompt and does not replay its final receipt on restart', { skip: process.platform !== 'darwin' }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url)); const directory = mkdtempSync(join(tmpdir(), 'palimpsest-social-cli-'));
  const repo = join(directory, 'repo'), data = join(directory, 'state'), capture = join(directory, 'slack.jsonl'); mkdirSync(repo); mkdirSync(data, { mode: 0o700 });
  for (const path of ['src', 'docs', 'trusted', 'config']) cpSync(join(root, path), join(repo, path), { recursive: true });
  for (const path of ['AGENTS.md', 'GROWTH.md', 'package.json', 'package-lock.json', 'tsconfig.json']) cpSync(join(root, path), join(repo, path));
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Social Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'social fixture baseline');
  const preload = join(directory, 'fixture-transport.mjs');
  writeFileSync(preload, `import { appendFileSync } from 'node:fs';
    globalThis.fetch = async (url, options) => {
      if (String(url) !== 'https://slack.com/api/chat.postMessage') throw new Error('Unexpected provider or transport call in no-inference fixture');
      const body = JSON.parse(options.body); appendFileSync(${JSON.stringify(capture)}, JSON.stringify(body) + '\\n');
      return new Response(JSON.stringify({ ok: true, channel: body.channel, ts: '901.234' }));
    };`);
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, PALIMPSEST_DATA_DIR: data,
    PALIMPSEST_CREDENTIALS_FILE: join(directory, 'absent.env'), PALIMPSEST_PROVIDER: 'mistral', MISTRAL_MODEL: '', MISTRAL_API_KEY: '',
    SLACK_BOT_TOKEN: 'synthetic-slack-token', SLACK_SIGNING_SECRET: 'synthetic-signing-secret', SLACK_ALLOWED_TEAM_IDS: 'T1', SLACK_SELF_MODIFICATION_USER_IDS: 'U1',
    PALIMPSEST_GROWTH_CALLS_PER_DAY: '0', PALIMPSEST_EVOLUTION_CALLS_PER_DAY: '0', PALIMPSEST_INTERACTIVE_EVOLUTION_CALLS_PER_DAY: '0',
    PALIMPSEST_PLAN_PROPOSAL_CALLS_PER_DAY: '0', PALIMPSEST_PLAN_PROPOSAL_CALLS_PER_HOUR: '0' };
  const before = new Store(join(data, 'state.sqlite')); const scope = 'slack:T1:C1:123.456';
  const original = before.enqueue({ source: 'slack', conversationId: scope, input: 'A question deferred without a promise.', slackAuthor: { teamId: 'T1', userId: 'U1' } });
  before.updateTask(original.id, { state: 'running', checkpoint: { calls: 0, replyTo: '123.456' } });
  const topicId = before.prepareConversationTopics(original.id, [{ outcome: { question: 'Which name fits?', stance: 'A provisional preference.', rationale: 'Independent but unverified judgment.', unresolved: ['Historical collision.'], status: 'pending' } }], [],
    { now: Date.now() - 120_000, reviewMs: 1, lifetimeMs: 1000, maxAttempts: 2 })[0]!.id;
  before.reserveEffect({ id: `${original.id}:result`, taskId: original.id, kind: 'communication', payload: { fixture: 'acknowledged exchange' } });
  before.completeEffect(`${original.id}:result`, { delivered: true, receipt: { transport: 'slack', messageId: '900.123' } });
  before.finishConversationTask(original.id, 'A provisional reply.', { scope, kind: 'episodic', content: 'A provisional exchange.', source: `task:${original.id}`, confidence: 0.6 }); before.close();
  let child: ChildProcess | undefined; let output = '', errors = '';
  const stop = async () => {
    if (child && child.exitCode === null) { const exited = new Promise<void>(resolve => child!.once('exit', () => resolve())); child.kill('SIGTERM'); const timer = setTimeout(() => child!.kill('SIGKILL'), 10_000); await exited; clearTimeout(timer); assert.equal(child.exitCode, 0, errors); }
    child = undefined;
  };
  const start = async () => {
    output = ''; errors = ''; child = spawn(process.execPath, ['--import', preload, join(root, 'src/cli.ts'), 'serve'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { errors += chunk; });
    const line = await until(() => { if (child!.exitCode !== null) throw new Error(errors); return output.split('\n').find(line => line.includes('"url"')); }, line => line !== undefined);
    return JSON.parse(line!) as { url: string; tokenFile: string };
  };
  try {
    const first = await start(); const headers = { authorization: `Bearer ${readFileSync(first.tokenFile, 'utf8')}` };
    await until(() => existsSync(capture) ? readFileSync(capture, 'utf8').trim() : '', Boolean);
    const events = await until(async () => await (await fetch(first.url + '/events', { headers })).json() as Array<{ type: string }>, events => events.filter(event => event.type === 'effect.completed').length === 2);
    assert.equal(events.filter(event => event.type === 'inference.started').length, 0);
    const body = JSON.parse(readFileSync(capture, 'utf8').trim()); assert.equal(body.channel, 'C1'); assert.equal(body.thread_ts, '123.456'); assert.match(body.text, /inconclusive/i);
    await stop(); const observed = new Store(join(data, 'state.sqlite'));
    const topic = observed.conversationTopic(topicId)!; assert.equal(topic.report.owedRevision, null);
    assert.deepEqual(topic.report.receipt, { delivered: true, receipt: { transport: 'slack', messageId: '901.234' } }); assert.equal(observed.listTasks().length, 2); observed.close();
    const second = await start(); assert.equal((await fetch(second.url + '/events', { headers })).status, 200); await stop();
    assert.equal(readFileSync(capture, 'utf8').trim().split('\n').length, 1, 'restart must not replay the confirmed final delivery');
    assert.doesNotMatch(output + errors, /synthetic-slack-token|synthetic-signing-secret/);
  } finally { await stop(); rmSync(directory, { recursive: true, force: true }); }
});
