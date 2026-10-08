import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProcedureRegistry, procedureDigest, validateJson, CSV_SUMMARY_PROCEDURE } from '../src/procedures.ts';
import type { ProcedureDefinition } from '../src/procedures.ts';

const echo: ProcedureDefinition = {
  manifest: {
    schemaVersion: 1, name: 'echo', version: '1.0.0', description: 'Return a synthetic input unchanged.', runtime: 'node',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    permissions: [], timeoutMs: 1000, maxOutputBytes: 4096,
    examples: [{ input: { text: 'hello' }, output: { text: 'hello' } }],
    tests: [{ input: { text: 'fixture' }, expected: { text: 'fixture' } }],
  },
  source: `let text=''; for await (const chunk of process.stdin) text+=chunk; process.stdout.write(JSON.stringify(JSON.parse(text)));`,
};

test('schema subset validates observable shape and rejects silently ignored contracts', () => {
  validateJson(echo.manifest.inputSchema, { text: 'value' });
  for (const value of [null, {}, { text: 1 }, { text: 'yes', secret: true }]) assert.throws(() => validateJson(echo.manifest.inputSchema, value));
  assert.throws(() => validateJson({ type: 'string', pattern: '^x' } as never, 'xyz'), /unsupported_schema/);
  assert.throws(() => validateJson({ type: 'object' } as never, {}), /invalid_schema/);
  assert.throws(() => validateJson({ type: 'number' }, NaN), /invalid_json/);
  assert.throws(() => validateJson({ type: 'array', items: { type: 'integer' } }, [1, 2.5]), /schema_mismatch/);
});

test('procedure digest binds source and every contract field, independent of object-key order', () => {
  assert.equal(procedureDigest(echo), procedureDigest({ source: echo.source, manifest: { ...echo.manifest, inputSchema: { additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } }, type: 'object' } } }));
  assert.notEqual(procedureDigest(echo), procedureDigest({ ...echo, source: echo.source + '\n// different source' }));
  assert.notEqual(procedureDigest(echo), procedureDigest({ ...echo, manifest: { ...echo.manifest, version: '1.0.1' } }));
});

test('publication approval is distinct from scratch execution and persisted reuse', async (t) => {
  const storeDir = await mkdtemp(join(tmpdir(), 'palimpsest-procedures-'));
  t.after(() => rm(storeDir, { recursive: true, force: true }));
  let approvals = 0;
  const registry = new ProcedureRegistry({ storeDir, authorizePublication: async (digest) => { approvals++; return { approved: true, digest, evidence: ['trusted:fixture-suite-v1'] }; } });
  const digest = procedureDigest(echo);
  await assert.rejects(registry.execute(digest, { text: 'before approval' }, { permissions: [] }), /not_published/);
  assert.deepEqual(await registry.executeScratch(echo, { text: 'scratch' }, { permissions: [] }), { text: 'scratch' });
  assert.equal(approvals, 0);
  assert.equal((await registry.publish(echo)).digest, digest);
  assert.equal(approvals, 1);
  const reopened = new ProcedureRegistry({ storeDir, authorizePublication: async () => { throw new Error('must not need repeated review'); } });
  assert.deepEqual(await reopened.execute(digest, { text: 'reuse' }, { permissions: [] }), { text: 'reuse' });
  assert.equal((await reopened.publish(echo)).digest, digest);
  assert.equal((await reopened.list()).length, 1);
  await reopened.revoke(digest, 'Fixture later found incomplete');
  await assert.rejects(reopened.execute(digest, { text: 'after revoke' }, { permissions: [] }), /revoked/);
});

