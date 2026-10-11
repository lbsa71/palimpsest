// Trusted source sent as an inline module to the namespace Node process.
export const workerSource = `import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// This source runs only inside the L09 namespace, with /work as its sole writable host mount.
const packet = JSON.parse(process.argv[1]);
const { operation, args, limit } = packet;
const fail = message => { throw new Error(message); };
const sha = text => createHash('sha256').update(text).digest('hex');
function target(name, missing = false) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..')) fail('invalid workspace-relative path');
  let current = '/work';
  const parts = name.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let st;
    try { st = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && missing && index === parts.length - 1) return current;
      throw error;
    }
    if (st.isSymbolicLink() || (!st.isDirectory() && (!st.isFile() || st.nlink !== 1))) fail('symlink, hardlink or special file rejected');
    if (index < parts.length - 1 && !st.isDirectory()) fail('parent is not a directory');
  }
  return current;
}
function read(name) {
  const file = target(name);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > limit) fail('file exceeds limit or is not a private regular file');
    const bytes = fs.readFileSync(fd);
    if (bytes.byteLength > limit) fail('file grew beyond limit');
    return bytes.toString('utf8');
  } finally { fs.closeSync(fd); }
}
function checked(name, expected) {
  if (typeof expected !== 'string') fail('expectedSha256 required');
  const content = read(name);
  if (sha(content) !== expected) fail('concurrent edit: digest changed');
  return content;
}
function bounded(text) { if (typeof text !== 'string' || Buffer.byteLength(text) > limit) fail('content exceeds limit'); return text; }
function files() {
  const result = [];
  function walk(dir, prefix) {
    for (const name of fs.readdirSync(dir).sort()) {
      const relative = prefix ? \`\${prefix}/\${name}\` : name;
      const st = fs.lstatSync(path.join(dir, name));
      if (st.isSymbolicLink() || (!st.isDirectory() && (!st.isFile() || st.nlink !== 1))) fail('symlink, hardlink or special file rejected');
      if (st.isDirectory()) walk(path.join(dir, name), relative);
      else result.push(relative);
      if (result.length > packet.maxFiles) fail('workspace file count exceeds limit');
    }
  }
  walk('/work', '');
  return result;
}
let mutating = false;
try {
let value;
if (operation === 'discover') value = { files: files() };
else if (operation === 'search') {
  if (typeof args.text !== 'string' || !args.text) fail('search text required');
  const matches = [];
  for (const file of files()) {
    // Whole search is bounded, rather than silently skipping large files.
    const content = read(file);
    content.split('\\n').forEach((line, index) => { if (line.includes(args.text)) matches.push({ path: file, line: index + 1, text: line }); });
    if (Buffer.byteLength(JSON.stringify(matches)) > limit) fail('search results exceed limit');
  }
  value = { matches };
} else if (operation === 'read') {
  const content = read(args.path);
  const start = args.startLine ?? 1, end = args.endLine ?? content.split('\\n').length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) fail('invalid line range');
  value = { path: args.path, sha256: sha(content), content: content.split('\\n').slice(start - 1, end).join('\\n'), startLine: start };
} else if (operation === 'write' || operation === 'patch') {
  const file = target(args.path, true);
  const exists = fs.existsSync(file);
  let before = '';
  if (exists) before = checked(args.path, args.expectedSha256);
  else if (args.expectedSha256 !== null || operation === 'patch') fail('new file requires null expectedSha256');
  let after;
  if (operation === 'write') after = bounded(args.content);
  else {
    bounded(args.oldText); bounded(args.newText);
    if (!args.oldText || before.split(args.oldText).length !== 2) fail('patch must match exactly once');
    after = bounded(before.replace(args.oldText, args.newText));
  }
  const temp = \`\${file}.aeon-\${process.pid}-\${Date.now()}\`;
  try { mutating = true; fs.writeFileSync(temp, after, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  value = { path: args.path, beforeSha256: exists ? sha(before) : null, sha256: sha(after), diff: { before, after } };
} else if (operation === 'delete') {
  const before = checked(args.path, args.expectedSha256);
  mutating = true; fs.unlinkSync(target(args.path)); value = { path: args.path, deleted: true, beforeSha256: sha(before), diff: { before, after: '' } };
} else if (operation === 'move') {
  const before = checked(args.path, args.expectedSha256), src = target(args.path), dest = target(args.to, true);
  // link/unlink gives no-overwrite semantics even when the target appears concurrently.
  mutating = true; fs.linkSync(src, dest);
  fs.unlinkSync(src); value = { from: args.path, to: args.to, sha256: sha(before) };
} else if (operation === 'diff') {
  const before = bounded(args.before), after = read(args.path);
  value = { path: args.path, changed: before !== after, beforeSha256: sha(before), sha256: sha(after), diff: { before, after } };
} else fail('unknown workspace operation');
process.stdout.write(JSON.stringify(value));
} catch (error) {
  process.stdout.write(JSON.stringify({toolError: error.message, mutationMayHaveStarted: mutating}));
  process.exitCode = 1;
}
`;
