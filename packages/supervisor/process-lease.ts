import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** OS-backed exclusive process lease; a crash releases the SQLite lock without a model or stale-PID guess. */
export class ProcessLease {
  readonly #db: DatabaseSync;
  #closed = false;
  constructor(filename: string) {
    if (!isAbsolute(filename)) throw new Error('Process lease requires an absolute external state path');
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(filename);
    try {
      this.#db.exec(`PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE;
        CREATE TABLE IF NOT EXISTS owner(singleton INTEGER PRIMARY KEY, pid INTEGER NOT NULL);
        BEGIN EXCLUSIVE;`);
      this.#db.prepare('INSERT INTO owner VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET pid=excluded.pid').run(process.pid);
    } catch (cause) { this.#db.close(); throw new Error('Another supervisor holds the instance lease, or the lease store is unavailable', { cause }); }
  }
  close(): void {
    if (this.#closed) return;
    this.#db.exec('ROLLBACK'); this.#db.close(); this.#closed = true;
  }
}
