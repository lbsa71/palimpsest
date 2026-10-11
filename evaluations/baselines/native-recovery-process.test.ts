import assert from 'node:assert/strict';
import test from 'node:test';
import * as recovery from './native-recovery.ts';
const api = recovery as any;
const boot = '11111111-2222-3333-4444-555555555555';
export function syntheticStat(pid: number, ppid: number, ticks: string, name = 'native (test) child') {
  return `${pid} (${name}) ${['S', String(ppid), ...Array(17).fill('0'), ticks, ...Array(30).fill('0')].join(' ')}\n`;
}
export function syntheticLifetime(context: any, ticks = '200') {
  return { version: 'proc-child-lifetime-v1', context, pid: 9, workerPid: 8, pidScope: 'isolated-native-namespace',
    spawnNs: '1000', spawn: { event: 'spawn', pid: 9, atNs: '1000' }, observationBeginNs: '1001', observationEndNs: '1002', close: { event: 'close', pid: 9, atNs: '1003', code: 0, signal: null },
    rawStatBefore: syntheticStat(9, 8, ticks), rawStatAfter: syntheticStat(9, 8, ticks), startTicks: ticks,
    workerRawStatBefore: syntheticStat(8, 1, '100'), workerRawStatAfter: syntheticStat(8, 1, '100'), workerStartTicks: '100',
    pidNamespaceBefore: 'pid:[1234]', pidNamespaceAfter: 'pid:[1234]', workerPidNamespaceBefore: 'pid:[1234]', workerPidNamespaceAfter: 'pid:[1234]', bootIdBefore: `${context.hostBootId}\n`, bootIdAfter: `${context.hostBootId}\n` };
}
const context = { generation: 1, manifestSha256: 'a'.repeat(64), priorCleanupSha256: null, hostBootId: boot, hostPid: 100, startedNs: '900' };
test('child stat parser uses field22 after final parenthesis, keeps exact PID/parent and rejects missing/malformed/dead evidence', () => {
  assert.deepEqual(api.parseNativeProcessStat(syntheticStat(9, 8, '200', 'a ) b (c)'), 9), { pid: 9, parentPid: 8, startTicks: '200', state: 'S' });
  assert.equal(api.parseNativeProcessStat(syntheticStat(1, 0, '100'), 1).parentPid, 0, 'namespace PID1 worker can have parent zero');
  for (const raw of ['', '9 (bad) S 8', syntheticStat(9, 8, '0'), syntheticStat(9, 8, 'nan'), syntheticStat(9, 8, '200').replace(') S ', ') Z ')]) assert.throws(() => api.parseNativeProcessStat(raw, 9));
  assert.throws(() => api.parseNativeProcessStat(syntheticStat(10, 8, '200'), 9));
});
test('qualified observed native lifetime rejects forged/raw disagreements, stale parent/context/boot and close ordering', () => {
  const positive = syntheticLifetime(context); api.assertNativeProcessLifetime(positive, context, true);
  for (const cause of ['version', 'pid', 'worker', 'parent', 'raw-ticks', 'race-ticks', 'race-namespace', 'foreign-namespace', 'boot', 'context', 'missing', 'close-pid', 'close-before-observation', 'observation-before-spawn']) {
    const bad: any = structuredClone(positive);
    if (cause === 'version') delete bad.version;
    if (cause === 'pid') bad.pid = 10;
    if (cause === 'worker') bad.workerPid = 7;
    if (cause === 'parent') bad.rawStatBefore = bad.rawStatAfter = syntheticStat(9, 7, '200');
    if (cause === 'raw-ticks') bad.startTicks = '201';
    if (cause === 'race-ticks') bad.rawStatAfter = syntheticStat(9, 8, '201');
    if (cause === 'race-namespace') bad.pidNamespaceAfter = 'pid:[4321]';
    if (cause === 'foreign-namespace') bad.workerPidNamespaceBefore = bad.workerPidNamespaceAfter = 'pid:[4321]';
    if (cause === 'boot') bad.bootIdAfter = `${boot.slice(0,-1)}6\n`;
    if (cause === 'context') bad.context.generation = 2;
    if (cause === 'missing') delete bad.rawStatBefore;
    if (cause === 'close-pid') bad.close.pid = 10;
    if (cause === 'close-before-observation') bad.close.atNs = bad.observationEndNs;
    if (cause === 'observation-before-spawn') bad.observationBeginNs = '999';
    assert.throws(() => api.assertNativeProcessLifetime(bad, context, true), cause);
  }
  assert.throws(() => api.assertNativeProcessLifetime({ pid: 9, pidNamespace: 'pid:[4026532474]', closeObserved: true }, context, true), 'old acquired metadata is insufficient');
});

test('spawn observation reads actual child paths while live, preserves partial failure and refuses racing or overlarge proc evidence', () => {
  const observe = (cause?: string) => {
    let clock = 1000n, childReads = 0, bootReads = 0; const paths: string[] = [];
    const value = api.observeNativeProcessSpawn(9, context, { workerPid: 8, now: () => String(clock++), readlink: (path: string) => { paths.push(path); return 'pid:[1234]'; }, read: (path: string) => {
      paths.push(path);
      if (path.endsWith('/boot_id')) return bootReads++ && cause === 'boot-race' ? '11111111-2222-3333-4444-555555555556\n' : `${boot}\n`;
      if (path === '/proc/self/stat') return syntheticStat(8,1,'100');
      if (cause === 'missing') throw new Error('mock disappeared child');
      if (cause === 'oversize') return 'x'.repeat(4097);
      return syntheticStat(9,8,childReads++ && cause === 'tick-race' ? '201' : '200');
    } });
    return { value, paths };
  };
  const positive = observe(); api.assertNativeProcessLifetime(positive.value, context, false); assert.ok(positive.paths.includes('/proc/9/stat')); assert.ok(positive.paths.includes('/proc/9/ns/pid')); assert.equal(positive.paths.filter(path => path === '/proc/9/stat').length, 2);
  for (const cause of ['missing','oversize','boot-race','tick-race']) { const bad = observe(cause); assert.ok(bad.value.observationError, cause); assert.ok(bad.value.workerRawStatBefore, 'partial actual bytes retained'); assert.throws(() => api.assertNativeProcessLifetime(bad.value, context, false)); }
});
