// Trusted one-request helper. The host supplies fixed roots/limits and holds the
// exclusive writer claim through process close. Seatbelt supplies the external
// path boundary; these checks separately reject links and unsupported entries.
import * as fs from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

class Failure extends Error { constructor(code, conflict) { super(code); this.code = code; this.conflict = conflict; } }
const fail = (code, conflict) => { throw new Failure(code, conflict); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
let root, stage, limits;

function pathName(path) {
  if (typeof path !== 'string' || !path || Buffer.byteLength(path) > 1024 || /[\x00-\x1f\x7f-\x9f]/.test(path)
      || Buffer.from(path, 'utf8').toString('utf8') !== path
      || path.includes('\\') || path.startsWith('/') || path.split('/').length > 64
      || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) fail('invalid-path');
  return path;
}
function directory(path) {
  const stat = fs.lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7000)) fail('unsupported-entry');
  return stat;
}
function emptyDirectory(path) {
  const handle = fs.opendirSync(path); try { return handle.readSync() === null; } finally { handle.closeSync(); }
}
function location(path) {
  pathName(path); directory(root);
  const parts = path.split('/'); let parent = root;
  for (const part of parts.slice(0, -1)) { parent = join(parent, part); directory(parent); }
  return join(parent, parts.at(-1));
}
function regular(stat) {
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o7000)
      || ![0o644, 0o755].includes(stat.mode & 0o777)) fail('unsupported-entry');
  if (stat.size > limits.maxFileBytes) fail('limit-exceeded');
}
function readRegular(path) {
  // NONBLOCK prevents a race to a FIFO from blocking before fstat can reject it.
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd); regular(before);
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) fail('conflict'); offset += n; }
    const after = fs.fstatSync(fd); regular(after);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('conflict');
    return { bytes, state: { sha256: digest(bytes), bytes: bytes.length, mode: after.mode & 0o777 } };
  } finally { fs.closeSync(fd); }
}
function state(path) {
  const absolute = location(path); let stat;
  try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (stat.isDirectory()) { directory(absolute); return { directory: true, empty: emptyDirectory(absolute) }; }
  regular(stat); return readRegular(absolute).state;
}
function scan() {
  const files = [], directories = []; let count = 0, total = 0;
  function walk(relativePath) {
    const dir = relativePath ? location(relativePath) : root; directory(dir);
    const handle = fs.opendirSync(dir); const names = [];
    try { for (let entry; (entry = handle.readSync()); ) { if (++count > limits.maxFiles) fail('limit-exceeded'); names.push(entry.name); } }
    finally { handle.closeSync(); }
    names.sort();
    for (const name of names) {
      const path = pathName(relativePath ? `${relativePath}/${name}` : name); const absolute = location(path);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) { directories.push(path); walk(path); }
      else { regular(stat); const value = readRegular(absolute); total += value.state.bytes;
        if (total > limits.maxTotalBytes) fail('limit-exceeded'); files.push({ path, ...value.state }); }
    }
  }
  walk(''); files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  directories.sort(); return { files, directories, total, count };
}
function text(bytes) { try { return decoder.decode(bytes); } catch { fail('unsupported-encoding'); } }
function content(value) {
  if (typeof value !== 'string') fail('invalid-request');
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > limits.maxFileBytes) fail('limit-exceeded');
  if (text(bytes) !== value) fail('unsupported-encoding');
  return bytes;
}
function expected(value, actual, path) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'mode,sha256'
      || !/^[a-f0-9]{64}$/.test(value.sha256) || ![0o644, 0o755].includes(value.mode)) fail('invalid-request');
  if (!actual || actual.directory || value.sha256 !== actual.sha256 || value.mode !== actual.mode) fail('conflict', { path, current: actual });
}
function mode(value) { if (![0o644, 0o755].includes(value)) fail('invalid-request'); return value; }
function flushDirectory(path) { const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeExclusive(path, bytes, permissions) {
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, permissions);
  try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, permissions); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function encoded(response) {
  const json = JSON.stringify(response);
  if (Buffer.byteLength(json) + 1 > limits.maxResponseBytes) fail('response-limit');
  return json;
}
function operationDirectory(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) fail('invalid-request');
  directory(stage); return join(stage, id);
}
function manifestAt(id) {
  const dir = operationDirectory(id);
  try { directory(dir); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const path = join(dir, 'manifest.json'); let raw;
  // Staged records use 0600 rather than source modes; validate before read.
  let fd; try { fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) fail('invalid-stage');
    raw = Buffer.alloc(stat.size); if (fs.readSync(fd, raw, 0, raw.length, 0) !== raw.length) fail('invalid-stage'); }
  finally { fs.closeSync(fd); }
  let record; try { record = JSON.parse(text(raw)); } catch { fail('invalid-stage'); }
  const identity = directory(root);
  if (!object(record) || record.version !== 1 || record.operationId !== id || record.rootDevice !== identity.dev || record.rootInode !== identity.ino
      || !/^[a-f0-9]{64}$/.test(record.operationDigest) || !Array.isArray(record.changes) || record.changes.length < 1 || record.changes.length > 2) fail('invalid-stage');
  const paths = new Set();
  for (const change of record.changes) {
    if (!object(change) || paths.has(pathName(change.path))) fail('invalid-stage'); paths.add(change.path);
    for (const value of [change.before, change.after]) {
      if (value === null) continue;
      if (!object(value) || !(equal(value, { directory: true, empty: true }) || (/^[a-f0-9]{64}$/.test(value.sha256)
          && integer(value.bytes, 0, limits.maxFileBytes) && [0o644, 0o755].includes(value.mode)
          && Object.keys(value).sort().join(',') === 'bytes,mode,sha256'))) fail('invalid-stage');
    }
  }
  return record;
}
function observe(record) {
  if (!record) return { status: 'not-staged', changes: [] };
  let actual; try { actual = record.changes.map(change => state(change.path)); } catch { return { status: 'uncertain', changes: record.changes }; }
  const post = record.changes.every((change, i) => equal(change.after, actual[i]));
  const pre = record.changes.every((change, i) => equal(change.before, actual[i]));
  // A no-op has identical pre/post; avoid claiming it changed a file.
  return { status: post ? 'completed' : pre ? 'not-completed' : 'uncertain', changes: record.changes };
}
function mutate(operation, id, current) {
  const operationDigest = digest(JSON.stringify(operation)); const prior = manifestAt(id);
  if (prior) { if (prior.operationDigest !== operationDigest) fail('operation-conflict'); return observe(prior); }
  const before = state(operation.path); const changes = []; let newBytes;
  const change = (path, before, after) => changes.push({ path, before, after });
  switch (operation.kind) {
    case 'create':
    case 'replace':
    case 'edit': {
      if (operation.kind === 'create') { if (before !== null) fail('conflict', { path: operation.path, current: before }); }
      else expected(operation.expected, before, operation.path);
      let newMode;
      if (operation.kind === 'edit') {
        if (typeof operation.oldText !== 'string' || !operation.oldText || typeof operation.newText !== 'string') fail('invalid-request');
        const old = text(readRegular(location(operation.path)).bytes); const index = old.indexOf(operation.oldText);
        if (index < 0 || old.indexOf(operation.oldText, index + 1) >= 0) fail('conflict', { path: operation.path, matches: index < 0 ? 'none' : 'multiple' });
        newBytes = content(old.slice(0, index) + operation.newText + old.slice(index + operation.oldText.length)); newMode = before.mode;
      } else { newBytes = content(operation.content); newMode = mode(operation.mode); }
      change(operation.path, before, { sha256: digest(newBytes), bytes: newBytes.length, mode: newMode }); break;
    }
    case 'delete': expected(operation.expected, before, operation.path); change(operation.path, before, null); break;
    case 'move': {
      expected(operation.expected, before, operation.path); pathName(operation.destination);
      const destination = state(operation.destination);
      if (destination !== null) fail('conflict', { path: operation.destination, current: destination });
      change(operation.path, before, null); change(operation.destination, null, before); break;
    }
    case 'mkdir': if (before !== null) fail('conflict', { path: operation.path, current: before }); change(operation.path, null, { directory: true, empty: true }); break;
    case 'rmdir': if (!before?.directory || !before.empty) fail('conflict', { path: operation.path, current: before }); change(operation.path, before, null); break;
    default: fail('invalid-request');
  }
  const total = current.total + changes.reduce((sum, x) => sum + (x.after?.bytes ?? 0) - (x.before?.bytes ?? 0), 0);
  const count = current.count + changes.reduce((sum, x) => sum + Number(x.after !== null) - Number(x.before !== null), 0);
  if (total > limits.maxTotalBytes || count > limits.maxFiles) fail('limit-exceeded');
  encoded({ ok: true, result: { status: 'completed', changes } }); // reject oversized receipt BEFORE effects
  const identity = directory(root); const record = { version: 1, operationId: id, operationDigest, rootDevice: identity.dev, rootInode: identity.ino, changes };
  const dir = operationDirectory(id); fs.mkdirSync(dir, { mode: 0o700 }); flushDirectory(stage);
  if (newBytes !== undefined) writeExclusive(join(dir, 'content'), newBytes, changes[0].after.mode);
  writeExclusive(join(dir, 'manifest.tmp'), Buffer.from(JSON.stringify(record)), 0o600);
  fs.renameSync(join(dir, 'manifest.tmp'), join(dir, 'manifest.json')); flushDirectory(dir);
  // The durable record is present before the first workspace mutation. Every
  // recovery call observes states; it never repeats the rename/delete sequence.
  for (const x of changes) if (!equal(state(x.path), x.before)) fail('conflict');
  const source = location(operation.path);
  if (newBytes !== undefined) fs.renameSync(join(dir, 'content'), source);
  else if (operation.kind === 'delete') fs.renameSync(source, join(dir, 'tombstone'));
  else if (operation.kind === 'move') fs.renameSync(source, location(operation.destination));
  else if (operation.kind === 'mkdir') fs.mkdirSync(source, { mode: 0o755 });
  else fs.rmdirSync(source);
  flushDirectory(dir);
  for (const path of new Set(changes.map(x => resolve(location(x.path), '..')))) flushDirectory(path);
  const result = observe(record); if (result.status !== 'completed') fail('uncertain'); return result;
}
// Checkpoint controls are host-only: fixed staging namespace, no source writes.
function checkpointRoot(request) {
  if (!/^[a-f0-9]{64}$/.test(request.operationId) || !object(request.expectedRoot)
      || Object.keys(request.expectedRoot).sort().join(',') !== 'device,inode'
      || !integer(request.expectedRoot.device, 0, Number.MAX_SAFE_INTEGER)
      || !integer(request.expectedRoot.inode, 0, Number.MAX_SAFE_INTEGER)) fail('invalid-request');
  const stat = fs.lstatSync(root);
  // Reads deliberately do not traverse or grade the possibly damaged draft.
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== request.expectedRoot.device
      || stat.ino !== request.expectedRoot.inode) fail('root-conflict');
  return stat;
}
function privateCheckpointDirectory(path, permissions) {
  const stat = directory(path);
  if ((stat.mode & 0o777) !== permissions) fail('invalid-checkpoint');
}
function checkpointSummary(record) {
  return { checkpointDigest: record.checkpointDigest, treeDigest: record.treeDigest, fullTreeDigest: record.fullTreeDigest,
    files: record.files, directories: record.directories, rootMode: record.rootMode, totalBytes: record.totalBytes };
}
function checkpointLayout(files, directories, rootMode) {
  if (![0o700, 0o755].includes(rootMode) || !Array.isArray(files) || !Array.isArray(directories)
      || files.length + directories.length > limits.maxFiles) fail('invalid-checkpoint');
  const names = new Set(), directoryNames = new Set(); let total = 0;
  for (const entry of [...directories, ...files]) {
    if (!object(entry)) fail('invalid-checkpoint');
    pathName(entry.path); const key = entry.path.normalize('NFC').toLocaleLowerCase('en-US');
    if (names.has(key)) fail('invalid-checkpoint'); names.add(key);
  }
  for (const entry of directories) {
    if (Object.keys(entry).sort().join(',') !== 'mode,path' || ![0o700, 0o755].includes(entry.mode)) fail('invalid-checkpoint');
    directoryNames.add(entry.path);
  }
  for (const entry of files) {
    if (Object.keys(entry).sort().join(',') !== 'bytes,mode,path,sha256' || !/^[a-f0-9]{64}$/.test(entry.sha256)
        || !integer(entry.bytes, 0, limits.maxFileBytes) || ![0o644, 0o755].includes(entry.mode)) fail('invalid-checkpoint');
    total += entry.bytes; if (total > limits.maxTotalBytes) fail('limit-exceeded');
  }
  for (const entry of [...directories, ...files]) {
    const components = entry.path.split('/');
    while (components.length > 1) { components.pop(); if (!directoryNames.has(components.join('/'))) fail('invalid-checkpoint'); }
  }
  for (const entries of [files, directories])
    if (entries.some((entry, index) => index && entries[index - 1].path >= entry.path)) fail('invalid-checkpoint');
  return total;
}
function sealedBytes(path, expectedMode, maximum) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o7000) || (before.mode & 0o777) !== expectedMode
        || before.size > maximum) fail('invalid-checkpoint');
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) fail('invalid-checkpoint'); offset += n; }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.ctimeMs !== before.ctimeMs || after.mtimeMs !== before.mtimeMs
        || after.nlink !== 1 || after.mode !== before.mode) fail('invalid-checkpoint');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function verifiedCheckpoint(request, expectedDigest) {
  const identity = checkpointRoot(request), dir = operationDirectory(request.operationId), checkpoint = join(dir, 'checkpoint');
  privateCheckpointDirectory(stage, 0o700); privateCheckpointDirectory(dir, 0o700); privateCheckpointDirectory(checkpoint, 0o500);
  if (!equal(fs.readdirSync(checkpoint).sort(), ['manifest.json', 'tree'])) fail('invalid-checkpoint');
  let record; try { record = JSON.parse(text(sealedBytes(join(checkpoint, 'manifest.json'), 0o400, Math.min(1024 * 1024, limits.maxResponseBytes)))); } catch { fail('invalid-checkpoint'); }
  if (!object(record) || Object.keys(record).sort().join(',') !== 'checkpointDigest,directories,files,fullTreeDigest,operationId,rootDevice,rootInode,rootMode,totalBytes,treeDigest,version'
      || record.version !== 1 || record.operationId !== request.operationId || record.rootDevice !== identity.dev || record.rootInode !== identity.ino
      || !/^[a-f0-9]{64}$/.test(record.checkpointDigest)) fail('invalid-checkpoint');
  const { checkpointDigest, ...body } = record;
  if (digest(JSON.stringify(body)) !== checkpointDigest || (expectedDigest !== undefined && checkpointDigest !== expectedDigest)) fail('checkpoint-conflict');
  const total = checkpointLayout(record.files, record.directories, record.rootMode);
  if (total !== record.totalBytes || record.treeDigest !== digest(JSON.stringify(record.files))
      || record.fullTreeDigest !== digest(JSON.stringify({ files: record.files, directories: record.directories, rootMode: record.rootMode }))) fail('invalid-checkpoint');
  const tree = join(checkpoint, 'tree'), actualFiles = [], actualDirectories = []; let count = 0;
  function walk(path) {
    const absolute = path ? join(tree, path) : tree; privateCheckpointDirectory(absolute, 0o500);
    const names = fs.readdirSync(absolute).sort();
    for (const name of names) {
      if (++count > limits.maxFiles) fail('limit-exceeded');
      const relativePath = pathName(path ? `${path}/${name}` : name), target = join(tree, relativePath); const stat = fs.lstatSync(target);
      if (stat.isDirectory() && !stat.isSymbolicLink()) { actualDirectories.push(relativePath); walk(relativePath); }
      else {
        const file = record.files.find(entry => entry.path === relativePath); if (!file) fail('invalid-checkpoint');
        const bytes = sealedBytes(target, file.mode === 0o755 ? 0o500 : 0o400, limits.maxFileBytes);
        if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) fail('invalid-checkpoint'); actualFiles.push(relativePath);
      }
    }
  }
  walk(''); actualFiles.sort(); actualDirectories.sort();
  if (!equal(actualFiles, record.files.map(file => file.path)) || !equal(actualDirectories, record.directories.map(dir => dir.path))) fail('invalid-checkpoint');
  checkpointRoot(request); return { record, tree };
}
function checkpointEntryExists(path) {
  try { fs.lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function captureCheckpoint(request, operation) {
  if (!/^[a-f0-9]{64}$/.test(operation.expectedTreeDigest)) fail('invalid-request');
  const identity = checkpointRoot(request); privateCheckpointDirectory(stage, 0o700);
  const dir = operationDirectory(request.operationId), checkpoint = join(dir, 'checkpoint'), partial = join(dir, '.checkpoint-partial');
  if (checkpointEntryExists(checkpoint)) {
    const { record } = verifiedCheckpoint(request);
    if (record.treeDigest !== operation.expectedTreeDigest) fail('operation-conflict');
    return checkpointSummary(record); // Observe the sealed copy; never re-copy.
  }
  if (checkpointEntryExists(partial)) fail('checkpoint-incomplete');
  const current = scan(); const rootMode = identity.mode & 0o777;
  const directories = current.directories.map(path => ({ path, mode: directory(location(path)).mode & 0o777 }));
  const totalBytes = checkpointLayout(current.files, directories, rootMode), treeDigest = digest(JSON.stringify(current.files));
  if (treeDigest !== operation.expectedTreeDigest) fail('tree-conflict');
  const body = { version: 1, operationId: request.operationId, rootDevice: identity.dev, rootInode: identity.ino, rootMode,
    treeDigest, fullTreeDigest: digest(JSON.stringify({ files: current.files, directories, rootMode })), files: current.files, directories, totalBytes };
  const record = { ...body, checkpointDigest: digest(JSON.stringify(body)) }; const raw = JSON.stringify(record);
  if (Buffer.byteLength(raw) > Math.min(1024 * 1024, limits.maxResponseBytes)) fail('response-limit');
  encoded({ ok: true, result: checkpointSummary(record) }); // Preflight before any copy.
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 }); privateCheckpointDirectory(dir, 0o700);
  fs.mkdirSync(partial, { mode: 0o700 }); const tree = join(partial, 'tree'); fs.mkdirSync(tree, { mode: 0o700 });
  for (const entry of directories) fs.mkdirSync(join(tree, entry.path), { mode: 0o700 });
  for (const file of current.files) {
    const value = readRegular(location(file.path));
    if (!equal(value.state, { sha256: file.sha256, bytes: file.bytes, mode: file.mode })) fail('tree-conflict');
    writeExclusive(join(tree, file.path), value.bytes, file.mode === 0o755 ? 0o500 : 0o400);
  }
  const after = scan(); const afterDirectories = after.directories.map(path => ({ path, mode: directory(location(path)).mode & 0o777 }));
  checkpointRoot(request);
  if (!equal(current.files, after.files) || !equal(directories, afterDirectories) || (fs.lstatSync(root).mode & 0o777) !== rootMode) fail('tree-conflict');
  const seal = path => { for (const name of fs.readdirSync(path)) { const child = join(path, name); if (fs.lstatSync(child).isDirectory()) seal(child); } flushDirectory(path); fs.chmodSync(path, 0o500); };
  seal(tree);
  writeExclusive(join(partial, '.manifest-partial'), Buffer.from(raw), 0o400); fs.renameSync(join(partial, '.manifest-partial'), join(partial, 'manifest.json'));
  flushDirectory(partial); fs.chmodSync(partial, 0o500); fs.renameSync(partial, checkpoint); flushDirectory(dir); flushDirectory(stage);
  return checkpointSummary(verifiedCheckpoint(request, record.checkpointDigest).record);
}
function readCheckpoint(request, operation) {
  if (!/^[a-f0-9]{64}$/.test(operation.checkpointDigest)) fail('invalid-request');
  const { record, tree } = verifiedCheckpoint(request, operation.checkpointDigest);
  if (operation.path === undefined) { if (operation.startByte !== undefined || operation.endByte !== undefined) fail('invalid-request'); return checkpointSummary(record); }
  pathName(operation.path); const file = record.files.find(entry => entry.path === operation.path); if (!file) fail('not-found');
  const startByte = operation.startByte === undefined ? 0 : operation.startByte;
  const endByte = operation.endByte === undefined ? Math.min(file.bytes, startByte + 131072) : operation.endByte;
  if (!integer(startByte, 0, file.bytes) || !integer(endByte, startByte, file.bytes) || endByte - startByte > 131072) fail('invalid-range');
  const bytes = sealedBytes(join(tree, file.path), file.mode === 0o755 ? 0o500 : 0o400, limits.maxFileBytes);
  if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) fail('invalid-checkpoint');
  checkpointRoot(request);
  return { ...file, checkpointDigest: record.checkpointDigest, startByte, endByte, base64: bytes.subarray(startByte, endByte).toString('base64') };
}

