import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashBytes } from '../packages/release/artifacts.ts';
import { closeControls, controlSocket, serveControls } from './cli.ts';
import { assertPrivateHostDirectory, contentAddressedEvidence, readHostFile } from './host-policy.ts';
import { ServiceSupervisor } from './supervisor.ts';

test('private host reads reject redirected, linked, oversized and public files; evidence requires private storage', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-host-reads-'));
  try {
    const privateFile = join(root, 'private'); writeFileSync(privateFile, 'private', { mode: 0o600 });
    assert.equal(readHostFile(privateFile).toString(), 'private');
    assert.throws(() => readHostFile('/usr/local/host-reviewer.key'), /worker system mounts/);
    assert.throws(() => assertPrivateHostDirectory('/usr/local/host-state'), /worker system mounts/);
    assert.throws(() => readHostFile(privateFile, 6), /byte limit/);
    const oversized = join(root, 'oversized'); writeFileSync(oversized, '', { mode: 0o600 }); truncateSync(oversized, 8 * 1024 * 1024 + 1);
    assert.throws(() => readHostFile(oversized), /byte limit/);
    const symlink = join(root, 'redirect'); symlinkSync(privateFile, symlink);
    assert.throws(() => readHostFile(symlink));
    const link = join(root, 'linked'); linkSync(privateFile, link);
    assert.throws(() => readHostFile(privateFile), /singly linked/); rmSync(link);
    chmodSync(privateFile, 0o644); assert.throws(() => readHostFile(privateFile), /owner-only/);
    const evidence = join(root, 'evidence'); mkdirSync(evidence, { mode: 0o700 });
    const bytes = Buffer.from('private evaluation observations'), digest = hashBytes(bytes), blob = join(evidence, digest);
    writeFileSync(blob, bytes, { mode: 0o600 }); const read = contentAddressedEvidence(evidence);
    assert.deepEqual(read(`sha256:${digest}`), bytes);
    chmodSync(blob, 0o644); assert.throws(() => read(`sha256:${digest}`), /owner-only/);
    chmodSync(blob, 0o600); chmodSync(evidence, 0o755);
    assert.throws(() => read(`sha256:${digest}`), /owner-only/);
    assert.throws(() => assertPrivateHostDirectory(evidence), /owner-only/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('control shutdown closes incomplete, in-flight and backpressured Unix socket clients', { timeout: 5000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-controls-'));
  let resolveCommand!: (value: unknown) => void, invoked!: () => void;
  const entered = new Promise<void>(resolve => { invoked = resolve; });
  const result = new Promise<unknown>(resolve => { resolveCommand = resolve; });
  const supervisor = { command: async (command: { kind: string }) => { if (command.kind === 'status') return 'x'.repeat(4 * 1024 * 1024); invoked(); return result; } } as unknown as ServiceSupervisor;
  const server = await serveControls(supervisor, root), clients: Socket[] = [];
  try {
    async function connect(): Promise<Socket> {
      const socket = createConnection(controlSocket(root)); socket.on('error', () => {}); clients.push(socket);
      await once(socket, 'connect'); return socket;
    }
    const incomplete = await connect(); incomplete.write('{');
    const inflight = await connect(); inflight.write('{"kind":"recover"}\n'); await entered;
    const backpressured = await connect(); backpressured.pause(); backpressured.write('{"kind":"status"}\n');
    await new Promise(resolve => setImmediate(resolve));
    await closeControls(server);
    assert.equal(server.listening, false);
    resolveCommand({ complete: true });
    await new Promise(resolve => setImmediate(resolve));
    // The already admitted host operation may finish; no connection can hold the host lease open.
    assert.equal([incomplete, inflight].every(socket => socket.destroyed || socket.readableEnded), true);
  } finally {
    resolveCommand({ complete: true }); clients.forEach(socket => socket.destroy());
    if (server.listening) await closeControls(server);
    rmSync(root, { recursive: true, force: true });
  }
});

test('supervisor rejects public or overlapping host roots before creating authority journals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-host-roots-'));
  try {
    const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work'), artifactStore = join(root, 'artifacts');
    for (const path of [stateDirectory, workspaceDirectory, artifactStore]) mkdirSync(path, { mode: 0o700 });
    const options = { host: { stateDirectory, workspaceDirectory, artifactStore, nodeBinary: process.execPath },
      mode: 'engineering' as const, secrets: { mistralApiKey: 'offline', directToken: 'offline' },
      getPolicy() { throw new Error('No policy must be read'); }, readArtifact() { throw new Error('No evidence must be read'); } };
    chmodSync(stateDirectory, 0o755);
    await assert.rejects(ServiceSupervisor.open(options), /owner-only/);
    assert.equal(existsSync(join(stateDirectory, 'supervisor-lease.sqlite')), false);
    chmodSync(stateDirectory, 0o700);
    await assert.rejects(ServiceSupervisor.open({ ...options, host: { ...options.host, artifactStore: workspaceDirectory } }), /disjoint/);
    assert.equal(existsSync(join(stateDirectory, 'authority.sqlite')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
