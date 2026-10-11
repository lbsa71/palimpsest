import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, release, tmpdir, version } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mock, test } from 'node:test';
import { canonicalJson } from '../../packages/contracts/common.ts';
import { PINNED_CODEX_VERSION, PINNED_CODEX_SHA256, PINNED_CODEX_HELPER_SHA256 } from './codex-native-protocol.ts';
import { PINNED_CLAUDE_DELEGATION_BETA, PINNED_CLAUDE_SHA256, PINNED_CLAUDE_VERSION } from './anthropic-native-protocol.ts';
import { assertNativeProcessLifetime, NativeSessionEvents } from './native-recovery.ts';
import { runNativeBaseline } from './run-native.ts';
import type { NativeBaselineRun, NativeBaselineResult } from './run-native.ts';
import type { ObserverGrant } from './observer.ts';
import type { WorkerOptions } from '../../packages/supervisor/worker-process.ts';

type Kind = 'codex' | 'claude';
type Phase = 'write' | 'read';
const evidenceParent = '/home/palimpsest/migration/aeon-1-20261011/native-recovery-physical-evidence';
const repository = new URL('../../', import.meta.url).pathname;
const procedure = join(repository, 'docs/rewrite/evidence/A1-L08/native-recovery-acquisition.md');
const marker = 'native-recovery-write-observed';
const file = 'recovery-observed.txt';
const sentinel = 'PRIVATE_NATIVE_RECOVERY_CONTROL';
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fileHash = (path: string) => hash(readFileSync(path));
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
const kernelIdentity = () => ({ platform: platform(), architecture: arch(), release: release(), version: version() });
function command(phase: Phase): string {
  return phase === 'write'
    ? `/runtime/node -e 'require("node:fs").writeFileSync("${file}","${marker}");console.log("${marker}")'`
    : `/runtime/node -e 'console.log(require("node:fs").readFileSync("${file}","utf8"))'`;
}
function tool(kind: Kind, phase: Phase): any {
  return kind === 'codex'
    ? { type: 'custom_tool_call', id: `fc_recovery_${phase}`, call_id: `call_recovery_${phase}`, name: 'exec', namespace: 'functions', input: `text(await tools.exec_command(${JSON.stringify({ cmd: command(phase), max_output_tokens: 1000, yield_time_ms: 1000 })}));` }
    : { type: 'tool_use', id: `tool_recovery_${phase}`, name: 'Bash', input: { command: command(phase), description: 'Observe the public recovery artifact', timeout: 5000 } };
}
function grant(kind: Kind): ObserverGrant {
  const model = kind === 'codex' ? 'gpt-6-astra' : 'claude-opus-5-5';
  return { id: `original-${kind}-native-recovery-acquisition-1`, resources: { maxRequests: 8, maxTokens: 8 * ((kind === 'codex' ? 200_000 : 1_000_000) + 4096), maxCostUsd: 100, maxElapsedMs: 60_000, maxConcurrency: 4 },
    profile: { provider: kind === 'codex' ? 'openai' : 'anthropic', model, effort: 'high', contextContract: 'Original full-context synthetic rehearsal contract; no prompt token estimate or paid grant', contextWindowTokens: kind === 'codex' ? 200_000 : 1_000_000, maxOutputTokens: 4096,
      prices: { source: 'synthetic fixture category rates; no provider pricing', inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20, ...(kind === 'claude' ? { cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8 } : {}) },
      ...(kind === 'codex' ? { codexNativeProtocol: { kind: 'agent-message-v1' as const, codexVersion: PINNED_CODEX_VERSION, codexSha256: PINNED_CODEX_SHA256, helperSha256: PINNED_CODEX_HELPER_SHA256, qualification: 'synthetic-only' as const } }
        : { anthropic: { thinking: 'adaptive' as const, serviceTier: 'standard' as const, inferenceGeo: 'global' as const, speed: 'standard' as const, nativeProtocol: { kind: 'opus-adaptive-delegation' as const, claudeVersion: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256, version: '2023-06-01' as const, beta: PINNED_CLAUDE_DELEGATION_BETA, qualification: 'synthetic-only' as const } } }) },
    requestTimeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 };
}
function responseBytes(kind: Kind, blocks: any[], ordinal: number): string {
  const model = grant(kind).profile.model;
  let events: any[];
  if (kind === 'codex') {
    const response = { id: `resp_recovery_${ordinal}`, status: 'completed', model, output: blocks, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, ...blocks.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item })), { type: 'response.completed', response }];
  } else {
    events = [{ type: 'message_start', message: { id: `msg_recovery_${ordinal}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1, service_tier: 'standard', inference_geo: 'global', speed: 'standard' } } }];
    for (const [index, block] of blocks.entries()) events.push({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } }, { type: 'content_block_stop', index });
    events.push({ type: 'message_delta', delta: { stop_reason: blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' });
  }
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}
export function publicPlan(kind: Kind) {
  const phases = (['write', 'read'] as Phase[]).map((phase, index) => {
    const final = `native-recovery-${phase}-complete`;
    const terminal = kind === 'codex' ? { type: 'message', id: `msg_recovery_${phase}`, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: final, annotations: [] }] } : { type: 'text', text: final };
    return { phase, prompt: phase === 'write' ? `Write ${file} containing ${marker} with one local command, report its observed contents and finish. Do not create agents or use external services.` : `Read ${file} with one local command, report its observed contents and finish. Do not create agents or use external services.`, command: command(phase), tool: tool(kind, phase), final,
      replies: [responseBytes(kind, [tool(kind, phase)], index * 2 + 1), responseBytes(kind, [terminal], index * 2 + 2)].map(body => ({ status: 200, contentType: 'text/event-stream', body, sha256: hash(body) })) };
  });
  return { kind, grant: grant(kind), phases, file, marker, maxRequestsPerPhase: 2, qualification: 'namespace-fixture', tmpBytes: 67108864, seal: { files: 256, entries: 512, bytes: 16 * 1024 * 1024 }, runtimeResourceEnforcement: false };
}
function pinnedNative(kind: Kind): NativeBaselineRun['native'] {
  const path = kind === 'codex' ? realpathSync('/home/palimpsest/.local/bin/codex') : '/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/claude-2.1.296';
  const files = [{ path, name: kind, sha256: kind === 'codex' ? PINNED_CODEX_SHA256 : PINNED_CLAUDE_SHA256 }, ...(kind === 'codex' ? [{ path: join(dirname(path), 'codex-code-mode-host'), name: 'codex-code-mode-host', sha256: PINNED_CODEX_HELPER_SHA256 }] : [])];
  for (const item of files) assert.equal(fileHash(item.path), item.sha256, 'pinned native closure changed');
  return { version: kind === 'codex' ? PINNED_CODEX_VERSION : PINNED_CLAUDE_VERSION, files };
}
/** Read-only preparation: root can serialize this exact object into its clearance.
 * Does not create a marker, namespace, CLI, bridge, grant or native session. */
export function acquisitionFreeze(kind: Kind) {
  assert.ok(kind === 'codex' || kind === 'claude');
  const git = (args: string[]) => { const result = spawnSync('/usr/bin/git', args, { cwd: repository, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  assert.equal(git(['status', '--porcelain']), '', 'physical source must be clean');
  const sourceFiles = ['packages', 'evaluations/baselines'].flatMap(directory => readdirSync(join(repository, directory), { recursive: true, encoding: 'utf8' })
    .filter(path => /\.(ts|mjs)$/.test(path) && !path.endsWith('.test.ts')).map(path => ({ path: `${directory}/${path}`, sha256: fileHash(join(repository, directory, path)) }))).sort((a, b) => a.path.localeCompare(b.path));
  return { kind, sourceRevision: git(['rev-parse', 'HEAD']), driverSha256: fileHash(new URL(import.meta.url).pathname), procedureSha256: fileHash(procedure), sourceFiles, sourceManifestSha256: hash(canonicalJson(sourceFiles)),
    node: { path: realpathSync(process.execPath), version: process.versions.node, sha256: fileHash(process.execPath) }, kernelIdentity: kernelIdentity(),
    hostTools: ['/usr/bin/bash', '/usr/bin/bwrap', '/usr/bin/setpriv', '/usr/bin/prlimit'].map(path => ({ path, sha256: fileHash(realpathSync(path)) })), native: pinnedNative(kind), publicPlanSha256: hash(canonicalJson(publicPlan(kind))),
    claudeHelp: kind === 'claude' ? { path: '/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/help-output.txt', sha256: fileHash('/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/help-output.txt') } : null };
}
function consumeAttempt(root: string, kind: Kind): void {
  mkdirSync(root, { mode: 0o700 }); // EEXIST is final; no temporary retry directory.
  const fd = openSync(join(root, 'attempt.json'), 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ kind, ordinal: 1, consumedAt: Date.now(), hostPid: process.pid, retry: false })); fsyncSync(fd); } finally { closeSync(fd); }
  for (const path of [root, dirname(root)]) { const directory = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(directory); } finally { closeSync(directory); } }
}
function assertResult(kind: Kind, request: any, id: string, expected: string): void {
  if (kind === 'codex') {
    const results = request.input?.filter((item: any) => item.type === 'custom_tool_call_output' && item.call_id === id);
    assert.equal(results?.length, 1, 'one original attributed command result required');
    const output = results[0].output;
    assert.equal(output?.length, 2); assert.equal(output[0].type, 'input_text');
    assert.match(output[0].text, /^Script completed\nWall time [0-9]+(?:\.[0-9]+)? seconds\nOutput:\n$/);
    assert.equal(output[1].type, 'input_text'); const value = JSON.parse(output[1].text);
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    assert.ok(Object.keys(value).every(key => ['chunk_id', 'wall_time_seconds', 'exit_code', 'original_token_count', 'output'].includes(key)));
    assert.ok(typeof value.chunk_id === 'string' && value.chunk_id.length > 0);
    assert.ok(Number.isFinite(value.wall_time_seconds) && value.wall_time_seconds >= 0);
    assert.ok(Number.isSafeInteger(value.original_token_count) && value.original_token_count >= 0);
    assert.equal(value.exit_code, 0); assert.equal(value.output, `${expected}\n`);
  } else {
    const results = request.messages?.filter((message: any) => message.role === 'user').flatMap((message: any) => Array.isArray(message.content) ? message.content : []).filter((part: any) => part.type === 'tool_result' && part.tool_use_id === id);
    assert.equal(results?.length, 1, 'one original attributed Bash result required');
    assert.ok(equal(results[0], { type: 'tool_result', tool_use_id: id, content: expected, is_error: false }), 'exact acquired successful Bash envelope required');
  }
}
function protocolSequence(kind: Kind, request: any): { item: any; role: string | undefined }[] {
  if (kind === 'codex') {
    assert.ok(Array.isArray(request.input));
    return request.input.map((item: any) => { assert.ok(item && typeof item === 'object' && !Array.isArray(item)); return { item, role: item.role }; });
  }
  assert.ok(Array.isArray(request.messages));
  return request.messages.flatMap((message: any) => {
    assert.ok(message && typeof message === 'object' && typeof message.role === 'string');
    if (!Array.isArray(message.content)) { assert.equal(typeof message.content, 'string'); return []; }
    return message.content.map((item: any) => { assert.ok(item && typeof item === 'object' && !Array.isArray(item)); return { item, role: message.role }; });
  });
}
function operationSequence(kind: Kind, sequence: { item: any; role: string | undefined }[]) {
  return sequence.filter(({ item }) => {
    const supported = kind === 'codex' ? ['custom_tool_call', 'custom_tool_call_output'] : ['tool_use', 'tool_result'];
    const operation = supported.includes(item.type) || typeof item.type === 'string' && /(?:_call(?:_output)?$|tool_use|tool_result)/.test(item.type)
      || 'call_id' in item || 'tool_use_id' in item || 'name' in item && 'input' in item;
    if (operation) assert.ok(supported.includes(item.type), 'unsupported operation frame in acquisition history');
    return operation;
  });
}
function assertNoObservation(kind: Kind, request: any): void {
  assert.equal(operationSequence(kind, protocolSequence(kind, request)).length, 0, 'initial request cannot contain a prior command/result');
}
function assertObservation(kind: Kind, request: any, phase: Phase) {
  const sequence = protocolSequence(kind, request), operations = operationSequence(kind, sequence);
  const phases: Phase[] = phase === 'write' ? ['write'] : ['write', 'read'];
  assert.equal(operations.length, phases.length * 2, 'complete exact allowed command/result set required');
  for (const [index, observed] of phases.entries()) {
    const expected = tool(kind, observed), call = operations[index * 2]!, result = operations[index * 2 + 1]!;
    assert.equal(call.role, kind === 'codex' ? undefined : 'assistant');
    assert.ok(equal(call.item, expected), 'original actual command differs from frozen public call/order');
    assert.equal(result.role, kind === 'codex' ? undefined : 'user');
    assert.equal(result.item.type, kind === 'codex' ? 'custom_tool_call_output' : 'tool_result');
    assert.equal(kind === 'codex' ? result.item.call_id : result.item.tool_use_id, kind === 'codex' ? expected.call_id : expected.id);
    if (kind === 'codex') assert.ok(Object.keys(result.item).every(key => ['type', 'id', 'call_id', 'output'].includes(key)), 'unsupported command-result fields');
    assertResult(kind, request, kind === 'codex' ? expected.call_id : expected.id, marker);
  }
  const writeResultIndex = sequence.indexOf(operations[1]!), readCallIndex = phase === 'read' ? sequence.indexOf(operations[2]!) : undefined;
  if (phase === 'read') assertWriteTerminal(kind, sequence, writeResultIndex, readCallIndex);
  return { sequence, writeResultIndex, readCallIndex };
}
function assertWriteTerminal(kind: Kind, sequence: { item: any; role: string | undefined }[], writeResultIndex: number, readCallIndex?: number): void {
  const final = 'native-recovery-write-complete';
  const terminals = sequence.map(({ item, role }, index) => ({ item, role, index })).filter(({ item, role }) => {
    if (role !== 'assistant') return false;
    if (kind === 'claude') return item.type === 'text' && item.text === final;
    return item.type === 'message' && Array.isArray(item.content) && item.content.length === 1 && item.content[0].type === 'output_text' && item.content[0].text === final;
  });
  assert.equal(terminals.length, 1, 'one original terminal assistant frame required');
  assert.ok(terminals[0]!.index > writeResultIndex, 'prior terminal must follow its successful command result');
  if (readCallIndex !== undefined) assert.ok(terminals[0]!.index < readCallIndex, 'prior terminal must precede current read command');
}
function assertHistory(kind: Kind, request: any, readObserved?: boolean): void {
  const sequence = protocolSequence(kind, request), expectedRead = tool(kind, 'read');
  const hasRead = readObserved ?? sequence.some(({ item }) => kind === 'codex' ? item.type === 'custom_tool_call' && item.call_id === expectedRead.call_id : item.type === 'tool_use' && item.id === expectedRead.id);
  const checked = assertObservation(kind, request, hasRead ? 'read' : 'write');
  assertWriteTerminal(kind, checked.sequence, checked.writeResultIndex, checked.readCallIndex);
}
function instructions(kind: Kind, request: any) {
  const { input, messages, ...control } = request;
  return { control, instructions: kind === 'codex' ? input.filter((item: any) => item.role === 'system' || item.role === 'developer' || item.type === 'additional_tools') : messages.filter((message: any) => message.role === 'system' || message.role === 'developer') };
}
class Sequence {
  phase: Phase = 'write'; counts = { write: 0, read: 0 }; active = 0;
  enter(): number { assert.equal(this.active, 0, 'overlapping/child request is unsupported'); assert.ok(++this.counts[this.phase] <= 2, 'third phase request is unsupported'); this.active++; return this.counts[this.phase]; }
  leave(): void { this.active--; }
  resume(): void { assert.equal(this.phase, 'write'); assert.equal(this.counts.write, 2); assert.equal(this.active, 0); this.phase = 'read'; }
}
function hostControl() {
  return { pid: process.pid, bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), observedAt: Date.now(), stat: readFileSync('/proc/self/stat', 'utf8'), cgroup: readFileSync('/proc/self/cgroup', 'utf8'), namespaces: Object.fromEntries(['pid', 'mnt', 'net', 'user'].map(name => [name, readlinkSync(`/proc/self/ns/${name}`)])), kernelIdentity: kernelIdentity() };
}
function databaseRows(filename: string): { documents: any[]; events: any[]; artifacts: { digest: string; bytes: Uint8Array }[] } {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    return { documents: db.prepare('SELECT namespace,key,revision,value FROM documents ORDER BY namespace,key').all().map((row: any) => ({ ...row, value: JSON.parse(row.value) })),
      events: db.prepare('SELECT sequence,id,stream,type,data FROM events ORDER BY sequence').all().map((row: any) => ({ ...row, data: JSON.parse(row.data) })), artifacts: db.prepare('SELECT digest,bytes FROM artifacts ORDER BY digest').all() as { digest: string; bytes: Uint8Array }[] };
  } finally { db.close(); }
}
function workspaceBytes(workspace: string) {
  const entries: any[] = []; let bytes = 0, files = 0;
  const visit = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory).sort()) {
      assert.ok(entries.length < 512, 'snapshot entry ceiling reached; original workspace retained');
      const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name, stat = lstatSync(path);
      const entry: any = { path: relative, mode: stat.mode & 0o7777, size: stat.size, kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'unsupported' }; entries.push(entry);
      assert.equal(stat.uid, process.getuid!());
      if (stat.isDirectory()) visit(path, relative);
      else { assert.ok(stat.isFile() && stat.nlink === 1, 'unsupported workspace entry; original bytes retained without following'); assert.ok(++files <= 256 && (bytes += stat.size) <= 16 * 1024 * 1024, 'snapshot byte/file ceiling reached; original bytes retained'); const content = readFileSync(path); entry.sha256 = hash(content); entry.base64 = content.toString('base64'); }
    }
  };
  visit(workspace, ''); return entries;
}
function snapshot(root: string, name: string) {
  const state = join(root, 'state'), documents: any[] = []; let events: any[] = [];
  if (existsSync(join(state, 'observer.sqlite'))) {
    const rows = databaseRows(join(state, 'observer.sqlite')); documents.push(...rows.documents); events = rows.events;
    mkdirSync(join(root, 'artifacts'), { recursive: true, mode: 0o700 });
    for (const item of rows.artifacts) { assert.equal(hash(item.bytes), item.digest, 'stored artifact corruption'); const path = join(root, 'artifacts', item.digest); if (!existsSync(path)) writeFileSync(path, item.bytes, { flag: 'wx', mode: 0o600 }); else assert.equal(fileHash(path), item.digest); }
  }
  let lease: unknown = null;
  if (existsSync(join(state, 'lease.sqlite'))) { const db = new DatabaseSync(join(state, 'lease.sqlite'), { readOnly: true }); try { lease = db.prepare('SELECT * FROM owner').all(); } finally { db.close(); } }
  const rawState = join(root, `${name}-databases`); mkdirSync(rawState, { mode: 0o700 });
  for (const database of ['observer.sqlite', 'lease.sqlite']) for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(join(state, database + suffix))) copyFileSync(join(state, database + suffix), join(rawState, database + suffix), constants.COPYFILE_EXCL);
  // Database/control export precedes bounded workspace inspection, preserving refusals even when native files are unsupported.
  const result: any = { host: hostControl(), documents, events, lease, rawState, artifactDirectory: join(root, 'artifacts'), workspace: null };
  try { result.workspace = workspaceBytes(join(root, 'workspace')); } catch (error) { result.workspaceExportError = String(error); }
  json(join(root, `${name}.json`), result); return result;
}
function rows(snapshot: any, namespace: string) { return snapshot.documents.filter((row: any) => row.namespace === namespace); }
function value(snapshot: any, namespace: string, key: string): any { const row = rows(snapshot, namespace).find((row: any) => row.key === key); assert.ok(row, `${namespace}/${key} absent`); return row; }
function artifact(snapshot: any, ref: any): any {
  assert.match(ref.sha256, /^[a-f0-9]{64}$/); assert.equal(ref.uri, `aeon:artifact:${ref.sha256}`);
  const bytes = readFileSync(join(snapshot.artifactDirectory, ref.sha256)); assert.equal(hash(bytes), ref.sha256); return JSON.parse(bytes.toString());
}
function assertReady(snapshot: any, result: NativeBaselineResult, expectedCount: number, kind: Kind) {
  assert.equal(snapshot.workspaceExportError, undefined); assert.deepEqual(snapshot.lease, []);
  assert.ok(result.checkpoint); const checkpoint = value(snapshot, 'native-checkpoints', result.checkpoint.id);
  assert.equal(checkpoint.revision, result.checkpoint.revision); assert.equal(checkpoint.value.status, 'ready');
  assert.equal(rows(snapshot, 'allocations').length, 1); assert.equal(rows(snapshot, 'budgets').length, 1);
  const budget = value(snapshot, 'budgets', grant(kind).id).value;
  assert.equal(budget.cancelled, false); assert.ok(equal(budget.envelope, grant(kind).resources));
  assert.equal(checkpoint.value.originalStartedAt, budget.startedAt); assert.equal(checkpoint.value.originalDeadline, budget.startedAt + 60_000);
  assert.ok(equal(checkpoint.value.manifest, result.manifest)); assert.ok(equal(checkpoint.value.result, result.result));
  const manifest = artifact(snapshot, result.manifest), cleanup = artifact(snapshot, checkpoint.value.cleanup);
  assert.equal(manifest.generation, expectedCount / 2); assert.equal(manifest.fixtureMaxRequestsPerLaunch, 2); assert.ok(equal(manifest.grant, grant(kind)));
  assert.equal(cleanup.observation, 'runWorker returned after awaited confinement cleanup'); assert.equal(cleanup.generation, manifest.generation); assert.equal(cleanup.nativeExit, 0); assert.equal(cleanup.nativeSignal, null); assert.equal(cleanup.pendingOperations, 0); assert.equal(cleanup.namespace, 'PID namespace drained on owner exit'); assert.equal(cleanup.kernel, null);
  const launch = value(snapshot, 'baseline-launches', String(manifest.generation)); assert.equal(launch.value.status, 'completed'); assert.ok(equal(launch.value.manifest, result.manifest)); assert.ok(equal(launch.value.result, result.result)); assert.ok(equal(artifact(snapshot, result.result), result.outcome));
  assert.equal(rows(snapshot, 'requests').length, expectedCount);
  for (const row of rows(snapshot, 'requests')) { assert.equal(row.value.request.status, 'succeeded'); assert.equal(row.value.charged.tokens, 110); assert.equal(row.value.charged.costUsd, 0.0006); }
  assert.equal(rows(snapshot, 'baseline-attempts').length, expectedCount); assert.equal(result.physicalRequests, expectedCount);
  assert.ok(snapshot.workspace.some((entry: any) => entry.path === file && entry.base64 === Buffer.from(marker).toString('base64')));
  const outcome: any = result.outcome; assert.equal(outcome.code, 0, outcome.stderr); assert.equal(outcome.signal, null); assert.equal(outcome.exceeded, false); assert.equal(outcome.recoveryError, null);
  const context = artifact(snapshot, launch.value.context);
  assertNativeProcessLifetime(outcome.nativeProcess, context, true);
  assert.equal(context.generation, manifest.generation); assert.equal(context.manifestSha256, result.manifest.sha256); assert.equal(context.hostPid, snapshot.host.pid); assert.equal(context.hostBootId, snapshot.host.bootId);
  assert.ok(equal(cleanup.launchContext, launch.value.context)); assert.ok(equal(cleanup.manifest, result.manifest)); assert.ok(equal(cleanup.result, result.result));
  assert.ok(BigInt(context.startedNs) < BigInt(cleanup.completedNs));
  assert.equal(outcome.nativeProcess.close.code, outcome.code); assert.equal(outcome.nativeProcess.close.signal, outcome.signal);
  assert.notEqual(outcome.nativeProcess.pidNamespaceBefore, snapshot.host.namespaces.pid, 'native must be observed in the isolated PID namespace');
  const gate = new NativeSessionEvents(kind, undefined, 1_000_000); gate.feed(Buffer.from(outcome.stdout)); assert.equal(gate.finish().sessionId, checkpoint.value.sessionId);
  const final = expectedCount === 2 ? 'native-recovery-write-complete' : 'native-recovery-read-complete';
  const events = outcome.stdout.split('\n').filter(Boolean).map((line: string) => JSON.parse(line));
  assert.ok(events.some((event: any) => kind === 'codex' ? event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text === final : event.type === 'result' && event.subtype === 'success' && event.is_error === false && event.result === final), 'actual native terminal frame must contain the exact public final');
}
function assertDistinctLaunches(receipts: any[]): void {
  assert.equal(receipts.length, 2);
  for (const [index, receipt] of receipts.entries()) {
    assert.equal(receipt.generation, index + 1); assert.equal(receipt.phase, index === 0 ? 'write' : 'read');
    assertNativeProcessLifetime(receipt.nativeProcess, receipt.context, true);
    assert.equal(receipt.context.generation, receipt.generation); assert.equal(receipt.context.manifestSha256, receipt.manifest.sha256);
    assert.equal(hash(canonicalJson(receipt.context)), receipt.launchContext.sha256); assert.equal(hash(canonicalJson(receipt.cleanup)), receipt.cleanupRef.sha256);
    assert.equal(hash(canonicalJson(receipt.outcome)), receipt.result.sha256); assert.ok(equal(receipt.outcome.nativeProcess, receipt.nativeProcess));
    assert.equal(receipt.nativeProcess.close.code, receipt.outcome.code); assert.equal(receipt.nativeProcess.close.signal, receipt.outcome.signal);
    assert.equal(receipt.cleanup.observation, 'runWorker returned after awaited confinement cleanup'); assert.equal(receipt.cleanup.generation, receipt.generation);
    assert.ok(equal(receipt.cleanup.launchContext, receipt.launchContext)); assert.ok(equal(receipt.cleanup.manifest, receipt.manifest)); assert.ok(equal(receipt.cleanup.result, receipt.result));
    assert.equal(receipt.cleanup.nativeExit, 0); assert.equal(receipt.cleanup.nativeSignal, null); assert.equal(receipt.cleanup.pendingOperations, 0);
    assert.match(receipt.cleanup.completedNs, /^[1-9][0-9]*$/); assert.ok(BigInt(receipt.context.startedNs) < BigInt(receipt.cleanup.completedNs));
  }
  const [first, second] = receipts;
  assert.equal(first.sessionId, second.sessionId); assert.equal(first.context.hostBootId, second.context.hostBootId); assert.equal(first.context.hostPid, second.context.hostPid);
  assert.equal(second.context.priorCleanupSha256, first.cleanupRef.sha256); assert.ok(BigInt(first.cleanup.completedNs) < BigInt(second.context.startedNs), 'predecessor awaited cleanup must precede next launch');
  assert.ok(BigInt(first.nativeProcess.startTicks) < BigInt(second.nativeProcess.startTicks), 'reused or colliding native start ticks cannot prove distinct process lifetimes');
  assert.notEqual(first.manifest.sha256, second.manifest.sha256); assert.notEqual(first.launchContext.sha256, second.launchContext.sha256);
}

// Unchanged acquired result frames: Codex original request artifact d1f18479…,
// Claude original request artifact 0034890f…; complete source paths in procedure.
const acquiredCodexResult = { type: 'custom_tool_call_output', id: 'ctco_01a12c81-37d7-7362-8230-48bc4497cdbd', call_id: 'call_fixture', output: [{ type: 'input_text', text: 'Script completed\nWall time 1.4 seconds\nOutput:\n' }, { type: 'input_text', text: '{"chunk_id":"9bcf36","wall_time_seconds":1.244120117,"exit_code":0,"original_token_count":29,"output":"native-pids-refused 11\\nnative-storage-refused 28\\nnative-inodes-refused 28\\nnative-kernel-proof\\nnative-observer-proof\\n"}' }] };
const acquiredCodexOutput = 'native-pids-refused 11\nnative-storage-refused 28\nnative-inodes-refused 28\nnative-kernel-proof\nnative-observer-proof';
const acquiredClaudeResult = { tool_use_id: 'tool_child_1', type: 'tool_result', content: 'child-2-observed', is_error: false };
test('acquisition checks unchanged acquired result frames and rejects wrong attribution/failed results', () => {
  for (const kind of ['codex', 'claude'] as Kind[]) {
    const request: any = kind === 'codex' ? { input: [structuredClone(acquiredCodexResult)] } : { messages: [{ role: 'user', content: [structuredClone(acquiredClaudeResult)] }] };
    const id = kind === 'codex' ? 'call_fixture' : 'tool_child_1', output = kind === 'codex' ? acquiredCodexOutput : 'child-2-observed';
    assertResult(kind, request, id, output);
    assert.throws(() => assertResult(kind, request, 'wrong-original-call', output));
    const bad = structuredClone(request);
    if (kind === 'codex') { const value = JSON.parse(bad.input[0].output[1].text); value.exit_code = 7; bad.input[0].output[1].text = JSON.stringify(value); } else bad.messages[0].content[0].is_error = true;
    assert.throws(() => assertResult(kind, bad, id, output));
  }
});
test('acquisition history check rejects prompt-only marker, missing actual call and missing terminal', () => {
  for (const kind of ['codex', 'claude'] as Kind[]) {
    const output = structuredClone(acquiredCodexResult); output.call_id = 'call_recovery_write'; const parsed = JSON.parse(output.output[1]!.text); parsed.output = `${marker}\n`; output.output[1]!.text = JSON.stringify(parsed);
    const request: any = kind === 'codex' ? { input: [tool(kind, 'write'), output, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'native-recovery-write-complete' }] }] }
      : { messages: [{ role: 'assistant', content: [tool(kind, 'write')] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_recovery_write', content: marker, is_error: false }] }, { role: 'assistant', content: [{ type: 'text', text: 'native-recovery-write-complete' }] }] };
    assertHistory(kind, request);
    const missing = structuredClone(request); (kind === 'codex' ? missing.input : missing.messages).shift(); assert.throws(() => assertHistory(kind, missing));
    const noTerminal = structuredClone(request); (kind === 'codex' ? noTerminal.input : noTerminal.messages).pop(); assert.throws(() => assertHistory(kind, noTerminal));
    assert.throws(() => assertHistory(kind, kind === 'codex' ? { input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: marker }] }] } : { messages: [{ role: 'user', content: marker }] }));
    assert.equal(publicPlan(kind).phases[1]!.prompt.includes(marker), false);
  }
});
for (const kind of ['codex', 'claude'] as Kind[]) test(`${kind} complete acquisition history keeps ordered two-phase positive and rejects foreign/duplicate/role/type/order changes`, () => {
  const observed = (phase: Phase) => {
    if (kind === 'claude') return [{ role: 'assistant', content: [tool(kind, phase)] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool_recovery_${phase}`, content: marker, is_error: false }] }];
    const result = structuredClone(acquiredCodexResult); result.call_id = `call_recovery_${phase}`; const value = JSON.parse(result.output[1]!.text); value.output = `${marker}\n`; result.output[1]!.text = JSON.stringify(value);
    return [tool(kind, phase), result];
  };
  const terminal = kind === 'codex' ? { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'native-recovery-write-complete' }] } : { role: 'assistant', content: [{ type: 'text', text: 'native-recovery-write-complete' }] };
  const request = (sequence: any[]) => kind === 'codex' ? { input: sequence } : { messages: sequence };
  const write = observed('write'); assertObservation(kind, request(write), 'write'); assertNoObservation(kind, request([])); assert.throws(() => assertNoObservation(kind, request(write)));
  const firstRead = request([...observed('write'), terminal]); assertHistory(kind, firstRead, false);
  const sequence = [...observed('write'), terminal, ...observed('read')];
  assertHistory(kind, request(sequence)); assertHistory(kind, request(sequence), true); assertObservation(kind, request(sequence), 'read');
  assert.throws(() => assertHistory(kind, request(sequence), false), 'first resumed request cannot contain current read observations');
  for (const cause of ['foreign-call', 'foreign-result', 'duplicate-call', 'duplicate-result', 'reversed-result', 'read-before-write', 'final-before-write', 'final-after-read', 'call-role', 'result-role', 'call-type', 'result-type'] as const) {
    const bad = structuredClone(sequence); const entry = (index: number) => kind === 'codex' ? bad[index] : bad[index].content[0];
    if (cause === 'foreign-call') { const extra = structuredClone(bad[3]); const call = kind === 'codex' ? extra : extra.content[0]; call.id += '-foreign'; if (kind === 'codex') call.call_id += '-foreign'; bad.push(extra); }
    if (cause === 'foreign-result') { const extra = structuredClone(bad[4]); const result = kind === 'codex' ? extra : extra.content[0]; if (kind === 'codex') result.call_id += '-foreign'; else { result.tool_use_id += '-foreign'; result.is_error = true; } bad.push(extra); }
    if (cause === 'duplicate-call') bad.push(structuredClone(bad[3]));
    if (cause === 'duplicate-result') bad.push(structuredClone(bad[4]));
    if (cause === 'reversed-result') [bad[0], bad[1]] = [bad[1], bad[0]];
    if (cause === 'read-before-write') [bad[0], bad[1], bad[3], bad[4]] = [bad[3], bad[4], bad[0], bad[1]];
    if (cause === 'final-before-write') bad.unshift(bad.splice(2, 1)[0]);
    if (cause === 'final-after-read') bad.push(bad.splice(2, 1)[0]);
    if (cause === 'call-role') bad[3].role = 'user';
    if (cause === 'result-role') bad[4].role = 'assistant';
    if (cause === 'call-type') entry(3).type = kind === 'codex' ? 'function_call' : 'server_tool_use';
    if (cause === 'result-type') entry(4).type = kind === 'codex' ? 'function_call_output' : 'server_tool_result';
    assert.throws(() => assertHistory(kind, request(bad), true), cause);
  }
});
test('acquisition stops third or overlapping requests and premature phase change', () => {
  const sequence = new Sequence(); assert.throws(() => sequence.resume()); assert.equal(sequence.enter(), 1); assert.throws(() => sequence.enter()); sequence.leave(); assert.equal(sequence.enter(), 2); sequence.leave(); sequence.resume(); assert.equal(sequence.enter(), 1); sequence.leave(); assert.equal(sequence.enter(), 2); sequence.leave(); assert.throws(() => sequence.enter());
});
test('acquisition one-shot marker survives failure and cannot be reset by another entry', () => {
  const parent = mkdtempSync(join(tmpdir(), 'aeon-recovery-marker-')); const root = join(parent, 'attempt');
  try { consumeAttempt(root, 'codex'); const original = readFileSync(join(root, 'attempt.json')); json(join(root, 'failure.json'), { error: 'preflight failed' }); assert.throws(() => consumeAttempt(root, 'codex'), /EEXIST/); assert.deepEqual(readFileSync(join(root, 'attempt.json')), original); assert.ok(existsSync(join(root, 'failure.json'))); } finally { rmSync(parent, { recursive: true, force: true }); }
});
// Explicit synthetic proc bytes test the source witness; they are not new acquired frames.
function syntheticLifetime(context: any, ticks = '200') {
  const stat = (pid: number, parent: number, started: string) => `${pid} (native (fixture) child) ${['S', String(parent), ...Array(17).fill('0'), started, ...Array(30).fill('0')].join(' ')}\n`;
  return { version: 'proc-child-lifetime-v1', context, pid: 9, workerPid: 8, pidScope: 'isolated-native-namespace', spawnNs: '1000', spawn: { event: 'spawn', pid: 9, atNs: '1000' }, observationBeginNs: '1001', observationEndNs: '1002', close: { event: 'close', pid: 9, atNs: '1003', code: 0, signal: null }, rawStatBefore: stat(9,8,ticks), rawStatAfter: stat(9,8,ticks), startTicks: ticks, workerRawStatBefore: stat(8,1,'100'), workerRawStatAfter: stat(8,1,'100'), workerStartTicks: '100', pidNamespaceBefore: 'pid:[1234]', pidNamespaceAfter: 'pid:[1234]', workerPidNamespaceBefore: 'pid:[1234]', workerPidNamespaceAfter: 'pid:[1234]', bootIdBefore: `${context.hostBootId}\n`, bootIdAfter: `${context.hostBootId}\n` };
}
test('qualified launch receipts allow repeated namespaces/PIDs but refuse replay, collisions, foreign bindings and ordering', () => {
  const receipts = [1,2].map(generation => {
    const manifest = { sha256: String(generation).repeat(64), bytes: 100 }, context = { generation, manifestSha256: manifest.sha256, priorCleanupSha256: null as string | null, hostBootId: '11111111-2222-3333-4444-555555555555', hostPid: 100, startedNs: String(generation * 10000) };
    return { phase: generation === 1 ? 'write' : 'read', generation, sessionId: 'same-native-session', manifest, context, nativeProcess: syntheticLifetime(context, String(generation * 200)), launchContext: {} as any, outcome: {} as any, result: {} as any, cleanup: {} as any, cleanupRef: {} as any };
  });
  const seal = (receipt: any) => {
    receipt.launchContext = { sha256: hash(canonicalJson(receipt.context)), bytes: 100 };
    receipt.outcome = { code: 0, signal: null, nativeProcess: receipt.nativeProcess }; receipt.result = { sha256: hash(canonicalJson(receipt.outcome)), bytes: 100 };
    receipt.cleanup = { observation: 'runWorker returned after awaited confinement cleanup', generation: receipt.generation, launchContext: receipt.launchContext, manifest: receipt.manifest, result: receipt.result, completedNs: String(Number(receipt.context.startedNs) + 1000), nativeExit: 0, nativeSignal: null, pendingOperations: 0 };
    receipt.cleanupRef = { sha256: hash(canonicalJson(receipt.cleanup)), bytes: 100 };
  };
  seal(receipts[0]); receipts[1]!.context.priorCleanupSha256 = receipts[0]!.cleanupRef.sha256; seal(receipts[1]); assertDistinctLaunches(receipts);
  for (const cause of ['old-insufficient','replayed-lifetime','tick-collision','missing','foreign-generation','foreign-manifest','foreign-result','foreign-cleanup','foreign-boot','close-order','cleanup-order','raw-forgery']) {
    const bad = structuredClone(receipts);
    if (cause === 'old-insufficient') bad[1]!.nativeProcess = { pid: 9, pidNamespace: 'pid:[4026532474]', closeObserved: true } as any;
    if (cause === 'replayed-lifetime') bad[1]!.nativeProcess = structuredClone(bad[0]!.nativeProcess);
    if (cause === 'tick-collision') bad[1]!.nativeProcess = syntheticLifetime(bad[1]!.context, '200');
    if (cause === 'missing') delete (bad[1]!.nativeProcess as any).rawStatBefore;
    if (cause === 'foreign-generation') bad[1]!.generation = 3;
    if (cause === 'foreign-manifest') bad[1]!.manifest.sha256 = 'f'.repeat(64);
    if (cause === 'foreign-result') bad[1]!.result.sha256 = 'f'.repeat(64);
    if (cause === 'foreign-cleanup') bad[1]!.context.priorCleanupSha256 = 'f'.repeat(64);
    if (cause === 'foreign-boot') bad[1]!.context.hostBootId = '11111111-2222-3333-4444-555555555556';
    if (cause === 'close-order') bad[1]!.nativeProcess.close.atNs = '1001';
    if (cause === 'cleanup-order') bad[1]!.context.startedNs = '10000';
    if (cause === 'raw-forgery') bad[1]!.nativeProcess.startTicks = '401';
    if (['tick-collision','foreign-cleanup','cleanup-order'].includes(cause)) seal(bad[1]);
    assert.throws(() => assertDistinctLaunches(bad), cause);
  }
});
test('fixture cap retains third attempt before real observer reservation/dispatch and binds continuation', { skip: !process.execArgv.includes('--experimental-test-module-mocks') }, async () => {
  let wanted = 2, launches = 0, calls = 0, mutate = false; const sessionId = '01a12d06-adad-7263-ace7-6f49aff47d3f';
  const payload = (ordinal: number) => JSON.stringify({ model: 'gpt-6-astra', reasoning: { effort: 'high' }, input: [{ role: 'user', content: `request-${ordinal}` }] });
  mock.module('../../packages/supervisor/worker-process.ts', { namedExports: { runWorker: async (options: WorkerOptions) => {
    launches++; const nativeRoot = join(options.command.workspace, '.aeon-native-state/codex/home/codex'); mkdirSync(nativeRoot, { recursive: true }); writeFileSync(join(nativeRoot, 'opaque'), 'explicit synthetic unlaunched native bytes');
    const startup = JSON.stringify({ type: 'thread.started', thread_id: sessionId });
    for (let ordinal = 1; ordinal <= wanted; ordinal++) await options.handle('baseline.provider', [{ method: 'POST', path: '/v1/responses', payload: payload(ordinal), nativeSession: { sessionId, startup } }], new AbortController().signal);
    return { code: 0, signal: null, exceeded: false, recoveryError: null, nativeProcess: syntheticLifetime((options.initial as any).nativeLaunch, String(launches * 200)), stdout: `${startup}\n{"type":"turn.started"}\n{"type":"turn.completed","usage":{}}\n`, stderr: '' };
  } } });
  try {
    const moduleUrl = new URL('./run-native.ts?acquisition-cap-control', import.meta.url).href;
    const { runNativeBaseline: capped } = await import(moduleUrl) as typeof import('./run-native.ts');
    for (const scenario of ['two-phases', 'third', 'mutated-third']) {
      wanted = scenario === 'two-phases' ? 2 : 3; mutate = scenario === 'mutated-third';
      const root = mkdtempSync(join(tmpdir(), 'aeon-recovery-admission-')); calls = 0; launches = 0;
      try {
        for (const path of ['work', 'checkout', 'protected']) mkdirSync(join(root, path));
        const { codexNativeProtocol: _unused, ...profile } = grant('codex').profile;
        const input: NativeBaselineRun = { kind: 'codex', workspace: join(root, 'work'), checkoutRoot: join(root, 'checkout'), privateStateRoot: join(root, 'state'), protectedPaths: [join(root, 'protected')],
          native: { version: 'pure unlaunched cap fixture', files: ['codex', 'codex-code-mode-host'].map(name => ({ name, path: '/usr/bin/true', sha256: fileHash('/usr/bin/true') })) },
          grant: { ...grant('codex'), profile }, prompt: 'pure cap control', maxCliOutputBytes: 4096, recovery: { mode: 'start', checkpointId: 'first' }, provider: { kind: 'fixture', maxRequestsPerLaunch: 2, transport: async () => {
            calls++; if (mutate && calls === 1 && input.provider.kind === 'fixture') input.provider.maxRequestsPerLaunch = 3;
            return new Response(responseBytes('codex', [], calls), { headers: { 'content-type': 'text/event-stream' } });
          } } };
        if (wanted === 2) {
          const first = await capped(input); assert.ok(first.checkpoint);
          const originalBudget = databaseRows(join(root, 'state/observer.sqlite')).documents.find(row => row.namespace === 'budgets');
          const second = await capped({ ...input, recovery: { mode: 'resume', checkpoint: first.checkpoint, checkpointAfter: 'second' } }); assert.ok(second.checkpoint); assert.equal(second.physicalRequests, 4);
          assert.ok(equal(originalBudget, databaseRows(join(root, 'state/observer.sqlite')).documents.find(row => row.namespace === 'budgets')), 'per-launch admission must not reset original clock/envelope');
          assert.ok(input.provider.kind === 'fixture');
          await assert.rejects(capped({ ...input, recovery: { mode: 'resume', checkpoint: second.checkpoint }, provider: { ...input.provider, maxRequestsPerLaunch: 3 } }), /unavailable or stopped/);
        } else await assert.rejects(capped(input), /unavailable or stopped/);
        assert.equal(launches, wanted === 2 ? 2 : 1); assert.equal(calls, wanted === 2 ? 4 : 2);
        const state = databaseRows(join(root, 'state/observer.sqlite'));
        assert.equal(state.documents.filter(row => row.namespace === 'requests').length, calls);
        const launch = state.documents.find(row => row.namespace === 'baseline-launches')!;
        const launchManifest = JSON.parse(Buffer.from(state.artifacts.find(item => item.digest === launch.value.manifest.sha256)!.bytes).toString()); assert.equal(launchManifest.fixtureMaxRequestsPerLaunch, 2, 'source primitive must match immutable admission cap');
        assert.ok(state.documents.filter(row => row.namespace === 'requests').every(row => row.value.request.status === 'succeeded' && row.value.charged.tokens === 110));
        const budget = state.documents.find(row => row.namespace === 'budgets')!; assert.ok(equal(budget.value.envelope, grant('codex').resources)); assert.equal(budget.value.envelope.maxRequests, 8); assert.equal(budget.value.cancelled, false);
        const allocations = state.documents.filter(row => row.namespace === 'allocations'); assert.equal(allocations.length, 1); assert.equal(allocations[0]!.value.cancelled, true);
        if (wanted === 3) {
          assert.equal(state.documents.filter(row => row.namespace === 'native-checkpoints').length, 0);
          const refusal = state.documents.find(row => row.namespace === 'baseline-refusals')!; assert.match(refusal.value.reason, /before observer dispatch/);
          const retained = state.artifacts.find(artifact => artifact.digest === refusal.value.request.sha256)!; assert.equal(Buffer.from(retained.bytes).toString(), payload(3));
        }
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  } finally { mock.restoreAll(); }
});

for (const kind of ['codex', 'claude'] as Kind[]) test(`physical one-shot ${kind} native write/checkpoint/exact-session read acquisition`, { skip: process.env.AEON_NATIVE_RECOVERY_ACQUIRE !== kind, timeout: 75_000 }, async context => {
  const root = join(evidenceParent, `${kind}-acquisition-1`); mkdirSync(evidenceParent, { recursive: true, mode: 0o700 }); consumeAttempt(root, kind);
  const plan = publicPlan(kind), sequence = new Sequence(), captured: any[] = [], results: NativeBaselineResult[] = []; let refusal: unknown; let incoming = 0;
  const checkout = join(root, 'checkout'), workspace = join(root, 'workspace'), protectedRoot = join(root, 'protected');
  try {
    for (const path of [checkout, workspace, protectedRoot, join(root, 'state')]) mkdirSync(path, { mode: 0o700 });
    writeFileSync(join(protectedRoot, 'sentinel'), sentinel, { flag: 'wx', mode: 0o600 });
    const freeze = acquisitionFreeze(kind), clearancePath = process.env.AEON_NATIVE_RECOVERY_CLEARANCE;
    assert.ok(clearancePath && isAbsolute(clearancePath), 'root-owned exact clearance path required');
    const clearance = JSON.parse(readFileSync(clearancePath, 'utf8'));
    json(join(root, 'observed-freeze.json'), freeze); json(join(root, 'clearance.json'), clearance);
    assert.match(clearance.reviewRevision, /^[a-f0-9]{40}$/); assert.ok(typeof clearance.windowId === 'string' && clearance.windowId.length > 0);
    assert.ok(equal(clearance.freeze, freeze), 'reviewed source/runtime/kernel/public plan differs from root clearance');
    json(join(root, 'declared-plan.json'), plan); snapshot(root, 'before');
    const input: NativeBaselineRun = { kind, checkoutRoot: checkout, workspace, privateStateRoot: join(root, 'state'), protectedPaths: [protectedRoot], native: freeze.native, grant: plan.grant, maxCliOutputBytes: 1_000_000, prompt: plan.phases[0]!.prompt,
      recovery: { mode: 'start', checkpointId: 'acquisition-write-ready' },
      ...(kind === 'claude' ? { claudeOptions: { tools: 'Agent,Bash,Read,Write', delegation: 'isolated-native' as const, modelRoles: { haiku: plan.grant.profile.model, sonnet: plan.grant.profile.model, opus: plan.grant.profile.model, subagent: plan.grant.profile.model } } } : {}),
      provider: { kind: 'fixture', maxRequestsPerLaunch: 2, transport: async (payload, signal, protocol) => {
        let entered = false;
        const ordinal = ++incoming;
        try {
          signal.throwIfAborted();
          writeFileSync(join(root, `request-${ordinal}.json`), payload, { flag: 'wx', mode: 0o600 });
          const request = JSON.parse(payload); captured.push(request);
          const turn = sequence.enter(); entered = true;
          assert.equal(payload.includes(sentinel), false); assert.equal(request.model, plan.grant.profile.model);
          const dispatched = databaseRows(join(root, 'state/observer.sqlite'));
          const active = dispatched.documents.filter(row => row.namespace === 'requests' && row.value.request.status === 'dispatched'); assert.equal(active.length, 1);
          const attempt = dispatched.documents.find(row => row.namespace === 'baseline-attempts' && row.key === active[0].key); assert.ok(attempt?.value.nativeSession);
          const artifact = (ref: any) => { const bytes = dispatched.artifacts.find(item => item.digest === ref.sha256)?.bytes; assert.ok(bytes); assert.equal(hash(bytes), ref.sha256); return JSON.parse(Buffer.from(bytes).toString()); };
          const identity = artifact(attempt.value.nativeSession); json(join(root, `dispatch-${ordinal}.json`), { phase: sequence.phase, request: active[0], attempt, identity, nativeHttp: attempt.value.nativeHttp ? artifact(attempt.value.nativeHttp) : null, host: hostControl() });
          if (sequence.phase === 'read') {
            assert.equal(identity.sessionId, value(ready!, 'native-checkpoints', 'acquisition-write-ready').value.sessionId);
            assertHistory(kind, request, turn === 2);
          }
          if (kind === 'claude') { assert.equal(protocol?.beta, PINNED_CLAUDE_DELEGATION_BETA); assert.equal(request.thinking.type, 'adaptive'); assert.equal(request.output_config.effort, 'high'); }
          if (turn === 1) {
            if (sequence.phase === 'write') assertNoObservation(kind, request);
            if (sequence.phase === 'read') { const beforeInstructions = instructions(kind, captured[0]), resumedInstructions = instructions(kind, request); json(join(root, 'instruction-audit.json'), { equal: equal(beforeInstructions, resumedInstructions), before: beforeInstructions, resumed: resumedInstructions, fullBefore: captured[0], fullResumed: request }); assert.ok(equal(beforeInstructions, resumedInstructions), 'unknown effective instruction/control difference'); }
          } else assertObservation(kind, request, sequence.phase);
          const reply = plan.phases[sequence.phase === 'write' ? 0 : 1]!.replies[turn - 1]!;
          writeFileSync(join(root, `response-${ordinal}.sse`), reply.body, { flag: 'wx', mode: 0o600 });
          return new Response(reply.body, { status: reply.status, headers: { 'content-type': reply.contentType } });
        } catch (error) { refusal ??= error; json(join(root, `transport-refusal-${ordinal}.json`), { error: String(error), phase: sequence.phase, counts: sequence.counts }); throw error; }
        finally { if (entered) sequence.leave(); }
      } } };
    let ready: any;
    const first = await runNativeBaseline(input); results.push(first); json(join(root, 'write-result.json'), first); ready = snapshot(root, 'ready'); assertReady(ready, first, 2, kind); assert.equal(sequence.counts.write, 2);
    sequence.resume();
    const second = await runNativeBaseline({ ...input, prompt: plan.phases[1]!.prompt, recovery: { mode: 'resume', checkpoint: first.checkpoint!, checkpointAfter: 'acquisition-read-ready' } }); results.push(second); json(join(root, 'read-result.json'), second);
    const after = snapshot(root, 'resumed-ready'); assertReady(after, second, 4, kind); assert.equal(sequence.counts.read, 2); assert.equal(refusal, undefined);
    for (const namespace of ['baseline-grants', 'allocations', 'budgets']) assert.ok(equal(rows(ready, namespace), rows(after, namespace)), `original ${namespace} changed`);
    for (const original of rows(ready, 'requests')) assert.ok(equal(original, value(after, 'requests', original.key)), 'original settled charge/revision changed');
    const consumed = value(after, 'native-checkpoints', first.checkpoint!.id); assert.equal(consumed.value.status, 'running'); assert.equal(consumed.revision, first.checkpoint!.revision + 1); assert.equal(consumed.value.generation, first.checkpoint!.generation + 1);
    assert.equal(value(after, 'native-checkpoints', second.checkpoint!.id).value.sessionId, consumed.value.sessionId); assert.equal(rows(after, 'baseline-launches').length, 2);
    const receipts = results.map((result, index) => {
      const checkpoint = value(after, 'native-checkpoints', result.checkpoint!.id), launch = value(after, 'baseline-launches', String(result.checkpoint!.generation));
      return { phase: plan.phases[index]!.phase, generation: result.checkpoint!.generation, sessionId: consumed.value.sessionId, manifest: result.manifest, result: result.result, outcome: result.outcome, nativeProcess: (result.outcome as any).nativeProcess, launchContext: launch.value.context, context: artifact(after, launch.value.context), cleanupRef: checkpoint.value.cleanup, cleanup: artifact(after, checkpoint.value.cleanup) };
    });
    json(join(root, 'process-receipts.json'), receipts); assertDistinctLaunches(receipts);
    assert.equal(readFileSync(join(workspace, file), 'utf8'), marker); assert.equal(readFileSync(join(protectedRoot, 'sentinel'), 'utf8'), sentinel);
    json(join(root, 'result.json'), { status: 'acquired-awaiting-independent-audit', qualification: 'namespace-fixture', results, counts: sequence.counts, originalGrant: plan.grant, sameHostAcquisition: true, control: hostControl() });
  } catch (error) {
    json(join(root, 'failure.json'), { error: String(error), stack: error instanceof Error ? error.stack : null, refusal: String(refusal), results, counts: sequence.counts, firstFailure: true, retry: false });
    try { snapshot(root, 'failure-state'); } catch (exportError) { json(join(root, 'failure-export.json'), { error: String(exportError) }); }
    throw error;
  } finally { context.diagnostic(JSON.stringify({ evidence: root, counts: sequence.counts, retry: false })); }
});