function run(request) {
  if (!object(request) || request.version !== 1 || !object(request.operation) || !object(request.limits)
      || Object.keys(request).some(key => !['version', 'operation', 'operationId', 'expectedOperationDigest', 'expectedRoot', 'limits'].includes(key))) fail('invalid-request');
  limits = request.limits;
  const maxima = { maxFiles: 10000, maxTotalBytes: 64 * 1024 * 1024, maxFileBytes: 16 * 1024 * 1024, maxResponseBytes: 4 * 1024 * 1024, maxResults: 1000 };
  if (Object.keys(limits).sort().join(',') !== Object.keys(maxima).sort().join(',')
      || Object.entries(maxima).some(([key, max]) => !integer(limits[key], key === 'maxResponseBytes' ? 64 : 1, max))) fail('invalid-request');
  const operation = request.operation;
  const fields = {
    manifest: [], list: ['path', 'cursor'], search: ['query', 'cursor'], read: ['path', 'expectedSha256', 'startByte', 'endByte'],
    create: ['path', 'content', 'mode'], replace: ['path', 'content', 'mode', 'expected'], edit: ['path', 'oldText', 'newText', 'expected'],
    checkpoint: ['expectedTreeDigest'], 'checkpoint-read': ['checkpointDigest', 'path', 'startByte', 'endByte'],
    delete: ['path', 'expected'], move: ['path', 'destination', 'expected'], mkdir: ['path'], rmdir: ['path'], observe: [],
  };
  if (!Object.hasOwn(fields, operation.kind) || Object.keys(operation).some(key => key !== 'kind' && !fields[operation.kind].includes(key))) fail('invalid-request');
  if (operation.kind === 'observe') {
    if (!/^[a-f0-9]{64}$/.test(request.expectedOperationDigest)) fail('invalid-request');
    const record = manifestAt(request.operationId);
    if (record && record.operationDigest !== request.expectedOperationDigest) fail('operation-conflict');
    return observe(record);
  }
  if (request.expectedOperationDigest !== undefined) fail('invalid-request');
  if (operation.kind === 'checkpoint') return captureCheckpoint(request, operation);
  if (operation.kind === 'checkpoint-read') return readCheckpoint(request, operation);
  const current = scan();
  if (operation.kind === 'manifest') return { files: current.files };
  if (operation.kind === 'list') {
    if (operation.path !== undefined) { pathName(operation.path); directory(location(operation.path)); }
    if (operation.cursor !== undefined) pathName(operation.cursor);
    const prefix = operation.path === undefined ? '' : operation.path + '/';
    const eligible = [...current.files.map(file => file.path), ...current.directories].sort()
      .filter(path => path.startsWith(prefix) && (operation.cursor === undefined || path > operation.cursor));
    const page = eligible.slice(0, limits.maxResults); const truncated = eligible.length > page.length; const selected = new Set(page);
    return { files: current.files.filter(file => selected.has(file.path)), directories: current.directories.filter(path => selected.has(path)),
      truncated, nextCursor: truncated ? page.at(-1) : null };
  }
  if (operation.kind === 'read') {
    const value = readRegular(location(operation.path));
    if (operation.expectedSha256 !== undefined && operation.expectedSha256 !== value.state.sha256) fail('conflict', { path: operation.path, current: value.state });
    text(value.bytes); const startByte = operation.startByte ?? 0, endByte = operation.endByte ?? value.bytes.length;
    if (!integer(startByte, 0, value.bytes.length) || !integer(endByte, startByte, value.bytes.length)) fail('invalid-range');
    let selected; try { selected = decoder.decode(value.bytes.subarray(startByte, endByte));
      decoder.decode(value.bytes.subarray(0, startByte)); decoder.decode(value.bytes.subarray(endByte)); } catch { fail('invalid-range'); }
    return { path: operation.path, ...value.state, text: selected, startByte, endByte };
  }
  if (operation.kind === 'search') {
    if (typeof operation.query !== 'string' || !operation.query || Buffer.byteLength(operation.query) > 4096
        || !integer(operation.cursor ?? 0, 0, Number.MAX_SAFE_INTEGER)) fail('invalid-request');
    const matches = []; let index = 0, skippedBinaryFiles = 0; const cursor = operation.cursor ?? 0; let truncated = false;
    for (const file of current.files) {
      let lines; try { lines = text(readRegular(location(file.path)).bytes).split('\n'); }
      catch (error) { if (error instanceof Failure && error.code === 'unsupported-encoding') { skippedBinaryFiles++; continue; } throw error; }
      for (let line = 0; line < lines.length; line++) if (lines[line].includes(operation.query)) {
        if (index++ < cursor) continue;
        if (matches.length === limits.maxResults) { truncated = true; continue; }
        matches.push({ path: file.path, line: line + 1, text: lines[line] });
      }
    }
    return { matches, skippedBinaryFiles, truncated, nextCursor: truncated ? cursor + matches.length : null };
  }
  pathName(operation.path); return mutate(operation, request.operationId, current);
}