test('publication fails closed on rejected/stale approval, failing fixtures, collisions and tampering', async (t) => {
  const storeDir = await mkdtemp(join(tmpdir(), 'palimpsest-procedures-'));
  t.after(() => rm(storeDir, { recursive: true, force: true }));
  for (const decision of [{ approved: false, digest: procedureDigest(echo), evidence: ['check'] }, { approved: true, digest: '0'.repeat(64), evidence: ['check'] }, { approved: true, digest: procedureDigest(echo), evidence: [] }]) {
    const registry = new ProcedureRegistry({ storeDir, authorizePublication: async () => decision });
    await assert.rejects(registry.publish(echo), /not_approved/);
  }
  let approvals = 0;
  const registry = new ProcedureRegistry({ storeDir, authorizePublication: async (digest) => { approvals++; return { approved: true, digest, evidence: ['trusted:fixtures'] }; } });
  const incorrect = { ...echo, source: `process.stdout.write('{"text":"wrong"}');` };
  await assert.rejects(registry.publish(incorrect), /fixture_failed/);
  assert.equal(approvals, 0);
  const artifact = await registry.publish(echo);
  await assert.rejects(registry.publish({ ...echo, source: echo.source + '\n// changed' }), /version_conflict/);
  const path = join(storeDir, 'procedures', `${artifact.digest}.json`);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  stored.source += '\n// tampered';
  await writeFile(path, JSON.stringify(stored));
  await assert.rejects(registry.execute(artifact.digest, { text: 'try' }, { permissions: [] }), /integrity/);
});

test('execution bounds permissions, input/output, cancellation and timeout', async (t) => {
  const storeDir = await mkdtemp(join(tmpdir(), 'palimpsest-procedures-'));
  t.after(() => rm(storeDir, { recursive: true, force: true }));
  const registry = new ProcedureRegistry({ storeDir, authorizePublication: async () => ({ approved: false, digest: '', evidence: [] }) });
  await assert.rejects(registry.executeScratch(echo, { text: 42 }, { permissions: [] }), /schema_mismatch/);
  await assert.rejects(registry.executeScratch({ ...echo, manifest: { ...echo.manifest, permissions: ['scratch-write'] } }, { text: 'value' }, { permissions: [] }), /permission/);
  await assert.rejects(registry.executeScratch({ ...echo, source: `process.stdout.write('42');` }, { text: 'value' }, { permissions: [] }), /schema_mismatch/);
  await assert.rejects(registry.executeScratch({ ...echo, source: `process.stdout.write('x'.repeat(10000));` }, { text: 'value' }, { permissions: [] }), /output_limit/);
  await assert.rejects(registry.executeScratch({ ...echo, source: `import {writeFileSync} from 'node:fs'; writeFileSync('unauthorized.txt','no'); process.stdout.write('{"text":"wrote"}');` }, { text: 'value' }, { permissions: [] }), /execution/);
  assert.deepEqual(await registry.executeScratch({ ...echo, manifest: { ...echo.manifest, permissions: ['scratch-write'] }, source: `import {writeFileSync,readFileSync} from 'node:fs'; writeFileSync('scratch.txt','yes'); process.stdout.write(JSON.stringify({text:readFileSync('scratch.txt','utf8')}));` }, { text: 'value' }, { permissions: ['scratch-write'] }), { text: 'yes' });
  await assert.rejects(registry.executeScratch({ ...echo, source: `setInterval(()=>{},1000);`, manifest: { ...echo.manifest, timeoutMs: 50 } }, { text: 'value' }, { permissions: [] }), /timeout/);
  await assert.rejects(registry.executeScratch(echo, { text: 'value' }, { permissions: [], signal: AbortSignal.abort() }), /cancelled/);
});

test('CSV summary handles quoting, multiline fields and independently checked reuse', async (t) => {
  const storeDir = await mkdtemp(join(tmpdir(), 'palimpsest-procedures-'));
  t.after(() => rm(storeDir, { recursive: true, force: true }));
  const registry = new ProcedureRegistry({ storeDir, authorizePublication: async (digest) => ({ approved: true, digest, evidence: ['trusted:csv-heldout-fixtures'] }) });
  const approved = await registry.publish(CSV_SUMMARY_PROCEDURE);
  assert.deepEqual(await registry.execute(approved.digest, { csv: 'name,note\r\n"Smith, Jane","Line one\nLine two"\r\nAlice,"said ""hello"""\r\n' }, { permissions: [] }), { headers: ['name', 'note'], rowCount: 2, columnCount: 2 });
  assert.deepEqual(await registry.execute(approved.digest, { csv: 'x,y\n1,2\n3,4' }, { permissions: [] }), { headers: ['x', 'y'], rowCount: 2, columnCount: 2 });
  await assert.rejects(registry.execute(approved.digest, { csv: 'a,b\n1,"unterminated' }, { permissions: [] }), /execution/);
  await assert.rejects(registry.execute(approved.digest, { csv: 'a,b\n1,2,3' }, { permissions: [] }), /execution/);
});
