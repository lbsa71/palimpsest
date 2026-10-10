import { createHash } from 'node:crypto';
import type { CodingToolDefinition, RawToolIntent, ToolOutcome } from './coding-provider.ts';
import type { CodingExecutionContext } from './coding-contracts.ts';
import type { CodingArtifacts } from './coding-artifacts.ts';
import { CodingWorkspaces } from './workspaces.ts';
import type { WorkspaceFile, WorkspaceFileInput, WorkspaceOperation } from './workspaces.ts';
import type { Json } from './store.ts';
import { Store } from './store.ts';

export interface CodingToolsOptions { store: Store; workspaces: CodingWorkspaces; artifacts: CodingArtifacts; current(context: CodingExecutionContext): void; commandTimeoutMs: number; maxCommandOutputBytes: number }
export interface CodingToolReceipt { outcome: ToolOutcome; receipt: Json; command?: { callId: string; effectId: string }; submission?: Json }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const text = (value: unknown, maximum: number, empty = false) => typeof value === 'string' && (empty || value.length > 0) && Buffer.byteLength(value) <= maximum && Buffer.from(value).toString() === value;
const path = (value: unknown) => text(value, 1024) && !/[\x00-\x1f\x7f-\x9f\\]/u.test(value as string) && !(value as string).split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git');
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const expected = (value: unknown) => object(value) && keys(value, ['sha256', 'mode']) && digest(value.sha256) && [0o644, 0o755].includes(value.mode as number);
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const fields: Record<string, string[]> = { manifest: [], list: ['path', 'cursor'], search: ['query', 'cursor'], read: ['path', 'expectedSha256', 'startByte', 'endByte'], create: ['path', 'content', 'mode'], replace: ['path', 'content', 'mode', 'expected'], edit: ['path', 'oldText', 'newText', 'expected'], delete: ['path', 'expected'], move: ['path', 'destination', 'expected'], mkdir: ['path'], rmdir: ['path'] };
export function validateCodingFileOperation(value: unknown): value is WorkspaceOperation {
  if (!object(value) || typeof value.kind !== 'string' || !Object.hasOwn(fields, value.kind) || !keys(value, ['kind', ...fields[value.kind]!])) return false;
  if (value.kind === 'manifest') return true;
  if (value.kind === 'list') return (value.path === undefined || path(value.path)) && (value.cursor === undefined || path(value.cursor));
  if (value.kind === 'search') return text(value.query, 4096) && (value.cursor === undefined || integer(value.cursor));
  if (!path(value.path)) return false;
  if (value.kind === 'read') return (value.expectedSha256 === undefined || digest(value.expectedSha256)) && (value.startByte === undefined || integer(value.startByte)) && (value.endByte === undefined || integer(value.endByte)) && (value.startByte === undefined || value.endByte === undefined || Number(value.endByte) >= Number(value.startByte));
  if (['replace', 'edit', 'delete', 'move'].includes(value.kind) && !expected(value.expected)) return false;
  if (value.kind === 'move') return path(value.destination);
  if (value.kind === 'edit') return text(value.oldText, 1_048_576) && text(value.newText, 1_048_576, true);
  if (['create', 'replace'].includes(value.kind)) return text(value.content, 1_048_576, true) && [0o644, 0o755].includes(value.mode as number);
  return true;
}
const stringSchema = { type: 'string' } as const, pathSchema = { type: 'string', minLength: 1, maxLength: 1024 } as const, countSchema = { type: 'integer', minimum: 0 } as const;
const expectedSchema = { type: 'object', properties: { sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, mode: { enum: [420, 493] } }, required: ['sha256', 'mode'], additionalProperties: false } as const;
const fileSchema = { anyOf: Object.entries(fields).map(([kind, allowed]) => ({ type: 'object', properties: Object.fromEntries([['kind', { const: kind }], ...allowed.map(field => [field, field === 'expected' ? expectedSchema : field === 'mode' ? { enum: [420, 493] } : ['startByte', 'endByte', 'cursor'].includes(field) && kind !== 'list' ? countSchema : ['path', 'destination'].includes(field) ? pathSchema : stringSchema])]), required: ['kind', ...allowed.filter(field => !['cursor', 'expectedSha256', 'startByte', 'endByte'].includes(field) && !(kind === 'list' && field === 'path'))], additionalProperties: false })) };
function commandValidator(value: unknown): boolean { return object(value) && keys(value, ['tool', 'args', 'cwd']) && ['node', 'native-tsc'].includes(String(value.tool)) && Array.isArray(value.args) && value.args.length <= 256 && value.args.every(arg => text(arg, 16384, true) && !(arg as string).includes('\0')) && Buffer.byteLength(JSON.stringify(value.args)) <= 65536 && (value.cwd === undefined || value.cwd === '.' || path(value.cwd)); }
function outputValidator(value: unknown): boolean { return object(value) && keys(value, ['commandCallId', 'stream', 'offset', 'length']) && /^[A-Za-z0-9]{9}$/.test(String(value.commandCallId)) && ['stdout', 'stderr'].includes(String(value.stream)) && integer(value.offset) && integer(value.length, 1, 65536); }
function diffValidator(value: unknown): boolean { return object(value) && keys(value, ['cursor']) && (value.cursor === undefined || text(value.cursor, 512)); }
function submitValidator(value: unknown): boolean { return object(value) && keys(value, ['expectedTreeDigest']) && digest(value.expectedTreeDigest); }

