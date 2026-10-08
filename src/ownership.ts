import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';

/** An OS-released database lock, not a PID file or a guess about prior liveness.
 * Keep this database separate from operational state so task transactions work.
 */
export class CoordinatorLock {
  #db?: DatabaseSync;

  constructor(path: string) {
    const db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      db.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS coordinator (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;');
      this.#db = db;
    } catch (error) {
      db.close();
      if (error instanceof Error && /locked|busy/i.test(error.message)) throw new Error('Another Palimpsest coordinator is already active for this data directory');
      throw new Error('Cannot acquire coordinator ownership');
    }
  }

  close(): void {
    if (this.#db) { this.#db.exec('ROLLBACK'); this.#db.close(); this.#db = undefined; }
  }
}
