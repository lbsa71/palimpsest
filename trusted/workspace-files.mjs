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
function run(request) {
  if (!object(request) || request.version !== 1 || !object(request.operation) || !object(request.limits)
      || Object.keys(request).some(key => !['version', 'operation', 'operationId', 'expectedOperationDigest', 'limits'].includes(key))) fail('invalid-request');
  limits = request.limits;
  const maxima = { maxFiles: 10000, maxTotalBytes: 64 * 1024 * 1024, maxFileBytes: 16 * 1024 * 1024, maxResponseBytes: 4 * 1024 * 1024, maxResults: 1000 };
  if (Object.keys(limits).sort().join(',') !== Object.keys(maxima).sort().join(',')
      || Object.entries(maxima).some(([key, max]) => !integer(limits[key], key === 'maxResponseBytes' ? 64 : 1, max))) fail('invalid-request');
  const operation = request.operation;
  const fields = {
    manifest: [], list: ['path', 'cursor'], search: ['query', 'cursor'], read: ['path', 'expectedSha256', 'startByte', 'endByte'],
    create: ['path', 'content', 'mode'], replace: ['path', 'content', 'mode', 'expected'], edit: ['path', 'oldText', 'newText', 'expected'],
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
  const rootStat = directory(root), stageStat = directory(stage);
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
