import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyPreparedNativeInputs } from '../scripts/systemd-native-inputs.ts';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-native-inputs-')); mkdirSync(join(root, 'trusted'));
  const source = '/* deterministic fixture, not a compiled production launcher */\n';
  const binary = Buffer.alloc(64); binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); binary[18] = 0x3e;
  const receipt = JSON.stringify({ version: 1, arch: 'x64', sourceSha256: hash(source), binarySha256: hash(binary) });
  const admitted = { sourceSha256: hash(source), binarySha256: hash(binary), receiptSha256: hash(receipt) };
  writeFileSync(join(root, 'trusted/linux-isolation-launcher.c'), source, { mode: 0o400 });
  writeFileSync(join(root, 'trusted/linux-isolation-launcher'), binary, { mode: 0o500 });
  writeFileSync(join(root, 'trusted/linux-isolation-launcher.json'), receipt, { mode: 0o400 });
  return { root, source, binary, admitted, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('prepared native files match independently supplied admitted source, ELF and receipt identities', () => {
  const f = fixture(); try {
    const inputs = verifyPreparedNativeInputs(f.root, f.admitted);
    assert.deepEqual(inputs.map(file => file.path), ['trusted/linux-isolation-launcher.c', 'trusted/linux-isolation-launcher', 'trusted/linux-isolation-launcher.json']);
    assert.equal(inputs[1]!.mode, '100755');
  } finally { f.close(); }
});

test('a jointly changed binary and matching receipt cannot replace admitted native inputs', () => {
  const f = fixture(); try {
    const binary = Buffer.concat([f.binary, Buffer.from('changed')]);
    const receipt = JSON.stringify({ version: 1, arch: 'x64', sourceSha256: f.admitted.sourceSha256, binarySha256: hash(binary) });
    chmodSync(join(f.root, 'trusted/linux-isolation-launcher'), 0o700); writeFileSync(join(f.root, 'trusted/linux-isolation-launcher'), binary);
    chmodSync(join(f.root, 'trusted/linux-isolation-launcher.json'), 0o600); writeFileSync(join(f.root, 'trusted/linux-isolation-launcher.json'), receipt);
    assert.throws(() => verifyPreparedNativeInputs(f.root, f.admitted), /admitted|identity/i);
  } finally { f.close(); }
});

test('native inputs reject links, writable-by-others modes and malformed receipts', () => {
  const f = fixture(); try {
    const path = join(f.root, 'trusted/linux-isolation-launcher.json'), bytes = readFileSync(path);
    chmodSync(path, 0o600); writeFileSync(path, '{}');
    assert.throws(() => verifyPreparedNativeInputs(f.root, { ...f.admitted, receiptSha256: hash('{}') }), /receipt/i);
    writeFileSync(path, bytes); chmodSync(path, 0o666);
    assert.throws(() => verifyPreparedNativeInputs(f.root, f.admitted), /regular|writable/i);
    rmSync(path); const alternate = join(f.root, 'outside.json'); writeFileSync(alternate, bytes); symlinkSync(alternate, path);
    assert.throws(() => verifyPreparedNativeInputs(f.root, f.admitted), /regular|link/i);
  } finally { f.close(); }
});

test('missing or incomplete admission hashes never turn a matching current receipt into approval', () => {
  const f = fixture(); try {
    assert.throws(() => verifyPreparedNativeInputs(f.root, { ...f.admitted, receiptSha256: '' }), /admitted/i);
    assert.throws(() => verifyPreparedNativeInputs(f.root, { ...f.admitted, sourceSha256: '0'.repeat(64) }), /admitted|identity/i);
  } finally { f.close(); }
});
