import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, lstat, realpath, writeFile, readdir, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runIsolated } from './isolation.ts';

export type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
}

export type ProcedurePermission = 'scratch-write';
export interface ProcedureManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  description: string;
  runtime: 'node';
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissions: ProcedurePermission[];
  timeoutMs: number;
  maxOutputBytes: number;
  examples: { input: Json; output: Json }[];
  tests: { input: Json; expected: Json }[];
}

export interface ProcedureDefinition { manifest: ProcedureManifest; source: string }
export interface PublicationDecision { approved: boolean; digest: string; evidence: string[] }
export interface PublishedProcedure extends ProcedureDefinition {
  digest: string;
  approval: PublicationDecision;
  publishedAt: string;
  revoked?: { reason: string; at: string };
}
export interface ProcedureRegistryOptions {
  storeDir: string;
  /** Trusted host authority, supplied during bootstrap; never sourced from candidate/model data. */
  authorizePublication(digest: string, manifest: ProcedureManifest, source: string): Promise<PublicationDecision>;
}
export interface ProcedureExecutionOptions { permissions: ProcedurePermission[]; signal?: AbortSignal }

export class ProcedureError extends Error {
  constructor(code: string) { super(code); this.name = 'ProcedureError'; }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function fail(code: string): never { throw new ProcedureError(code); }

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) fail('invalid_json');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, (item) => canonical(item, depth + 1)).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
  return fail('invalid_json');
}

function checkSchema(schema: unknown, depth = 0, budget = { nodes: 0 }): asserts schema is JsonSchema {
  if (depth > 16 || ++budget.nodes > 512 || !object(schema)) fail('invalid_schema');
  if (Object.keys(schema).some((key) => !['type', 'properties', 'required', 'additionalProperties', 'items'].includes(key))) fail('unsupported_schema');
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(schema.type))) fail('unsupported_schema');
  if (schema.type === 'object') {
    if (typeof schema.additionalProperties !== 'boolean' || (schema.properties !== undefined && !object(schema.properties)) || schema.items !== undefined) fail('invalid_schema');
    const properties = schema.properties ?? {};
    for (const nested of Object.values(properties)) checkSchema(nested, depth + 1, budget);
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string' || !Object.hasOwn(properties, key)) || new Set(schema.required).size !== schema.required.length)) fail('invalid_schema');
  } else if (schema.type === 'array') {
    if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) fail('invalid_schema');
    checkSchema(schema.items, depth + 1, budget);
  } else if (Object.keys(schema).length !== 1) fail('invalid_schema');
}

function matches(schema: JsonSchema, value: Json): void {
  if (schema.type === 'object') {
    if (!object(value)) fail('schema_mismatch');
    const properties = schema.properties ?? {};
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) fail('schema_mismatch');
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(properties, key)) matches(properties[key]!, value[key]!);
      else if (!schema.additionalProperties) fail('schema_mismatch');
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('schema_mismatch');
    for (const item of value) matches(schema.items!, item);
  } else if (schema.type === 'null') {
    if (value !== null) fail('schema_mismatch');
  } else if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('schema_mismatch');
  } else if (typeof value !== schema.type) fail('schema_mismatch');
}

/** Unsupported schema keywords fail instead of becoming unenforced promises. */
export function validateJson(schema: JsonSchema, value: unknown): asserts value is Json {
  checkSchema(schema);
  canonical(value);
  matches(schema, value as Json);
}

function definition(input: ProcedureDefinition): ProcedureDefinition {
  if (!object(input) || Object.keys(input).some((key) => !['manifest', 'source'].includes(key)) || typeof input.source !== 'string' || !input.source.trim() || Buffer.byteLength(input.source) > 128 * 1024) fail('invalid_procedure');
  const value = input.manifest;
  if (!object(value) || Object.keys(value).some((key) => !['schemaVersion', 'name', 'version', 'description', 'runtime', 'inputSchema', 'outputSchema', 'permissions', 'timeoutMs', 'maxOutputBytes', 'examples', 'tests'].includes(key))) fail('invalid_manifest');
  if (value.schemaVersion !== 1 || value.runtime !== 'node' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.name) || !/^\d+\.\d+\.\d+$/.test(value.version)
    || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 2048
    || !Array.isArray(value.permissions) || value.permissions.some((item) => item !== 'scratch-write') || new Set(value.permissions).size !== value.permissions.length
    || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 30_000
    || !Number.isSafeInteger(value.maxOutputBytes) || value.maxOutputBytes < 1 || value.maxOutputBytes > 1_048_576
    || !Array.isArray(value.examples) || !value.examples.length || value.examples.length > 20
    || !Array.isArray(value.tests) || !value.tests.length || value.tests.length > 20) fail('invalid_manifest');
  checkSchema(value.inputSchema); checkSchema(value.outputSchema);
  for (const example of value.examples) {
    if (!object(example) || Object.keys(example).some((key) => !['input', 'output'].includes(key))) fail('invalid_manifest');
    validateJson(value.inputSchema, example.input); validateJson(value.outputSchema, example.output);
  }
  for (const fixture of value.tests) {
    if (!object(fixture) || Object.keys(fixture).some((key) => !['input', 'expected'].includes(key))) fail('invalid_manifest');
    validateJson(value.inputSchema, fixture.input); validateJson(value.outputSchema, fixture.expected);
  }
  const encoded = canonical(input);
  if (Buffer.byteLength(encoded) > 512 * 1024) fail('invalid_procedure');
  return JSON.parse(encoded) as ProcedureDefinition;
}

