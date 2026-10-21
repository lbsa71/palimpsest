import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { resolveCodingMode, type CodingExecutor, type CodingInvocation, type CodingMode, type CodingProcessReceipt } from '../packages/coding/index.ts';
import { capture, executionKeys, monotonicReader, nodeExecutionEnvironment, scheduleTimer, throwFailures,
  type ExecutionEnvironment, type Timer } from '../packages/supervisor/environment.ts';
import { spawnBounded, type ResourceLimits } from '../packages/supervisor/resource-limits.ts';
import { readVerifiedRuntimeFile, runtimeBundlePath, type RuntimeIdentity } from './runtime-bundle.ts';

/** Trusted host bindings. No binary, credentials, environment or mount is chosen by model arguments. */
export interface CodexProcessOptions {
  codexBinary: string;
  codeModeHost?: string;
  codexHome: string;
  nodeBinary: string;
  /** Exact pinned runtime file within an already verified, protected application image. */
  nodeRuntime?: { root: string; identity: RuntimeIdentity };
  /** Explicit read-only dependency closure, optionally inside the protected application image. */
  toolchainDirectory?: string;
  protectedPaths: string[];
  resourceLimits?: ResourceLimits;
}
export interface CodexProcessDependencies extends ExecutionEnvironment {
  /** A private host file outside every sandbox mount; removed only after the namespace drains. */
  policyFile(contents: string): { path: string; remove(): void };
  verifyRuntimeFile?(root: string, path: string, identity: RuntimeIdentity): void;
}

/** Production supplies protected writable state because systemd may make the host /tmp read-only. */
export function nodeCodexProcessDependencies(temporaryDirectory = tmpdir()): CodexProcessDependencies {
  return { ...nodeExecutionEnvironment(), verifyRuntimeFile: (root, path, identity) => { readVerifiedRuntimeFile(root, path, identity); }, policyFile: contents => {
    const directory = mkdtempSync(join(temporaryDirectory, 'aeon-codex-policy-'));
    const path = join(directory, 'requirements.toml');
    try { writeFileSync(path, contents, { mode: 0o600, flag: 'wx' }); }
    catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
    return { path, remove: () => rmSync(directory, { recursive: true, force: true }) };
  } };
}

function contains(parent: string, child: string): boolean {
  const suffix = relative(parent, child);
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}
function overlaps(first: string, second: string): boolean { return contains(first, second) || contains(second, first); }

// Native workspace-write tools need Codex's executable and its home/tmp launcher, so denying either
// entire directory prevents the native sandbox itself from starting. Deny the only provisioned auth
// file instead. Native tool network is disabled separately by the provider. A nested unauthenticated
// CLI process can start, but cannot authenticate or reach an inference endpoint. This is not an
// executable allowlist or an independent audit of the upstream sandbox implementation.
function managedPolicy(mode: CodingMode): string {
  // Native PermissionProfile validation requires its read-only baseline even
  // when this invocation explicitly requests workspace-write authority.
  return `allowed_approval_policies = ["never"]\nallowed_sandbox_modes = ${mode === 'inspect' ? '["read-only"]' : '["read-only", "workspace-write"]'}\n` +
    '[permissions.filesystem]\ndeny_read = ["/coding-home/auth.json"]\n';
}

