import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Operator migration gate. Ordinary installations have no receipt. An imported
 * destination must finish independent native cold recovery before normal CLI or
 * service startup. This is not a worker-accessible override or an admission API. */
export function assertPlatformMigrationReady(dataDir: string): void {
  const path = join(dataDir, 'platform-migration.json');
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Platform migration is not verified: invalid private gate');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.version !== 1 || value.status !== 'ready' || !/^[a-f0-9]{64}$/.test(value.id)
    || !/^[a-f0-9]{64}$/.test(value.candidateId) || !/^[a-f0-9]{64}$/.test(value.operationalDigest)
    || !Array.isArray(value.recoveryEpochs) || value.recoveryEpochs.length !== 2
    || value.recoveryEpochs.some((epoch: unknown) => !Number.isSafeInteger(epoch) || Number(epoch) <= 0)
    || value.recoveryEpochs[1] <= value.recoveryEpochs[0]) throw new Error('Platform migration is not verified; use the explicit operator recovery verifier');
}