export function procedureDigest(input: ProcedureDefinition): string {
  return createHash('sha256').update(canonical(definition(input))).digest('hex');
}

function approved(value: PublicationDecision, digest: string): boolean {
  return object(value) && value.approved === true && value.digest === digest && Array.isArray(value.evidence)
    && value.evidence.length > 0 && value.evidence.length <= 100 && value.evidence.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 2048);
}

function outside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(path);
}

export class ProcedureRegistry {
  readonly #options: ProcedureRegistryOptions;
  readonly #directory: string;

  constructor(options: ProcedureRegistryOptions) {
    if (!isAbsolute(options.storeDir) || typeof options.authorizePublication !== 'function') fail('invalid_registry_configuration');
    this.#options = { ...options };
    this.#directory = join(resolve(options.storeDir), 'procedures');
  }

  async #prepare(): Promise<void> {
    const repository = await realpath(fileURLToPath(new URL('..', import.meta.url)));
    if (!outside(repository, this.#directory)) fail('registry_must_be_external');
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    if (!outside(repository, await realpath(this.#directory))) fail('registry_must_be_external');
  }

  #path(digest: string): string {
    if (!/^[0-9a-f]{64}$/.test(digest)) fail('invalid_digest');
    return join(this.#directory, `${digest}.json`);
  }

  #versionPath(manifest: ProcedureManifest): string {
    return join(this.#directory, createHash('sha256').update(manifest.name + '\0' + manifest.version).digest('hex') + '.version');
  }

  async #load(digest: string): Promise<PublishedProcedure> {
    await this.#prepare();
    const path = this.#path(digest);
    let stored: PublishedProcedure;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576) fail('integrity');
      stored = JSON.parse(await readFile(path, 'utf8')) as PublishedProcedure;
    } catch (error) {
      if (object(error) && error.code === 'ENOENT') fail('not_published');
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') fail('not_published');
      return fail('integrity');
    }
    try {
      if (stored.digest !== digest || procedureDigest({ manifest: stored.manifest, source: stored.source }) !== digest || !approved(stored.approval, digest)) fail('integrity');
    } catch { fail('integrity'); }
    let version: string;
    try { version = await readFile(this.#versionPath(stored.manifest), 'utf8'); } catch { return fail('integrity'); }
    if (version !== digest) fail('integrity');
    return stored;
  }

  async publish(input: ProcedureDefinition): Promise<PublishedProcedure> {
    const candidate = definition(input);
    const digest = procedureDigest(candidate);
    await this.#prepare();
    try {
      const existing = await this.#load(digest);
      if (existing.revoked) fail('revoked');
      return existing;
    } catch (error) { if (!(error instanceof ProcedureError && error.message === 'not_published')) throw error; }
    const versionPath = this.#versionPath(candidate.manifest);
    try {
      if (await readFile(versionPath, 'utf8') !== digest) fail('version_conflict');
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    for (const fixture of candidate.manifest.tests) {
      const actual = await this.executeScratch(candidate, fixture.input, { permissions: candidate.manifest.permissions });
      if (!isDeepStrictEqual(actual, fixture.expected)) fail('fixture_failed');
    }
    const decision = await this.#options.authorizePublication(digest, structuredClone(candidate.manifest), candidate.source);
    if (!approved(decision, digest)) fail('not_approved');
    const artifact: PublishedProcedure = { ...candidate, digest, approval: structuredClone(decision), publishedAt: new Date().toISOString() };
    // The exclusive version claim prevents two processes publishing conflicting bytes.
    try { await writeFile(versionPath, digest, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      if (await readFile(versionPath, 'utf8') !== digest) fail('version_conflict');
    }
    await this.#write(digest, artifact, true);
    const published = await this.#load(digest);
    if (published.revoked) fail('revoked');
    return published;
  }

  async #write(digest: string, artifact: PublishedProcedure, createOnly = false): Promise<void> {
    const temporary = join(this.#directory, `${digest}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(artifact), { flag: 'wx', mode: 0o600 });
      if (createOnly) {
        // A concurrent identical publication may win, but must never overwrite revocation.
        try { await link(temporary, this.#path(digest)); }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
      } else await rename(temporary, this.#path(digest));
    } finally { await rm(temporary, { force: true }); }
  }

  async list(): Promise<PublishedProcedure[]> {
    await this.#prepare();
    const items: PublishedProcedure[] = [];
    for (const name of (await readdir(this.#directory)).filter((name) => /^[0-9a-f]{64}\.json$/.test(name)).sort()) items.push(await this.#load(name.slice(0, -5)));
    return items;
  }

  async revoke(digest: string, reason: string): Promise<void> {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2048) fail('invalid_revocation');
    const artifact = await this.#load(digest);
    if (!artifact.revoked) await this.#write(digest, { ...artifact, revoked: { reason, at: new Date().toISOString() } });
  }

  async execute(digest: string, input: unknown, options: ProcedureExecutionOptions): Promise<Json> {
    const artifact = await this.#load(digest);
    if (artifact.revoked) fail('revoked');
    return this.executeScratch({ source: artifact.source, manifest: artifact.manifest }, input, options);
  }

  async executeScratch(procedure: ProcedureDefinition, input: unknown, options: ProcedureExecutionOptions): Promise<Json> {
    const candidate = definition(procedure);
    if (!Array.isArray(options.permissions) || options.permissions.some((permission) => permission !== 'scratch-write') || candidate.manifest.permissions.some((permission) => !options.permissions.includes(permission))) fail('permission');
    if (options.signal?.aborted) fail('cancelled');
    validateJson(candidate.manifest.inputSchema, input);
    const stdin = canonical(input);
    if (Buffer.byteLength(stdin) > 64 * 1024) fail('input_limit');
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'palimpsest-procedure-')));
    try {
      const sourcePath = join(cwd, 'procedure.mjs');
      await writeFile(sourcePath, candidate.source, { mode: 0o400 });
      const result = await runIsolated({
        program: await realpath(process.execPath), args: [sourcePath], cwd,
        readPaths: [cwd], writePaths: candidate.manifest.permissions.includes('scratch-write') ? [cwd] : [],
        timeoutMs: candidate.manifest.timeoutMs, maxOutputBytes: candidate.manifest.maxOutputBytes,
        ...(options.signal ? { signal: options.signal } : {}), stdin,
      });
      if (options.signal?.aborted) fail('cancelled');
      if (result.timedOut) fail('timeout');
      if (result.outputLimitExceeded) fail('output_limit');
      if (result.exitCode !== 0) fail('execution');
      let output: unknown;
      try { output = JSON.parse(result.stdout); } catch { return fail('invalid_output_json'); }
      validateJson(candidate.manifest.outputSchema, output);
      return output;
    } finally { await rm(cwd, { recursive: true, force: true }); }
  }
}

/** Synthetic, reviewable example. The parser handles RFC-style quoted fields without dependencies. */
export const CSV_SUMMARY_PROCEDURE: ProcedureDefinition = {
  manifest: {
    schemaVersion: 1, name: 'csv-summary', version: '1.0.0', description: 'Summarize CSV row and column counts with a header row.', runtime: 'node',
    inputSchema: { type: 'object', properties: { csv: { type: 'string' } }, required: ['csv'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { headers: { type: 'array', items: { type: 'string' } }, rowCount: { type: 'integer' }, columnCount: { type: 'integer' } }, required: ['headers', 'rowCount', 'columnCount'], additionalProperties: false },
    permissions: [], timeoutMs: 1000, maxOutputBytes: 65_536,
    examples: [{ input: { csv: 'name,count\nAda,3\n' }, output: { headers: ['name', 'count'], rowCount: 1, columnCount: 2 } }],
    tests: [
      { input: { csv: 'name,count\nAda,3\n' }, expected: { headers: ['name', 'count'], rowCount: 1, columnCount: 2 } },
      { input: { csv: '"last, first",note\n"Smith, Pat","says ""hi"""\n' }, expected: { headers: ['last, first', 'note'], rowCount: 1, columnCount: 2 } },
    ],
  },
  source: String.raw`
let body=''; for await (const chunk of process.stdin) body+=chunk;
const {csv}=JSON.parse(body);
const rows=[]; let row=[], field='', quoted=false, closed=false;
for(let i=0;i<csv.length;i++) {
  const char=csv[i];
  if(quoted) {
    if(char==='"' && csv[i+1]==='"') {field+='"';i++;}
    else if(char==='"') {quoted=false;closed=true;}
    else field+=char;
    continue;
  }
  if(closed && char!==',' && char!=='\n' && char!=='\r') throw new Error('Invalid text after quote');
  if(char==='"') {if(field.length) throw new Error('Quote in unquoted field');quoted=true;}
  else if(char===',') {row.push(field);field='';closed=false;}
  else if(char==='\n' || char==='\r') {if(char==='\r' && csv[i+1]==='\n') i++;row.push(field);rows.push(row);row=[];field='';closed=false;}
  else field+=char;
}
if(quoted) throw new Error('Unterminated quote');
if(row.length || field.length || closed) {row.push(field);rows.push(row);}
if(!rows.length) throw new Error('CSV requires header');
const headers=rows.shift();
if(rows.some(row=>row.length!==headers.length)) throw new Error('Unequal row widths');
process.stdout.write(JSON.stringify({headers,rowCount:rows.length,columnCount:headers.length}));
`,
};