export class CodingTools {
  readonly catalog: readonly CodingToolDefinition[];
  #options: CodingToolsOptions;
  constructor(options: CodingToolsOptions) {
    this.#options = options;
    this.catalog = [
      { name: 'workspace_files', description: 'Inspect manifest/list/search/read or create/replace/exact-edit/delete/move/mkdir/rmdir within the admitted draft. Use returned hash/mode preconditions. Reads use UTF-8 byte coordinates; listing/search return continuation.', inputSchema: fileSchema as CodingToolDefinition['inputSchema'], validateArguments: validateCodingFileOperation },
      { name: 'workspace_command', description: 'Execute staged trusted Node or native TypeScript inside the draft. Returns actual exit/usability/output evidence; unsupported subprocess/network checks are unavailable.', inputSchema: { type: 'object', properties: { tool: { enum: ['node', 'native-tsc'] }, args: { type: 'array', items: stringSchema, maxItems: 256 }, cwd: pathSchema }, required: ['tool', 'args'], additionalProperties: false }, validateArguments: commandValidator },
      { name: 'workspace_output', description: 'Page sealed stdout/stderr for a prior command call ID, by byte coordinates. No host paths.', inputSchema: { type: 'object', properties: { commandCallId: { type: 'string', pattern: '^[A-Za-z0-9]{9}$' }, stream: { enum: ['stdout', 'stderr'] }, offset: countSchema, length: { type: 'integer', minimum: 1, maximum: 65536 } }, required: ['commandCallId', 'stream', 'offset', 'length'], additionalProperties: false }, validateArguments: outputValidator },
      { name: 'workspace_diff', description: 'Page exact baseline-to-current changes and text hunks bound to stable before/after tree identities. Rejects stale cursor; rename is add/delete.', inputSchema: { type: 'object', properties: { cursor: stringSchema }, additionalProperties: false }, validateArguments: diffValidator },
      { name: 'workspace_submit', description: 'Submit the expected exact current tree as an immutable host artifact and durable admission disposition. This does not approve or activate a release.', inputSchema: { type: 'object', properties: { expectedTreeDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, required: ['expectedTreeDigest'], additionalProperties: false }, validateArguments: submitValidator },
    ];
  }
  validateBatch(intents: RawToolIntent[], seen: readonly string[], remainingCommands: number): void {
    const ids = new Set(seen); let commands = 0;
    for (const intent of intents) {
      const tool = this.catalog.find(tool => tool.name === intent.name);
      if (!/^[A-Za-z0-9]{9}$/.test(intent.callId) || ids.has(intent.callId) || !tool || tool.validateArguments(JSON.parse(intent.arguments)) !== true) throw new Error('Invalid coding intent batch');
      ids.add(intent.callId); if (intent.name === 'workspace_command') commands++;
    }
    if (commands > remainingCommands || intents.some(intent => intent.name === 'workspace_submit') && intents.length !== 1) throw new Error('Invalid coding intent batch');
  }
  #reply(receipt: Json, ok = true, extras: Pick<CodingToolReceipt, 'command' | 'submission'> = {}, model: Json = receipt): CodingToolReceipt {
    let encoded = JSON.stringify(model);
    if (Buffer.byteLength(encoded) > 16384) {
      const totalBytes = Buffer.byteLength(encoded); let previewLength = 8192;
      let bounded = JSON.stringify({ truncated: true, totalBytes, preview: Buffer.from(encoded).subarray(0, previewLength).toString(), continuation: 'Use ranged reads or output paging for the complete data' });
      while (Buffer.byteLength(bounded) > 16384) { previewLength = Math.floor(previewLength / 2); bounded = JSON.stringify({ truncated: true, totalBytes, preview: Buffer.from(encoded).subarray(0, previewLength).toString(), continuation: 'Use ranged reads or output paging for the complete data' }); }
      encoded = bounded;
    }
    return { receipt, outcome: ok ? { ok: true, text: encoded } : { ok: false, kind: 'tool_failed', message: encoded }, ...extras };
  }
  #prefix(value: string, maximum = 1024): string {
    const bytes = Buffer.from(value); let end = Math.min(bytes.length, maximum);
    while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    return bytes.subarray(0, end).toString();
  }
  #fileReply(receipt: Json, args: Record<string, unknown>): CodingToolReceipt {
    if (!object(receipt) || receipt.ok !== true || Buffer.byteLength(JSON.stringify(receipt)) <= 16384 || !object(receipt.result)) return this.#reply(receipt, object(receipt) && receipt.ok === true);
    const model = structuredClone(receipt), result = model.result as Record<string, Json>;
    if (args.kind === 'read' && typeof result.text === 'string') {
      result.text = this.#prefix(result.text); result.observedEndByte = result.endByte!;
      result.endByte = Number(result.startByte) + Buffer.byteLength(result.text); result.nextStartByte = result.endByte; result.truncated = true;
    } else if (args.kind === 'search' && Array.isArray(result.matches)) {
      const matches = result.matches.map(match => {
        if (!object(match) || typeof match.text !== 'string') throw new Error('Invalid search receipt');
        const preview = this.#prefix(match.text); return { ...match, text: preview, textTruncated: preview !== match.text } as Json;
      });
      result.matches = [];
      for (const match of matches) { (result.matches as Json[]).push(match); if (Buffer.byteLength(JSON.stringify(model)) > 14000) { (result.matches as Json[]).pop(); break; } }
      result.truncated = true; result.nextCursor = Number(args.cursor ?? 0) + (result.matches as Json[]).length;
    } else if (Array.isArray(result.files)) {
      const files = result.files;
      const directories = Array.isArray(result.directories) ? result.directories : [];
      const entries = [...files.map(file => { if (!object(file) || typeof file.path !== 'string') throw new Error('Invalid file receipt'); return file.path; }), ...directories.map(path => { if (typeof path !== 'string') throw new Error('Invalid directory receipt'); return path; })].sort();
      const selected: string[] = []; result.files = []; if (Array.isArray(result.directories)) result.directories = [];
      for (const path of entries) {
        selected.push(path); result.files = files.filter(file => object(file) && selected.includes(String(file.path)));
        if (Array.isArray(result.directories)) result.directories = directories.filter(path => selected.includes(String(path)));
        if (Buffer.byteLength(JSON.stringify(model)) > 14000) {
          selected.pop(); result.files = files.filter(file => object(file) && selected.includes(String(file.path)));
          if (Array.isArray(result.directories)) result.directories = directories.filter(path => selected.includes(String(path))); break;
        }
      }
      result.truncated = true;
      if (args.kind === 'list') result.nextCursor = selected.at(-1) ?? null;
      else result.continuation = { tool: 'workspace_files', arguments: { kind: 'list' } };
    }
    return this.#reply(receipt, true, {}, model as Json);
  }
  #outputReply(receipt: Json): CodingToolReceipt {
    if (!object(receipt) || typeof receipt.base64 !== 'string' || Buffer.byteLength(JSON.stringify(receipt)) <= 16384) return this.#reply(receipt);
    const model = structuredClone(receipt), bytes = Buffer.from(receipt.base64, 'base64'), page = bytes.subarray(0, 1024);
    model.base64 = page.toString('base64'); delete model.text;
    try { model.text = new TextDecoder('utf-8', { fatal: true }).decode(page); } catch { /* Base64 retains exact range even at a UTF-8 boundary. */ }
    model.observedEndOffset = model.endOffset; model.endOffset = Number(model.offset) + page.length;
    model.nextOffset = Number(model.endOffset) < Number(model.totalBytes) ? model.endOffset : null; model.truncated = true;
    return this.#reply(receipt, true, {}, model as Json);
  }
  async execute(context: CodingExecutionContext, intent: RawToolIntent, effectId: string, signal?: AbortSignal): Promise<CodingToolReceipt> {
    signal?.throwIfAborted(); this.#options.current(context);
    this.validateBatch([intent], [], 1);
    const args = JSON.parse(intent.arguments);
    const prior = this.#options.store.effect(effectId);
    // Recorded receiver effects, never transcript strings, establish observed result provenance.
    if (prior) {
      const payload = prior.payload as Record<string, Json>;
      if (prior.taskId !== context.taskId || payload.workspaceId !== context.workspaceId) throw new Error('Coding receipt identity mismatch');
      if (prior.kind === 'workspace.files' && (intent.name !== 'workspace_files' || JSON.stringify(payload.operation) !== JSON.stringify(args)) || prior.kind === 'workspace.command' && (intent.name !== 'workspace_command' || JSON.stringify(payload.command) !== JSON.stringify(args))) throw new Error('Coding receipt intent mismatch');
      if (prior.state !== 'completed') {
        if (prior.kind === 'workspace.command') await this.#options.workspaces.reconcileCommand(context.workspaceId, context.epoch, effectId);
        else if (prior.kind === 'workspace.files') await this.#options.workspaces.reconcile(context.workspaceId, context.epoch, effectId);
        else throw new Error('Unsupported coding receipt recovery');
        this.#options.current(context);
      }
      const recovered = this.#options.store.effect(effectId)!;
      if (recovered.state !== 'completed') throw new Error('Coding effect remains uncertain');
      const result = recovered.result as Record<string, Json>;
      if (prior.kind === 'workspace.command') {
        const observation = result.observation as Record<string, Json>;
        return this.#reply(observation, observation.exitSuccessful === true, { command: { callId: intent.callId, effectId } });
      }
      return this.#fileReply(recovered.result, args);
    }
    if (intent.name === 'workspace_files') {
      const receipt = await this.#options.workspaces.perform(context.workspaceId, context.epoch, effectId, args);
      this.#options.current(context); return this.#fileReply(receipt as unknown as Json, args);
    }
    if (intent.name === 'workspace_command') {
      const receipt = await this.#options.workspaces.runCommand(context.workspaceId, context.epoch, effectId, args, { timeoutMs: this.#options.commandTimeoutMs, maxOutputBytes: this.#options.maxCommandOutputBytes });
      this.#options.current(context);
      return this.#reply(receipt as unknown as Json, receipt.exitSuccessful, { command: { callId: intent.callId, effectId } });
    }
    if (intent.name === 'workspace_output') {
      const command = context.commands.find(command => command.callId === args.commandCallId);
      if (!command) return this.#reply({ code: 'unknown-command-call' }, false);
      const receipt = this.#options.workspaces.readCommandOutput(context.workspaceId, context.epoch, command.effectId, args.stream, args.offset, args.length);
      this.#options.current(context); return this.#outputReply(receipt as unknown as Json);
    }
    if (intent.name === 'workspace_diff') return this.#diff(context, effectId, args.cursor);
    const receipt = await this.#options.artifacts.submit({ authority: context, workspaces: this.#options.workspaces, workspaceId: context.workspaceId, sourceArtifactId: context.sourceArtifactId, expectedTreeDigest: args.expectedTreeDigest, submissionId: effectId, ...(signal ? { signal } : {}) });
    this.#options.current(context);
    return this.#reply(receipt as unknown as Json, true, { submission: receipt as unknown as Json });
  }
  async #manifest(context: CodingExecutionContext, effectId: string): Promise<WorkspaceFile[]> {
    const reply = await this.#options.workspaces.perform(context.workspaceId, context.epoch, effectId, { kind: 'manifest' });
    this.#options.current(context);
    if (!reply.ok || !('files' in reply.result)) throw new Error('Coding draft manifest unavailable');
    return reply.result.files;
  }
  async #contents(context: CodingExecutionContext, file: WorkspaceFile, effectId: string): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < file.bytes;) {
      this.#options.current(context);
      let endByte = Math.min(file.bytes, offset + 65536), accepted = false;
      for (let adjustment = 0; adjustment < 4; adjustment++, endByte--) {
        const reply = await this.#options.workspaces.perform(context.workspaceId, context.epoch, `${effectId}:${offset}:${endByte}`, { kind: 'read', path: file.path, expectedSha256: file.sha256, startByte: offset, endByte });
        this.#options.current(context);
        if (!reply.ok) {
          if (reply.code === 'unsupported-encoding') return null;
          if (reply.code === 'invalid-range') continue;
          throw new Error('Coding diff source changed');
        }
        if (!('text' in reply.result)) throw new Error('Invalid coding diff read receipt');
        chunks.push(Buffer.from(reply.result.text)); offset = endByte; accepted = true; break;
      }
      if (!accepted) return null;
    }
    const bytes = Buffer.concat(chunks);
    if (sha(bytes) !== file.sha256) throw new Error('Coding diff source changed');
    return bytes;
  }
  async #directories(context: CodingExecutionContext, effectId: string): Promise<string[]> {
    const directories: string[] = [];
    for (let page = 0, cursor: string | undefined; page <= 4096; page++) {
      const reply = await this.#options.workspaces.perform(context.workspaceId, context.epoch, `${effectId}:${page}`, { kind: 'list', ...(cursor ? { cursor } : {}) });
      this.#options.current(context);
      if (!reply.ok || !('directories' in reply.result) || !('nextCursor' in reply.result) || typeof reply.result.nextCursor === 'number') throw new Error('Coding diff directories unavailable');
      directories.push(...reply.result.directories);
      if (reply.result.nextCursor === null) break;
      if (reply.result.nextCursor === cursor || page === 4096) throw new Error('Invalid directory continuation');
      cursor = reply.result.nextCursor;
    }
    return directories;
  }
  async #diff(context: CodingExecutionContext, effectId: string, rawCursor?: string): Promise<CodingToolReceipt> {
    const baseTree = this.#options.artifacts.readBaseTree({ authority: context, sourceArtifactId: context.sourceArtifactId });
    const baseFiles: WorkspaceFileInput[] = baseTree.files;
    this.#options.current(context);
    const files = await this.#manifest(context, `${effectId}:manifest`), before = context.base.treeDigest, after = sha(JSON.stringify(files));
    const directories = await this.#directories(context, `${effectId}:list`);
    const viewDigest = sha(JSON.stringify({ files, directories }));
    const original = new Map(baseFiles.map(file => [file.path, file])), originalDirectories = new Map(baseTree.directories.map(directory => [directory.path, directory.mode]));
    const changes = [...new Set([...original.keys(), ...files.map(file => file.path), ...originalDirectories.keys(), ...directories])].sort().flatMap(path => {
      const old = original.get(path), current = files.find(file => file.path === path);
      const directory = originalDirectories.has(path) || directories.includes(path);
      if (directory && originalDirectories.has(path) && directories.includes(path)) return [];
      if (old && current && sha(old.content) === current.sha256 && old.mode === current.mode) return [];
      return [{ path, old, current, directory, beforeDirectoryMode: originalDirectories.get(path), currentDirectory: directories.includes(path) }];
    });
    let cursor = { before, after, viewDigest, index: 0, offset: 0 };
    if (rawCursor !== undefined) {
      try { const parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString()); if (!object(parsed) || !keys(parsed, ['before', 'after', 'viewDigest', 'index', 'offset']) || parsed.before !== before || parsed.after !== after || parsed.viewDigest !== viewDigest || !integer(parsed.index, 0, changes.length) || !integer(parsed.offset)) throw new Error(); cursor = parsed as typeof cursor; }
      catch { return this.#reply({ code: 'stale-or-invalid-diff-cursor', beforeTreeDigest: before, afterTreeDigest: after }, false); }
    }
    const change = changes[cursor.index];
    if (!change) return this.#reply({ beforeTreeDigest: before, afterTreeDigest: after, changes: [], nextCursor: null });
    const currentBytes = change.current ? await this.#contents(context, change.current, `${effectId}:read:${sha(change.path)}`) : Buffer.from('');
    let hunk: string | null = null;
    try {
      if (currentBytes === null || change.directory) throw new Error();
      const decoder = new TextDecoder('utf-8', { fatal: true }), old = decoder.decode(change.old?.content ?? Buffer.from('')).split('\n'), next = decoder.decode(currentBytes).split('\n');
      let prefix = 0, suffix = 0;
      while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
      while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      hunk = `@@ -${prefix + 1},${old.length - prefix - suffix} +${prefix + 1},${next.length - prefix - suffix} @@\n` + [...old.slice(prefix, old.length - suffix).map(line => `-${line}`), ...next.slice(prefix, next.length - suffix).map(line => `+${line}`)].join('\n');
    } catch { /* Explicit binary/range limitation; the full byte artifact remains separately available. */ }
    const hunkBytes = Buffer.from(hunk ?? 'Binary or UTF-8 range boundary: textual hunk unavailable');
    if (cursor.offset > hunkBytes.length) return this.#reply({ code: 'invalid-diff-cursor' }, false);
    let end = Math.min(hunkBytes.length, cursor.offset + 1024);
    while (end > cursor.offset && end < hunkBytes.length && (hunkBytes[end]! & 0xc0) === 0x80) end--;
    const more = end < hunkBytes.length, next = more ? { ...cursor, offset: end } : { ...cursor, index: cursor.index + 1, offset: 0 };
    const checked = await this.#manifest(context, `${effectId}:after`);
    const checkedDirectories = await this.#directories(context, `${effectId}:after-list`);
    if (sha(JSON.stringify({ files: checked, directories: checkedDirectories })) !== viewDigest) return this.#reply({ code: 'stale-diff-tree' }, false);
    return this.#reply({ beforeTreeDigest: before, afterTreeDigest: after, viewDigest, changes: [{ path: change.path, kind: change.directory ? change.currentDirectory ? 'directory-added' : 'directory-deleted' : !change.old ? 'added' : !change.current ? 'deleted' : 'modified', beforeMode: change.old?.mode ?? change.beforeDirectoryMode ?? null, afterMode: change.current?.mode ?? null, textHunk: hunkBytes.subarray(cursor.offset, end).toString(), hunkStartByte: cursor.offset, hunkEndByte: end, hunkTotalBytes: hunkBytes.length, textual: hunk !== null }], nextCursor: next.index < changes.length ? Buffer.from(JSON.stringify(next)).toString('base64url') : null });
  }
}