function confinementArguments(options: CodexProcessOptions, invocation: CodingInvocation, policyPath: string,
  environment: ExecutionEnvironment, verifyRuntimeFile: CodexProcessDependencies['verifyRuntimeFile']): string[] {
  const mode = resolveCodingMode(invocation.mode);
  if (environment.platform() !== 'linux') throw new Error('Codex coding requires Linux namespace isolation');
  if (invocation.executable !== 'codex' && invocation.executable !== '/runtime/codex') throw new Error('Only the host-bound Codex executable is permitted');
  if (!Number.isSafeInteger(invocation.timeoutMs) || invocation.timeoutMs < 1 ||
      !Number.isSafeInteger(invocation.maxOutputBytes) || invocation.maxOutputBytes < 1) throw new Error('Finite coding process limits required');
  if (!Array.isArray(invocation.args) || invocation.args.some(arg => typeof arg !== 'string' || arg.includes('\0')) ||
      typeof invocation.stdin !== 'string' || invocation.stdin.includes('\0')) throw new Error('Invalid coding process input');
  const canonical = (path: string) => {
    if (!isAbsolute(path)) throw new Error('Absolute coding host paths required');
    return environment.realpath(path);
  };
  const workspace = canonical(invocation.cwd), home = canonical(options.codexHome);
  if (options.protectedPaths.length === 0) throw new Error('Protected control/state/recovery paths must be declared');
  const protectedPaths = options.protectedPaths.map(canonical);
  if (!environment.stat(workspace).isDirectory()) throw new Error('Coding workspace must be a directory');
  const homeStat = environment.stat(home);
  if (!homeStat.isDirectory() || (homeStat.mode & 0o077) !== 0 || homeStat.uid !== environment.uid()) {
    throw new Error('Codex requires an owner-private host-selected home');
  }
  if (overlaps(workspace, home)) throw new Error('Coding workspace overlaps credential/session storage');
  const assertMount = (path: string) => {
    for (const protectedPath of protectedPaths) if (overlaps(path, protectedPath)) throw new Error('Coding mount overlaps protected storage');
  };
  const inspect = (directory: string, device = environment.stat(directory).dev, symlinkRoot?: string) => {
    for (const name of environment.readdir(directory)) {
      const path = join(directory, name), stat = environment.lstat(path);
      if (stat.dev !== device) throw new Error('Coding mount contains a nested filesystem');
      if (stat.isDirectory()) inspect(path, device, symlinkRoot);
      else if (stat.isSymbolicLink() && symlinkRoot && !contains(symlinkRoot, environment.realpath(path))) throw new Error('Coding toolchain contains an escaping symlink');
      else if (!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink !== 1)) throw new Error('Coding mount contains a special file or hardlink');
    }
  };
  // The host-selected home is trusted shared Codex state, including live sockets,
  // caches and SQLite WAL files. Only workspaces/toolchains need recursive policing.
  assertMount(workspace); assertMount(home); inspect(workspace);
  const auth = environment.lstat(join(home, 'auth.json'));
  if (!auth.isFile() || auth.isSymbolicLink() || auth.nlink !== 1 || auth.uid !== environment.uid() || (auth.mode & 0o077) !== 0) {
    throw new Error('Provision owner-private auth.json in the selected Codex home');
  }
  const readOnly = (path: string) => { const result = canonical(path); assertMount(result); return result; };
  const binary = (path: string, runtime?: CodexProcessOptions['nodeRuntime']) => {
    const result = runtime ? canonical(path) : readOnly(path), stat = environment.lstat(result);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o111) === 0) throw new Error('Coding runtime binary must be an executable ordinary file without hardlinks');
    if (contains(workspace, result) || contains(home, result)) throw new Error('Coding runtime binary cannot come from writable coding storage');
    if (runtime) {
      const root = canonical(runtime.root);
      if (root !== runtime.root || path !== result || result !== join(root, runtimeBundlePath) || !runtime.identity.bundle ||
          !protectedPaths.includes(root) || !verifyRuntimeFile) throw new Error('Coding bundled runtime requires an exact protected application file and verifier');
      // Only this exact application ancestor is exempt. Separately protected runtime
      // directories/files and every other protected ancestor retain their denial.
      if (protectedPaths.some(protectedPath => protectedPath !== root && overlaps(result, protectedPath))) throw new Error('Coding mount overlaps protected storage');
      verifyRuntimeFile(root, runtimeBundlePath, runtime.identity);
    }
    return result;
  };
  const args = ['--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
    '--ro-bind', readOnly('/usr'), '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--size', '67108864', '--tmpfs', '/tmp',
    mode === 'inspect' ? '--ro-bind' : '--bind', workspace, '/work', '--bind', home, '/coding-home',
    '--ro-bind', binary(options.codexBinary), '/runtime/codex', '--ro-bind', binary(options.nodeBinary, options.nodeRuntime), '/runtime/node',
    '--ro-bind', policyPath, '/etc/codex/requirements.toml'];
  if (options.codeModeHost) args.push('--ro-bind', binary(options.codeModeHost), '/runtime/codex-code-mode-host');
  if (options.toolchainDirectory) {
    const toolchain = canonical(options.toolchainDirectory);
    if (basename(toolchain) !== 'node_modules' || !environment.stat(toolchain).isDirectory()) throw new Error('Coding toolchain must be a node_modules directory');
    if (overlaps(toolchain, workspace) || overlaps(toolchain, home)) throw new Error('Coding toolchain overlaps writable coding storage');
    // The host can expose this exact dependency subtree of its protected application. No parent
    // application files, separately protected children, or writable dependency aliases are exposed.
    if (protectedPaths.some(path => contains(toolchain, path))) throw new Error('Coding toolchain contains protected storage');
    inspect(toolchain, environment.stat(toolchain).dev, toolchain);
    args.push('--ro-bind', toolchain, '/app/node_modules');
  }
  for (const path of ['/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/ssl/certs/ca-certificates.crt']) args.push('--ro-bind', readOnly(path), path);
  args.push('--chdir', '/work', '--clearenv', '--setenv', 'PATH', '/runtime:/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'HOME', '/coding-home', '--setenv', 'CODEX_HOME', '/coding-home', '--setenv', 'TMPDIR', '/tmp',
    '--setenv', 'SSL_CERT_FILE', '/etc/ssl/certs/ca-certificates.crt', '--', '/runtime/codex', ...invocation.args);
  return args;
}

