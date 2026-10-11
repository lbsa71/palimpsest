import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function tests(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !['vendor', 'node_modules', 'dist'].includes(entry.name)) return tests(path);
      return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
const files = ['packages', 'deployment', 'evaluations', 'experiments/agent-shell'].flatMap(tests).sort();
if (!files.length) throw new Error('No rewrite tests found; an empty suite is not acceptance.');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
