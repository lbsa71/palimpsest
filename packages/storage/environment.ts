import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue, StatementResultingChanges } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';

/** Trusted host composition only; these functions are receiver-free and synchronous. */
export interface StorageStatement {
  get(...values: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
  all(...values: SQLInputValue[]): Record<string, SQLOutputValue>[];
  run(...values: SQLInputValue[]): StatementResultingChanges;
}
export interface StorageDatabase {
  exec(sql: string): void;
  prepare(sql: string): StorageStatement;
  close(): void;
}
export interface StorageEnvironment {
  id(): string;
  exists(path: string): boolean;
  realpath(path: string): string;
  mkdir(path: string, options: { recursive: true; mode: number }): void;
  openDatabase(filename: string): StorageDatabase;
}

/** No work until a port is invoked; native receivers stay inside this adapter. */
export function createNodeStorageEnvironment(): StorageEnvironment {
  return {
    id: randomUUID,
    exists: path => existsSync(path),
    realpath: path => realpathSync(path),
    mkdir: (path, options) => { mkdirSync(path, options); },
    openDatabase: filename => {
      const database = new DatabaseSync(filename);
      return {
        exec: sql => { database.exec(sql); },
        close: () => { database.close(); },
        prepare: sql => {
          const statement = database.prepare(sql);
          return {
            get: (...values) => statement.get(...values),
            all: (...values) => statement.all(...values),
            run: (...values) => statement.run(...values),
          };
        },
      };
    },
  };
}
