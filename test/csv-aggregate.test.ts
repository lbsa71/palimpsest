import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CSV_AGGREGATE_PROCEDURE } from '../src/csv-aggregate.ts';
import { ProcedureRegistry } from '../src/procedures.ts';

test('numeric CSV aggregation selects the requested column and reuses identical approved code', async t => {
  const storeDir = await mkdtemp(join(tmpdir(), 'palimpsest-aggregation-'));
  t.after(() => rm(storeDir, { recursive: true, force: true }));
  let approvals = 0;
  const registry = new ProcedureRegistry({ storeDir, authorizePublication: async digest => {
    approvals++; return { approved: true, digest, evidence: ['synthetic-test-approval'] };
  } });
  const published = await registry.publish(CSV_AGGREGATE_PROCEDURE);
  const csv = 'name,amount,units\r\n"Smith, Jane",1.25,2\r\n"Line one\nLine two",2.75,3\r\n';
  assert.deepEqual(await registry.execute(published.digest, { csv, column: 'amount' }, { permissions: [] }), { column: 'amount', count: 2, sum: 4 });
  assert.deepEqual(await registry.execute(published.digest, { csv, column: 'units' }, { permissions: [] }), { column: 'units', count: 2, sum: 5 });
  assert.deepEqual(await registry.execute(published.digest, { csv: 'value\n-1\n+3\n2e1\n.5\n', column: 'value' }, { permissions: [] }), { column: 'value', count: 4, sum: 22.5 });
  assert.deepEqual(await registry.execute(published.digest, { csv: 'note,value\n"said ""hello""",4.5\n', column: 'value' }, { permissions: [] }), { column: 'value', count: 1, sum: 4.5 });
  assert.deepEqual(await registry.execute(published.digest, { csv: 'value\n', column: 'value' }, { permissions: [] }), { column: 'value', count: 0, sum: 0 });
  assert.equal(approvals, 1);
});

test('aggregation refuses ambiguous, missing, malformed and nonfinite values', async t => {
  const storeDir = await mkdtemp(join(tmpdir(), 'palimpsest-aggregation-'));
  t.after(() => rm(storeDir, { recursive: true, force: true }));
  const registry = new ProcedureRegistry({ storeDir, authorizePublication: async () => { throw new Error('scratch cannot publish'); } });
  for (const csv of ['other\n1', 'value,value\n1,2', ',value\n1,2', 'value\n""\n', 'value\nabc', 'value\nNaN', 'value\nInfinity', 'value\n1e999', 'value\n1e308\n1e308', 'value\n"1,000"', 'value\n"2', 'value\n"2"oops', 'value,note\n1']) {
    await assert.rejects(registry.executeScratch(CSV_AGGREGATE_PROCEDURE, { csv, column: 'value' }, { permissions: [] }), /execution/);
  }
  await assert.rejects(registry.executeScratch(CSV_AGGREGATE_PROCEDURE, { csv: 'value\n1', column: 1 }, { permissions: [] }), /schema_mismatch/);
});
