import { dirname, isAbsolute } from 'node:path';
import { capture, captureDatabase, leaseKeys, nodeLeaseEnvironment, throwFailures, type LeaseEnvironment, type SqlDatabase } from './environment.ts';

/** OS-backed exclusive process lease; a crash releases the SQLite lock without a model or stale-PID guess. */
export class ProcessLease {
  readonly #db: SqlDatabase;
  #closed = false;
  #released = false;
  constructor(filename: string, environment: LeaseEnvironment = nodeLeaseEnvironment()) {
    if (!isAbsolute(filename)) throw new Error('Process lease requires an absolute external state path');
    const host = capture(environment, leaseKeys);
    host.mkdir(dirname(filename), { recursive: true, mode: 0o700 });
    this.#db = captureDatabase(host.openDatabase(filename));
    try {
      this.#db.exec(`PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE;
        CREATE TABLE IF NOT EXISTS owner(singleton INTEGER PRIMARY KEY, pid INTEGER NOT NULL);
        BEGIN EXCLUSIVE;`);
      const pid = host.pid();
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid lease process identity');
      this.#db.prepare('INSERT INTO owner VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET pid=excluded.pid').run(pid);
    } catch (cause) {
      const failures: unknown[] = [new Error('Another supervisor holds the instance lease, or the lease store is unavailable', { cause })];
      try { this.#db.close(); } catch (cleanup) { failures.push(cleanup); } throwFailures(failures);
    }
  }
  assertHeld(): void {
    if (this.#closed) throw new Error('Exclusive process lease is closed');
    if (this.#released) throw new Error('Exclusive process lease released; database closure incomplete');
  }
  close(): void {
    if (this.#closed) return;
    if (!this.#released) { this.#db.exec('ROLLBACK'); this.#released = true; }
    this.#db.close(); this.#closed = true;
  }
}
