import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ApplicationOptions } from '../../deployment/application.ts';
import type { ApplicationConfig } from '../../deployment/config.ts';
import { identity, invariant } from '../../packages/contracts/index.ts';
import { hash } from './adapter.ts';

export const lifecycleCases = ['S08', 'S09', 'S11', 'S12'] as const;
export type LifecycleCase = typeof lifecycleCases[number];
export type LifecycleControl = 'normal' | 'no-process-restart' | 'short-history' | 'duplicate-delivery' | 'retained-old-profile';
export const lifecycleEnvelope = Object.freeze({ maxRequests: 180, maxTokens: 360000, maxCostUsd: 0, maxElapsedMs: 180000, maxConcurrency: 3 });
export const oldPrompt = 'PUBLIC lifecycle engineering fixture. OLD_PROFILE_AMBER. Inspect real observations, obey current inputs, and report verified outcomes.';
export const currentPrompt = 'PUBLIC lifecycle engineering fixture. CURRENT_PROFILE_INDIGO. Inspect real observations, obey current inputs, and report verified outcomes.';
export const compactionPrompt = 'Preserve task constraints, the indigo origin tag, evidence, uncertainties and provenance.';

export function configureLifecycle(config: ApplicationConfig) {
  config.resources = { ...lifecycleEnvelope }; config.conversationResources = { ...lifecycleEnvelope };
  config.scheduler.resources = { ...lifecycleEnvelope }; config.maxConcurrentRuns = 2;
  config.model.maxRequestsPerSlice = 64; config.model.maxOutputTokens = 256; config.model.timeoutMs = 10000;
  config.bootstrapInitiative = false;
  return config;
}
export function lifecycleWorkload(caseId: LifecycleCase) {
  if (caseId === 'S09') return { prompt: 'Read public notes0 through31 sequentially. Preserve the indigo origin tag through ordinary context compaction. Write answer.json with origin:indigo and notes:32; explicitly report verified completion.', files: Object.fromEntries(Array.from({ length: 36 }, (_, i) => [`notes/${i}.json`, `${JSON.stringify({ id: `public-note-${i}`, origin: 'indigo', value: i })}\n`])) };
  if (caseId === 'S11') return { prompt: '<@BOT> Deliver the local result exactly once. After host recovery retain the actual receipt; do not repeat the delivery.', files: {} };
  return { prompt: 'Read state.json and retain its actual observation. Wait for the authenticated correction, then write value9 with the observed digest, read it back and explicitly report the result. For the prompt-transition task, use a real inspected and accepted child result.', files: { 'state.json': '{"value":4}\n' } };
}
/** Fixed public host preparation, synchronous before receive() onReady microtask. */
export function preparePublicFiles(config: ApplicationConfig, runId: string, caseId: LifecycleCase) {
  const workspace = join(config.workspaceDirectory, identity(runId)); mkdirSync(workspace, { mode: 0o700 });
  const files = Object.entries(lifecycleWorkload(caseId).files).map(([path, content]) => {
    mkdirSync(join(workspace, path, '..'), { recursive: true, mode: 0o700 }); writeFileSync(join(workspace, path), content, { flag: 'wx', mode: 0o600 });
    return { path, sha256: hash(content), bytes: Buffer.byteLength(content) };
  });
  return { workspace, files, actor: 'host-evaluator', phase: 'before-first-dispatch', public: true };
}
interface Message { role: string; content: string }
function context(messages: Message[]): Record<string, any> { return messages.filter(m => m.role === 'user').map(m => { try { return JSON.parse(m.content); } catch { return {}; } }).findLast(m => m.hostContext)?.hostContext ?? {}; }
function receipt(messages: Message[]) { return JSON.parse(messages.findLast(m => m.role === 'tool')?.content ?? '{}'); }
export interface FixtureOptions { caseId: LifecycleCase; control: LifecycleControl; phase: 0 | 1; model: string; actorId: string; boundary(runId: string): void }
/** Public deterministic provider responses only. Effects and children execute in the real application. */
export function lifecycleTransport(options: FixtureOptions): NonNullable<ApplicationOptions['performRequest']> {
  let total = 0; const counts = new Map<string, number>(); let prepared: any, task: any, childResult: any, publicCompactionFrame: Record<string, any> | undefined;
  return async (payload, signal) => {
    invariant(++total <= 80, 'Public lifecycle fixture response ceiling exceeded');
    const request = JSON.parse(payload), messages = request.messages as Message[], currentFrame = context(messages), observed = receipt(messages);
    const response = (message: unknown, finish_reason: string) => ({ status: 200, body: JSON.stringify({ model: options.model, choices: [{ finish_reason, message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) });
    if (options.caseId === 'S09' && (request.tools ?? []).length === 0 && messages[0]?.content.includes(compactionPrompt)) return response({ role: 'assistant', content: 'Retained PUBLIC summary: origin tag indigo; sequential notes are read; write answer.json after note31.' }, 'stop');
    // This fixed public case has one run. Genuine compaction can discard the
    // original routing JSON; retain its observed fixture routing and sequence.
    if (options.caseId === 'S09' && currentFrame.runId) {
      invariant(!publicCompactionFrame || publicCompactionFrame.runId === currentFrame.runId, 'Compaction fixture received another undeclared run');
      publicCompactionFrame ??= currentFrame;
    }
    const frame = options.caseId === 'S09' ? publicCompactionFrame : currentFrame;
    invariant(frame, 'Compaction fixture lacks its initial observed public routing frame');
    const count = (counts.get(frame.runId ?? 'compaction') ?? 0) + 1; counts.set(frame.runId ?? 'compaction', count);
    const tool = (name: string, args: unknown) => response({ role: 'assistant', content: null, tool_calls: [{ id: `life${String(total).padStart(6, '0')}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
    const stop = () => response({ role: 'assistant', content: 'Public lifecycle fixture turn finished.' }, 'stop');
    const read = (path: string) => tool('workspace_read', { path });
    const write = (path: string, content: string, expectedSha256: string | null = null) => tool('workspace_write', { path, content, expectedSha256 });
    const speak = () => tool('speech_send', { channel: frame.target.channel, ...(frame.target.threadTs ? { threadTs: frame.target.threadTs } : {}), text: 'Verified local lifecycle result.', kind: 'message' });
    if (options.caseId === 'S09') {
      const reads = options.control === 'short-history' ? 3 : 32;
      if (count <= reads) return read(`notes/${count - 1}.json`);
      if (count === reads + 1) return write('answer.json', '{"origin":"indigo","notes":32}\n');
      if (count === reads + 2) return read('answer.json');
      if (count === reads + 3) return speak();
      return stop();
    }
    if (options.caseId === 'S11') {
      if (count === 1 || options.control === 'duplicate-delivery' && count === 2) return speak();
      return stop();
    }
    if (options.caseId === 'S12' && frame.target?.channel.includes('plain')) return stop();
    if (options.phase === 0 && frame.target) {
      if (count === 1) return read('state.json');
      if (count === 2) {
        options.boundary(frame.runId);
        await new Promise<void>((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
        throw new Error('Paused provider request ended without a response');
      }
      // Active authenticated steering aborts the held request. This is the no-process-restart control.
    }
    const step = options.phase === 0 ? count - 2 : count;
    if (options.caseId === 'S12' && !frame.target) {
      if (count === 1) return write('child.json', '{"value":9,"source":"actual-child"}\n');
      if (count === 2) return read('child.json');
      return stop();
    }
    invariant(JSON.stringify(messages).includes('value9'), 'Fixture resumed without authenticated correction');
    if (step === 1) {
      const digests = messages.filter(m => m.role === 'tool').map(m => { try { return JSON.parse(m.content).sha256; } catch { return undefined; } });
      const digest = digests.findLast(value => typeof value === 'string'); invariant(digest, 'Initial actual read digest unavailable');
      return write('state.json', '{"value":9}\n', digest);
    }
    if (step === 2) return read('state.json');
    if (options.caseId === 'S08') { if (step === 3) return speak(); return stop(); }
    if (step === 3) return tool('delegation_prepare', {});
    if (step === 4) {
      prepared = observed; task = { id: 'lifecycle-current-child', parentRunId: frame.runId, parentGoalId: 'finite-public-lifecycle', objective: 'Write child.json with value9 and source actual-child, read it back, then finish.', inputs: [], provenance: { sourceIds: [frame.runId], actorId: options.actorId, recordedAt: new Date().toISOString(), derivation: 'interpreted' }, scope: prepared.grant.scope, acceptanceCriteria: ['Actual child.json contains value9 and source actual-child'], writablePaths: [prepared.workspace], allowedEffects: ['workspace_write', 'workspace_read'], resources: prepared.grant.resources, modelPolicy: prepared.grant.modelProfiles[0], outputLocation: 'child.json', cancellationConditions: ['Parent cancellation or original deadline'], maxDepth: 1 };
      return tool('delegation_start', task);
    }
    if (step === 5) { childResult = observed; invariant(observed.status === 'completed', 'Real lifecycle child incomplete'); return tool('delegation_inspect', { id: task.id }); }
    if (step === 6) {
      const result = JSON.parse(observed.artifacts[0].content); invariant(JSON.stringify(result.observations).includes('actual-child'), 'Real child artifact not inspected');
      return tool('delegation_judge', { id: task.id, inspection: observed.receipt, checks: [{ criterion: task.acceptanceCriteria[0], passed: true, evidence: childResult.result.artifacts[0] }] });
    }
    if (step === 7) { invariant(observed.status === 'accepted', 'Actual child result not accepted'); return write('answer.json', '{"value":9,"source":"actual-child"}\n'); }
    if (step === 8) return speak();
    return stop();
  };
}

/** No network, socket, ambient credential or injected receipt. Durable local commits are authoritative. */
export class LocalLostReplyReceiver {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path); this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS deliveries(sequence INTEGER PRIMARY KEY AUTOINCREMENT,client_id TEXT UNIQUE NOT NULL, channel TEXT NOT NULL, thread TEXT NOT NULL,text TEXT NOT NULL,at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS calls(sequence INTEGER PRIMARY KEY AUTOINCREMENT,method TEXT NOT NULL,args TEXT NOT NULL,at TEXT NOT NULL)');
  }
  close() { this.db.close(); }
  rows() { return this.db.prepare('SELECT * FROM deliveries ORDER BY sequence').all(); }
  calls() { return this.db.prepare('SELECT * FROM calls ORDER BY sequence').all(); }
  async call<T>(method: string, args: Record<string, string>): Promise<T> {
    invariant(['chat.postMessage', 'conversations.history', 'conversations.replies'].includes(method), 'Local fixture rejects socket/external method');
    this.db.prepare('INSERT INTO calls(method,args,at) VALUES(?,?,?)').run(method, JSON.stringify(args), new Date().toISOString());
    if (method === 'chat.postMessage') {
      invariant(args.client_msg_id && args.channel && args.text, 'Local delivery requires real effect identity');
      const result = this.db.prepare('INSERT INTO deliveries(client_id,channel,thread,text,at) VALUES(?,?,?,?,?)').run(args.client_msg_id, args.channel, args.thread_ts ?? '', args.text, new Date().toISOString());
      if (Number(result.lastInsertRowid) === 1) throw new Error('LOCAL fixture acknowledgement lost after actual durable SQLite commit');
      return { ok: true, ts: `${10 + Number(result.lastInsertRowid)}`, channel: args.channel } as T;
    }
    return { ok: true, has_more: false, messages: this.rows().map(row => ({ ts: `${10 + Number(row.sequence)}`, thread_ts: row.thread, user: 'BOT', text: row.text, client_msg_id: row.client_id })) } as T;
  }
}