/** One bounded native process per call. The provider/orchestrator owns the single persistent session. */
export function createCodexProcess(options: CodexProcessOptions,
  supplied: CodexProcessDependencies = nodeCodexProcessDependencies()): CodingExecutor {
  options = { ...options, protectedPaths: [...options.protectedPaths], ...(options.resourceLimits ? { resourceLimits: { ...options.resourceLimits } } : {}),
    ...(options.nodeRuntime ? { nodeRuntime: { ...options.nodeRuntime, identity: { ...options.nodeRuntime.identity,
      ...(options.nodeRuntime.identity.bundle ? { bundle: { ...options.nodeRuntime.identity.bundle } } : {}) } } } : {}) };
  const environment = capture(supplied, executionKeys), policyFile = supplied.policyFile.bind(supplied), verifyRuntimeFile = supplied.verifyRuntimeFile?.bind(supplied);
  environment.monotonicNow = monotonicReader(environment.monotonicNow);
  let active = false;
  return async (invocation, signal) => {
    if (active) throw new Error('A coding process is already active');
    signal?.throwIfAborted();
    invocation = { ...invocation, args: [...invocation.args], mode: resolveCodingMode(invocation.mode) };
    active = true;
    let policy: ReturnType<CodexProcessDependencies['policyFile']> | undefined;
    let confined: Awaited<ReturnType<typeof spawnBounded>> | undefined;
    let timer: Timer | undefined, stoppedFor: CodingProcessReceipt['stoppedFor'], outputBytes = 0;
    const stdout: Buffer[] = [], stderr: Buffer[] = [], failures: unknown[] = [];
    let receipt: CodingProcessReceipt | undefined;
    const stop = (reason?: CodingProcessReceipt['stoppedFor']) => {
      stoppedFor ??= reason;
      try { confined?.stop(); } catch (error) { failures.push(error); }
    };
    const abort = () => stop('cancelled');
    const collect = (destination: Buffer[]) => (chunk: Buffer) => {
      const available = Math.max(0, invocation.maxOutputBytes - outputBytes);
      if (available > 0) destination.push(Buffer.from(chunk.subarray(0, available)));
      outputBytes += chunk.length;
      if (outputBytes > invocation.maxOutputBytes) stop('output-limit');
    };
    let started = 0;
    try {
      policy = policyFile(managedPolicy(invocation.mode!));
      const args = confinementArguments(options, invocation, policy.path, environment, verifyRuntimeFile);
      signal?.throwIfAborted(); started = environment.monotonicNow();
      confined = await spawnBounded(args, { workspace: invocation.cwd, timeoutMs: invocation.timeoutMs, resourceLimits: options.resourceLimits, input: 'pipe' }, environment);
      const { child } = confined;
      child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
      child.stdin.on('error', () => { failures.push(new Error('Coding process input pipe failed')); stop(); });
      timer = scheduleTimer(environment, invocation.timeoutMs, () => stop('timeout'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else child.stdin.end(invocation.stdin);
      const completion = await confined.closed;
      receipt = { exitCode: completion.code, signal: completion.signal, stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'), elapsedMs: 0 };
    } catch (error) { failures.push(error); }
    finally {
      if (timer) { try { timer.cancel(); } catch (error) { failures.push(error); } }
      signal?.removeEventListener('abort', abort);
      if (confined) { try { await confined.cleanup(); } catch (error) { failures.push(error); } }
      if (policy) { try { policy.remove(); } catch (error) { failures.push(error); } }
      active = false;
    }
    if (receipt) { receipt.elapsedMs = environment.monotonicNow() - started; if (stoppedFor) receipt.stoppedFor = stoppedFor; }
    throwFailures(failures);
    return receipt!;
  };
}
