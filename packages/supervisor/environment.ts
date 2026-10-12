import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';

export interface SqlStatement {
  get(...values: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
  all(...values: SQLInputValue[]): Record<string, SQLOutputValue>[];
  run(...values: SQLInputValue[]): unknown;
}
export interface SqlDatabase { exec(sql: string): void; prepare(sql: string): SqlStatement; close(): void }
export interface AuthorityEnvironment {
  mkdir: typeof fs.mkdirSync;
  openDatabase(path: string): SqlDatabase;
  wallNow(): number;
}
export interface LeaseEnvironment {
  mkdir: typeof fs.mkdirSync;
  openDatabase(path: string): SqlDatabase;
  pid(): number;
}
export interface ConfinementEnvironment {
  platform(): string;
  realpath(path: string): string;
  stat: typeof fs.statSync;
  lstat: typeof fs.lstatSync;
  readdir(path: string): string[];
}
export interface Timer { cancel(): void }
export interface ProcessReadable {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
}
export interface ProcessWritable {
  readonly destroyed: boolean;
  on(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  write(value: string | Uint8Array): unknown;
  end(value: string | Uint8Array): unknown;
}
export interface ProcessChild {
  readonly pid?: number;
  readonly stdin: ProcessWritable;
  readonly stdout: ProcessReadable;
  readonly stderr: ProcessReadable;
  readonly gate?: ProcessWritable;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}
export interface ResourceEnvironment {
  platform(): string;
  uid(): number;
  pid(): number;
  id(): string;
  monotonicNow(): number;
  schedule(delayMs: number, callback: () => void): Timer;
  realpath(path: string): string;
  stat: typeof fs.statSync;
  statfs(path: string): fs.BigIntStatsFs;
  mkdir: typeof fs.mkdirSync;
  readText(path: string): string;
  writeText(path: string, value: string): void;
  readdir(path: string): string[];
  rmdir(path: string): void;
  spawn(file: string, args: string[], input: 'ignore' | 'pipe', gate: boolean): ProcessChild;
  kill(pid: number, signal: NodeJS.Signals): void;
}
export type ExecutionEnvironment = ConfinementEnvironment & ResourceEnvironment;

/** Capture each callback once and bind adapters that depend on their receiver. */
export function capture<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const target = {} as Pick<T, K>;
  for (const key of keys) {
    const value = source[key];
    target[key] = (typeof value === 'function' ? value.bind(source) : value) as T[K];
  }
  return target;
}
export const authorityKeys = ['mkdir', 'openDatabase', 'wallNow'] as const;
export const leaseKeys = ['mkdir', 'openDatabase', 'pid'] as const;
export const confinementKeys = ['platform', 'realpath', 'stat', 'lstat', 'readdir'] as const;
export const resourceKeys = ['platform', 'uid', 'pid', 'id', 'monotonicNow', 'schedule', 'realpath', 'stat', 'statfs', 'mkdir', 'readText', 'writeText', 'readdir', 'rmdir', 'spawn', 'kill'] as const;
export const executionKeys = [...resourceKeys, 'lstat'] as const;
export function captureDatabase(database: SqlDatabase): SqlDatabase {
  const db = capture(database, ['exec', 'prepare', 'close']);
  const prepare = db.prepare;
  return { ...db, prepare: sql => capture(prepare(sql), ['get', 'all', 'run']) };
}
export function captureChild(child: ProcessChild): ProcessChild {
  const writable = (pipe: ProcessWritable): ProcessWritable => {
    const methods = capture(pipe, ['on', 'once', 'write', 'end']);
    return { ...methods, get destroyed() { return pipe.destroyed; } };
  };
  return { pid: child.pid, once: child.once.bind(child), stdin: child.stdin ? writable(child.stdin) : child.stdin,
    stdout: capture(child.stdout, ['on']), stderr: capture(child.stderr, ['on']), gate: child.gate ? writable(child.gate) : undefined };
}
export function monotonicReader(read: () => number): () => number {
  let prior = -1;
  return () => {
    const value = read();
    if (!Number.isFinite(value) || value < 0 || value < prior) throw new Error('Invalid or regressing supervisor monotonic clock');
    prior = value;
    return value;
  };
}
export function scheduleTimer(environment: Pick<ResourceEnvironment, 'schedule'>, delay: number, callback: () => void): Timer {
  if (!Number.isFinite(delay) || delay < 0) throw new Error('Finite nonnegative timer delay required');
  return capture(environment.schedule(delay, callback), ['cancel']);
}
export function throwFailures(failures: unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Supervisor operation and cleanup failed', { cause: failures[0] });
}

export function nodeAuthorityEnvironment(): AuthorityEnvironment {
  return { mkdir: fs.mkdirSync, openDatabase: path => new DatabaseSync(path), wallNow: () => Date.now() };
}
export function nodeLeaseEnvironment(): LeaseEnvironment {
  return { mkdir: fs.mkdirSync, openDatabase: path => new DatabaseSync(path), pid: () => process.pid };
}
export function nodeConfinementEnvironment(): ConfinementEnvironment {
  return { platform: () => process.platform, realpath: path => fs.realpathSync(path), stat: fs.statSync,
    lstat: fs.lstatSync, readdir: path => fs.readdirSync(path) };
}
export function nodeResourceEnvironment(): ResourceEnvironment {
  return { platform: () => process.platform, uid: () => process.getuid!(), pid: () => process.pid, id: randomUUID,
    monotonicNow: () => performance.now(), schedule: (delay, callback) => {
      const timer = setTimeout(callback, delay); return { cancel: () => clearTimeout(timer) };
    }, realpath: path => fs.realpathSync(path), stat: fs.statSync, statfs: path => fs.statfsSync(path, { bigint: true }),
    mkdir: fs.mkdirSync, readText: path => fs.readFileSync(path, 'utf8'), writeText: (path, value) => fs.writeFileSync(path, value),
    readdir: path => fs.readdirSync(path), rmdir: path => fs.rmdirSync(path),
    spawn: (file, args, input, gate) => {
      const child = spawn(file, args, { detached: true, stdio: [input, 'pipe', 'pipe', ...(gate ? ['pipe' as const] : [])], env: {} });
      return { get pid() { return child.pid; }, stdin: child.stdin as ProcessWritable, stdout: child.stdout!, stderr: child.stderr!,
        gate: child.stdio[3] as ProcessWritable | undefined, once: child.once.bind(child) };
    }, kill: (pid, signal) => process.kill(pid, signal) };
}
export function nodeExecutionEnvironment(): ExecutionEnvironment {
  return { ...nodeConfinementEnvironment(), ...nodeResourceEnvironment() };
}