let response;
try {
  if (process.argv.length !== 4) fail('invalid-request');
  // Trusted argv only: the helper never accepts roots from model JSON.
  root = fs.realpathSync(process.argv[2]); stage = fs.realpathSync(process.argv[3]);
  const rootStat = fs.lstatSync(root), stageStat = directory(stage);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('invalid-roots');
  const outside = (from, to) => { const path = relative(from, to); return path === '..' || path.startsWith('../'); };
  if (!outside(root, stage) || !outside(stage, root) || rootStat.dev !== stageStat.dev) fail('invalid-roots');
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 1024 * 1024) fail('input-limit'); chunks.push(chunk); }
  let request; try { request = JSON.parse(text(Buffer.concat(chunks))); } catch { fail('invalid-request'); }
  response = encoded({ ok: true, result: run(request) });
} catch (error) {
  const code = error instanceof Failure ? error.code : error.code === 'ENOENT' ? 'not-found'
    : ['EACCES', 'EPERM', 'ELOOP'].includes(error.code) ? 'permission-denied' : error.code === 'EEXIST' ? 'conflict' : 'io-failure';
  response = JSON.stringify({ ok: false, code, ...(error instanceof Failure && error.conflict ? { conflict: error.conflict } : {}) });
  // Conflict details are scoped source metadata, never exception text. Retain
  // the safe code even when the configured response ceiling cannot fit details.
  if (limits && Buffer.byteLength(response) + 1 > limits.maxResponseBytes) response = JSON.stringify({ ok: false, code });
}
process.stdout.write(response + '\n');
