import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess, ExecFileException, ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { digestJson, readManifest, verifyFrozenCandidate } from './candidates.ts';
import type { CandidateFile, CandidateManifest, VerifyOptions } from './candidates.ts';
import { resolveExternalPath } from './config.ts';
import type { Json } from './store.ts';
import { Store } from './store.ts';

export interface PublicationResult { status: 'published' | 'declined' | 'uncertain'; reason: string; commit?: string }
export interface PublicationControl {
  /** Trusted receiver re-reads current origin policy before each new mutation. */
  authorize?: () => boolean;
}
class PublicationPolicyDenied extends Error {}
/** Trusted host fixture seam; no candidate or configuration input selects execution. */
export interface GitExecution { child: ChildProcess; terminateOwnedGroup: () => void }
export type GitExecutor = (file: string, args: string[], options: ExecFileOptionsWithStringEncoding,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => GitExecution;
/** A detached command owns its process group, including ordinary Git helpers.
 * execFile does not forward detached, so this narrow runner uses spawn directly. */
export const runGitCommand: GitExecutor = (file, args, options, callback) => {
  const child = spawn(file, args, { cwd: options.cwd, env: options.env, detached: true, stdio: 'pipe' });
  const terminateOwnedGroup = () => {
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone or termination not established. */ } }
  };
  let finished = false;
  const output: Buffer[] = [], errors: Buffer[] = [];
  let outputBytes = 0, errorBytes = 0;
  const finish = (error: ExecFileException | null) => {
    if (finished) return;
    finished = true;
    callback(error, Buffer.concat(output).toString('utf8'), Buffer.concat(errors).toString('utf8'));
  };
  const collect = (chunks: Buffer[], chunk: Buffer, stderr: boolean) => {
    if (finished) return;
    const size = stderr ? errorBytes + chunk.length : outputBytes + chunk.length;
    if (size > (options.maxBuffer ?? 1048576)) {
      terminateOwnedGroup();
      finish(Object.assign(new Error('Bounded Git output exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
      return;
    }
    if (stderr) errorBytes = size; else outputBytes = size;
    chunks.push(chunk);
  };
  child.stdout!.on('data', (chunk: Buffer) => collect(output, chunk, false));
  child.stderr!.on('data', (chunk: Buffer) => collect(errors, chunk, true));
  child.once('error', finish);
  child.once('close', (code, signal) => finish(code === 0 && signal === null ? null
    : Object.assign(new Error('Bounded Git operation failed'), { code: code ?? undefined, signal: signal ?? undefined })));
  return { child, terminateOwnedGroup };
};
export interface GitPublisherOptions {
  repositoryRoot: string; dataDir: string; store: Store; remote: string; branch: string; remoteUrl: string; executeGit?: GitExecutor;
  /** Serving host's fixed collector, with current custody checked after awaits.
   * Standalone publication retains its original verifier when no host is wired. */
  verifyCandidate?: (options: VerifyOptions) => Promise<CandidateManifest>;
}
interface PushIdentity { candidateId: string; target: string; commit: string }
const commandDeadlineMs = 30000;
const object = (value: Json): Record<string, Json> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** Fixed Git operations owned by the host. Candidate/model text cannot choose
 * destinations or commands. Unknown pushes are observed, never blindly retried. */
export class GitPublisher {
  readonly #options: GitPublisherOptions;
  constructor(options: GitPublisherOptions) {
    if (!/^[A-Za-z0-9_.-]+$/.test(options.remote) || options.remote.startsWith('-')) throw new Error('Invalid trusted Git remote');
    this.#options = options;
    execFileSync('/usr/bin/git',['check-ref-format','--branch',options.branch],{cwd:options.repositoryRoot,stdio:'ignore'});
    for(const push of [false,true]) {
      const actual=execFileSync('/usr/bin/git',['remote','get-url',...(push?['--push']:[]),'--all',options.remote],{cwd:options.repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
      if(actual!==options.remoteUrl)throw new Error('Trusted Git remote identity mismatch');
    }
  }
  #targetMatches():Promise<boolean> {
    const {remote,remoteUrl}=this.#options;
    return Promise.all([this.#git(['remote','get-url','--all',remote]),this.#git(['remote','get-url','--push','--all',remote])]).then(values=>values.every(value=>value===remoteUrl),()=>false);
  }
  #git(args: string[], input?: string, index?: string, trimOutput = true, pushIdentity?: PushIdentity, beforeLaunch?: () => void): Promise<string> {
    const env={...process.env};
    // Host shell Git context must not redirect the configured checkout/index.
    for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])delete env[key];
    return new Promise((resolve,reject)=>{
      let execution: GitExecution | undefined;
      let deadlineExpired = false, settled = false;
      const dispose = () => {
        execution?.child.stdin?.destroy();
        execution?.child.stdout?.destroy();
        execution?.child.stderr?.destroy();
      };
      const completed = (error: ExecFileException | null, stdout: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (error) { execution?.terminateOwnedGroup(); dispose(); }
        try {
          if (pushIdentity) this.#options.store.appendEvent('git.publication.command_result', {
            ...pushIdentity, operation: 'push',
            exitCode: !error ? 0 : typeof error.code === 'number' && Number.isSafeInteger(error.code) ? error.code : null,
            signal: typeof error?.signal === 'string' && Object.hasOwn(osConstants.signals, error.signal) ? error.signal : null,
            deadlineExpired,
          });
          if (error) reject(new Error('Bounded Git operation failed'));
          else resolve(trimOutput ? stdout.trim() : stdout);
        } catch { reject(new Error('Bounded Git operation failed')); }
      };
      // A descendant can retain stdio after its parent exits. Deadline settlement
      // must not wait for the close callback, nor claim a requested kill succeeded.
      const deadline = setTimeout(() => {
        deadlineExpired = true;
        completed(Object.assign(new Error('Bounded Git deadline expired'), {
          code: execution?.child.exitCode ?? undefined,
          signal: execution?.child.signalCode ?? undefined,
        }), '');
      }, commandDeadlineMs);
      try {
        beforeLaunch?.();
        execution=(this.#options.executeGit ?? runGitCommand)('/usr/bin/git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','fetch.writeCommitGraph=false',...args],{cwd:this.#options.repositoryRoot,encoding:'utf8',maxBuffer:1048576,
          env:{...env,GIT_TERMINAL_PROMPT:'0',...(index?{GIT_INDEX_FILE:index}:{}),GIT_AUTHOR_NAME:'Palimpsest',GIT_AUTHOR_EMAIL:'palimpsest@localhost',GIT_COMMITTER_NAME:'Palimpsest',GIT_COMMITTER_EMAIL:'palimpsest@localhost'}}, completed);
        execution.child.stdin?.on('error',()=>{});execution.child.stdin?.end(input??'');
      } catch { completed(new Error('Bounded Git operation failed'), ''); }
    });
  }
  async #remote(): Promise<string | undefined> {
    const line=await this.#git(['ls-remote',this.#options.remote,`refs/heads/${this.#options.branch}`]);
    return line ? line.split(/\s+/)[0] : undefined;
  }
  async #matchesAdmittedSource(manifest: CandidateManifest, commit: string): Promise<boolean> {
    try {
      // Historical publication is checked against its own immutable artifact.
      // A subsequent reviewed host/toolchain upgrade is not a reason to revoke
      // proof that these exact earlier cognitive bytes reached the remote.
      const frozen = readManifest(manifest.releaseDir);
      if (frozen.id !== manifest.id) return false;
      const cognitive = /^src\/agent\/[A-Za-z0-9][A-Za-z0-9._-]*\.ts$/;
      const admitted = frozen.files.filter(file => cognitive.test(file.path));
      if (!admitted.some(file => file.path === 'src/agent/brain.ts') || digestJson(admitted) !== frozen.sourceDigest) return false;
      for (const directory of ['src', 'src/agent']) {
        const stat = lstatSync(join(frozen.candidateRoot, directory));
        if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      }
      for (const file of admitted) {
        const path = join(frozen.candidateRoot, file.path), stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size
          || (stat.mode & 0o111 ? '100755' : '100644') !== file.mode) return false;
        const content = readFileSync(path);
        if (content.length !== file.size || createHash('sha256').update(content).digest('hex') !== file.sha256) return false;
      }
      const actual: CandidateFile[] = [];
      const tree = await this.#git(['ls-tree', '-rz', '--full-tree', commit]);
      for (const entry of tree.split('\0').filter(Boolean)) {
        const split = entry.indexOf('\t'), path = entry.slice(split + 1);
        if (!cognitive.test(path)) continue;
        const [mode, kind, blob] = entry.slice(0, split).split(' ');
        if ((mode !== '100644' && mode !== '100755') || kind !== 'blob' || !blob) return false;
        const content = Buffer.from(await this.#git(['cat-file', 'blob', blob], undefined, undefined, false));
        actual.push({ path, mode, size: content.length, sha256: createHash('sha256').update(content).digest('hex') });
      }
      return digestJson(actual.sort((a, b) => a.path.localeCompare(b.path))) === frozen.sourceDigest;
    } catch { return false; }
  }
  async #observeReservedPush(manifest: CandidateManifest, commit: string): Promise<boolean> {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return false;
    try {
      const grafts = await this.#git(['rev-parse', '--git-path', 'info/grafts']);
      if (existsSync(resolvePath(this.#options.repositoryRoot, grafts))) return false;
      const remoteHead = await this.#remote();
      if (!remoteHead || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(remoteHead)) return false;
      try { await this.#git(['cat-file', '-e', `${remoteHead}^{commit}`]); }
      catch {
        // Observe the advertised object only. No ref mappings, FETCH_HEAD,
        // checkout changes or push are allowed during outcome reconciliation.
        await this.#git(['fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--no-auto-maintenance', '--refmap=', this.#options.remote, remoteHead]);
      }
      await this.#git(['merge-base', '--is-ancestor', commit, remoteHead]);
      if (!await this.#matchesAdmittedSource(manifest, commit)) return false;
      return await this.#targetMatches() && await this.#remote() === remoteHead;
    } catch { return false; }
  }
  async publish(manifest: CandidateManifest, control: PublicationControl = {}): Promise<PublicationResult> {
    manifest = structuredClone(manifest);
    const authorize = control.authorize;
    const assertCurrent = () => {
      if (authorize && !authorize()) throw new PublicationPolicyDenied('Current source policy withholds publication');
    };
    const mutate = (args: string[], input?: string, index?: string, pushIdentity?: PushIdentity) =>
      this.#git(args, input, index, true, pushIdentity, assertCurrent);
    const {store,repositoryRoot,dataDir,branch,remote,remoteUrl}=this.#options;
    const events=store.listEvents().filter(event=>event.type.startsWith('git.publication.') && object(event.payload).candidateId===manifest.id);
    const saved=events.find(event=>event.type==='git.publication.prepared');
    const commit=object(saved?.payload ?? null).commit as string | undefined;
    const target=createHash('sha256').update(JSON.stringify({remote,remoteUrl,branch})).digest('hex');
    if(events.some(event=>object(event.payload).target!==target))return {status:'declined',reason:'Publication target changed; inspect original intent',commit};
    if(!await this.#targetMatches())return {status:'declined',reason:'Trusted fetch/push remote identity changed',commit};
    const observed=async()=>{try{return await this.#remote();}catch{return undefined;}};
    if(commit && events.some(event=>event.type==='git.publication.push_reserved')) {
      if(await this.#observeReservedPush(manifest,commit))return {status:'published',reason:'Exact admitted commit independently observed in configured remote branch history',commit};
      return {status:'uncertain',reason:'Prior push outcome is not independently confirmed; no replay performed',commit};
    }
    if(events.length && !commit)return {status:'uncertain',reason:'Interrupted publication preparation requires operator reconciliation'};
    let created=commit;
    let preparationStarted = events.length > 0;
    try {
      assertCurrent();
      const promoted=store.listEvents().find(event=>event.type==='evolution.finished' && object(object(event.payload).report ?? null).status==='promoted'
        && object(object(object(event.payload).report ?? null).candidate ?? null).id===manifest.id);
      if(!promoted)return {status:'declined',reason:'No recorded promoted release authorizes publication'};
      const historicalId=object(object(object(promoted.payload).report ?? null).candidate ?? null).id as string;
      const verification={repositoryRoot,releaseDir:manifest.releaseDir,requireCurrentBase:false,expectedLegacyManifestDigest:historicalId};
      const verified=this.#options.verifyCandidate ? await this.#options.verifyCandidate(verification) : verifyFrozenCandidate(verification);
      if(verified.id!==manifest.id)throw new Error();
      manifest=verified;
      assertCurrent();
      if(!await this.#targetMatches())return {status:'declined',reason:'Trusted fetch/push remote identity changed'};
      if(await this.#git(['branch','--show-current'])!==branch)return {status:'declined',reason:'Checkout branch differs from configured publication branch'};
      if(await this.#git(['status','--porcelain','--untracked-files=all']))return {status:'declined',reason:'Checkout has local changes; no files staged or overwritten',commit};
      const head=await this.#git(['rev-parse','HEAD']);
      if(head!==manifest.baseCommit && head!==commit)return {status:'declined',reason:'Checkout base changed; admitted source was not rebased or republished',commit};
      const remoteHead=await this.#remote();
      if(remoteHead && remoteHead!==manifest.baseCommit && remoteHead!==commit)return {status:'declined',reason:'Configured remote branch diverged; no force push performed',commit};
      if(!created) {
        assertCurrent();
        store.appendEvent('git.publication.reserved',{candidateId:manifest.id,target,baseCommit:manifest.baseCommit});
        preparationStarted = true;
        const directory=resolveExternalPath(repositoryRoot,join(dataDir,'publication'));mkdirSync(directory,{recursive:true,mode:0o700});
        const index=join(directory,`${manifest.id}.index`);
        await mutate(['read-tree',manifest.baseCommit],undefined,index);
        for(const file of verified.files.filter(file=>/^src\/agent\/[A-Za-z0-9_.-]+\.ts$/.test(file.path))) {
          const content=readFileSync(join(verified.candidateRoot,file.path),'utf8');
          const blob=await mutate(['hash-object','-w','--stdin'],content,index);
          await mutate(['update-index','--add','--cacheinfo',`${file.mode},${blob},${file.path}`],undefined,index);
        }
        const tree=await mutate(['write-tree'],undefined,index);
        created=await mutate(['commit-tree',tree,'-p',manifest.baseCommit,'-m',`Palimpsest: admitted cognitive release ${manifest.id}`]);
        store.appendEvent('git.publication.prepared',{candidateId:manifest.id,target,commit:created,baseCommit:manifest.baseCommit});
      }
      if(head!==created) {
        // A two-tree merge refuses local conflicting changes; do not use a hard
        // reset or broad staging. CAS prevents replacing a concurrently moved ref.
        await mutate(['read-tree','-m','-u',manifest.baseCommit,created]);
        await mutate(['update-ref',`refs/heads/${branch}`,created,manifest.baseCommit]);
      }
      assertCurrent();
      store.appendEvent('git.publication.push_reserved',{candidateId:manifest.id,target,commit:created});
      try {await mutate(['push','--porcelain',remote,`${created}:refs/heads/${branch}`],undefined,undefined,{candidateId:manifest.id,target,commit:created});}catch{/* Inspect the remote below; transport failure is not proof of rejection. */}
      if(await observed()!==created)return {status:'uncertain',reason:'Push outcome not independently confirmed; no replay permitted',commit:created};
      store.appendEvent('git.publication.completed',{candidateId:manifest.id,target,commit:created});
      return {status:'published',reason:'Exact admitted source committed and observed at configured remote; checkout advanced to that commit',commit:created};
    }catch(error){return {status:created||preparationStarted?'uncertain':'declined',reason:error instanceof PublicationPolicyDenied
      ? 'Current source policy withholds further publication; recorded preparation is retained'
      : 'Bounded Git publication did not complete; inspect recorded phase before further work',commit:created};}
  }
}
