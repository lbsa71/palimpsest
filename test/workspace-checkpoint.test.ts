import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { runIsolated } from '../src/isolation.ts';
const helper=resolve('trusted/workspace-files.mjs');
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const limits={maxFiles:40,maxTotalBytes:600_000,maxFileBytes:300_000,maxResponseBytes:400_000,maxResults:100};
const platform={skip:process.platform!=='darwin'};
function fixture() {
  const base=mkdtempSync(join(tmpdir(),'palimpsest-checkpoint-'));const root=join(base,'tree'),stage=join(base,'staging'),outside=join(base,'outside');
  for(const path of [root,stage,outside])mkdirSync(path,{mode:0o700});const stat=lstatSync(root);const expectedRoot={device:stat.dev,inode:stat.ino};
  const id=sha('synthetic command checkpoint');const checkpoint=join(stage,id,'checkpoint');
  const put=(path:string,bytes:string|Buffer,mode=0o644)=>{mkdirSync(dirname(join(root,path)),{recursive:true,mode:0o700});writeFileSync(join(root,path),bytes,{mode});chmodSync(join(root,path),mode);};
  async function call(operation:Record<string,unknown>,extra:Record<string,unknown>={},changes:Partial<typeof limits>={}) {
    const result=await runIsolated({program:process.execPath,args:[helper,root,stage],cwd:stage,readPaths:[helper,root,stage],writePaths:[stage],timeoutMs:3000,maxOutputBytes:450_000,
      stdin:JSON.stringify({version:1,operationId:id,expectedRoot,limits:{...limits,...changes},operation,...extra})});
    assert.equal(result.exitCode,0,result.stderr);assert.equal(result.timedOut,false);assert.equal(result.outputLimitExceeded,false);return JSON.parse(result.stdout);
  }
  async function capture(){const current=await call({kind:'manifest'},{expectedRoot:undefined});assert.equal(current.ok,true);return call({kind:'checkpoint',expectedTreeDigest:sha(JSON.stringify(current.result.files))});}
  const cleanup=()=>{const writable=(path:string)=>{if(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())return;chmodSync(path,0o700);for(const name of readdirSync(path))writable(join(path,name));};writable(base);rmSync(base,{recursive:true,force:true});};
  return{base,root,stage,outside,id,expectedRoot,checkpoint,put,call,capture,cleanup};
}

test('checkpoint preserves drafted binary Unicode empty executable bytes and empty directory modes',platform,async()=>{
  const f=fixture();try{
    f.put('draft.ts','earlier draft edit 🌱');f.put('bin',Buffer.from([0,255,128,195,40]));f.put('empty','');f.put('scripts/exec','executable',0o755);
    mkdirSync(join(f.root,'empty-dir'),{mode:0o755});
    const captured=await f.capture();assert.equal(captured.ok,true,JSON.stringify(captured));const m=captured.result;
    assert.equal(m.treeDigest,sha(JSON.stringify(m.files)));assert.equal(m.fullTreeDigest,sha(JSON.stringify({files:m.files,directories:m.directories,rootMode:m.rootMode})));
    assert.equal(m.totalBytes,Buffer.byteLength('earlier draft edit 🌱')+5+10);assert.deepEqual(m.directories,[{path:'empty-dir',mode:0o755},{path:'scripts',mode:0o700}]);
    assert.equal(lstatSync(f.checkpoint).mode&0o777,0o500);assert.equal(lstatSync(join(f.checkpoint,'manifest.json')).mode&0o777,0o400);
    assert.equal(lstatSync(join(f.checkpoint,'tree/scripts/exec')).mode&0o777,0o500);
    assert.deepEqual(readFileSync(join(f.checkpoint,'tree/bin')),Buffer.from([0,255,128,195,40]));assert.equal(readFileSync(join(f.checkpoint,'tree/draft.ts'),'utf8'),'earlier draft edit 🌱');
    const verified=await f.call({kind:'checkpoint-read',checkpointDigest:m.checkpointDigest});assert.deepEqual(verified.result,m);
    const page=await f.call({kind:'checkpoint-read',checkpointDigest:m.checkpointDigest,path:'bin',startByte:1,endByte:4});assert.equal(page.ok,true);assert.deepEqual(Buffer.from(page.result.base64,'base64'),Buffer.from([255,128,195]));assert.equal(page.result.startByte,1);assert.equal(page.result.endByte,4);assert.equal(page.result.sha256,sha(Buffer.from([0,255,128,195,40])));
  }finally{f.cleanup();}
});

test('sealed checkpoint remains readable while original draft contains unsupported entries or mode000',platform,async()=>{
  const f=fixture();try{f.put('a','earlier draft');const captured=await f.capture();assert.equal(captured.ok,true);const digest=captured.result.checkpointDigest;
    symlinkSync(f.outside,join(f.root,'invalid'));chmodSync(f.root,0);
    const read=await f.call({kind:'checkpoint-read',checkpointDigest:digest,path:'a',startByte:0,endByte:13});assert.equal(read.ok,true,JSON.stringify(read));assert.equal(Buffer.from(read.result.base64,'base64').toString(),'earlier draft');
    chmodSync(f.root,0o700);assert.equal((await f.call({kind:'manifest'},{expectedRoot:undefined})).ok,false);
  }finally{chmodSync(f.root,0o700);f.cleanup();}
});

test('stale tree root replacement unsafe objects and extra control paths never yield a checkpoint',platform,async()=>{
  for(const kind of ['stale','link','hardlink','fifo','root-replacement','unknown-field']){
    const f=fixture();try{f.put('a','valid');const manifest=await f.call({kind:'manifest'},{expectedRoot:undefined});const expectedTreeDigest=sha(JSON.stringify(manifest.result.files));writeFileSync(join(f.outside,'canary'),'outside unchanged');
      if(kind==='stale')f.put('a','changed');
      if(kind==='link')symlinkSync(f.outside,join(f.root,'bad'));
      if(kind==='hardlink')linkSync(join(f.outside,'canary'),join(f.root,'bad'));
      if(kind==='fifo')execFileSync('/usr/bin/mkfifo',[join(f.root,'bad')]);
      if(kind==='root-replacement'){renameSync(f.root,join(f.base,'old-tree'));mkdirSync(f.root,{mode:0o700});f.put('a','valid');}
      const response=await f.call({kind:'checkpoint',expectedTreeDigest,...(kind==='unknown-field'?{output:f.outside}:{})});assert.equal(response.ok,false,kind);assert.equal(existsSync(f.checkpoint),false);assert.equal(readFileSync(join(f.outside,'canary'),'utf8'),'outside unchanged');
    }finally{f.cleanup();}
  }
});

test('unfinalized checkpoint bytes and wrong identities never establish complete capture',platform,async()=>{
  const f=fixture();try{f.put('a','draft');const captured=await f.capture();assert.equal(captured.ok,true);const digest=captured.result.checkpointDigest;
    renameSync(f.checkpoint,join(f.stage,f.id,'.checkpoint-partial'));
    assert.equal((await f.call({kind:'checkpoint-read',checkpointDigest:digest})).ok,false);
    assert.equal((await f.capture()).ok,false,'partial capture cannot be replayed into completion');
    assert.equal(existsSync(f.checkpoint),false);
  }finally{f.cleanup();}
});

test('sealed bytes metadata links extras aliases and digest tampering are refused',platform,async()=>{
  for(const kind of ['bytes','manifest','link','extra','aliases','wrong-digest']){
    const f=fixture();try{f.put('a','draft');const captured=await f.capture();assert.equal(captured.ok,true);let digest=captured.result.checkpointDigest;
      const file=join(f.checkpoint,'tree/a'),manifest=join(f.checkpoint,'manifest.json');
      if(kind==='bytes'){chmodSync(file,0o600);writeFileSync(file,'wrong');chmodSync(file,0o400);}
      if(kind==='manifest'||kind==='aliases'){const record=JSON.parse(readFileSync(manifest,'utf8'));if(kind==='manifest')record.files[0].mode=0o755;else record.directories=[{path:'alias',mode:0o700},{path:'ALIAS',mode:0o700}];chmodSync(manifest,0o600);writeFileSync(manifest,JSON.stringify(record));chmodSync(manifest,0o400);}
      if(kind==='link'){chmodSync(join(f.checkpoint,'tree'),0o700);rmSync(file);symlinkSync(join(f.outside,'private'),file);}
      if(kind==='extra'){chmodSync(join(f.checkpoint,'tree'),0o700);writeFileSync(join(f.checkpoint,'tree','extra'),'unrecorded');chmodSync(join(f.checkpoint,'tree'),0o500);}
      if(kind==='wrong-digest')digest='0'.repeat(64);
      assert.equal((await f.call({kind:'checkpoint-read',checkpointDigest:digest,path:'a',startByte:0,endByte:5})).ok,false,kind);
    }finally{f.cleanup();}
  }
});

test('checkpoint paging enforces128KiB raw limit and capture respects manifest response ceilings',platform,async()=>{
  const f=fixture();try{f.put('large',Buffer.alloc(150_000,255));const captured=await f.capture();assert.equal(captured.ok,true);const digest=captured.result.checkpointDigest;
    assert.equal((await f.call({kind:'checkpoint-read',checkpointDigest:digest,path:'large',startByte:0,endByte:131073})).ok,false);
    const page=await f.call({kind:'checkpoint-read',checkpointDigest:digest,path:'large',startByte:0,endByte:131072});assert.equal(page.ok,true);assert.equal(Buffer.from(page.result.base64,'base64').length,131072);
    assert.equal((await f.call({kind:'checkpoint-read',checkpointDigest:digest,path:'../outside/private',startByte:0,endByte:1})).ok,false);
    const limited=fixture();try{limited.put('a','draft');const response=await limited.call({kind:'checkpoint',expectedTreeDigest:sha(JSON.stringify((await limited.call({kind:'manifest'},{expectedRoot:undefined})).result.files))},{},{maxResponseBytes:128});assert.equal(response.ok,false);assert.equal(existsSync(limited.checkpoint),false);}finally{limited.cleanup();}
  }finally{f.cleanup();}
});

test('empty-directory-only checkpoint retains root modes and cannot move to a replaced root identity',platform,async()=>{
  const f=fixture();try{chmodSync(f.root,0o755);mkdirSync(join(f.root,'empty'),{mode:0o700});const captured=await f.capture();assert.equal(captured.ok,true);assert.equal(captured.result.rootMode,0o755);assert.deepEqual(captured.result.files,[]);assert.deepEqual(captured.result.directories,[{path:'empty',mode:0o700}]);
    assert.equal((await f.call({kind:'checkpoint-read',checkpointDigest:captured.result.checkpointDigest},{expectedRoot:{...f.expectedRoot,inode:f.expectedRoot.inode+1}})).ok,false);
    renameSync(f.root,join(f.base,'original'));mkdirSync(f.root,{mode:0o700});
    assert.equal((await f.call({kind:'checkpoint-read',checkpointDigest:captured.result.checkpointDigest})).ok,false);
  }finally{f.cleanup();}
});

test('checkpoint control aliases fail before writing through or overwriting an existing symlink',platform,async()=>{
  const f=fixture();try{f.put('a','draft');mkdirSync(join(f.stage,f.id),{mode:0o700});const dangling=join(f.outside,'absent');symlinkSync(dangling,f.checkpoint);
    const response=await f.capture();assert.equal(response.ok,false,'a dangling final path must be refused, not overwritten');assert.equal(lstatSync(f.checkpoint).isSymbolicLink(),true);assert.equal(existsSync(dangling),false);
  }finally{f.cleanup();}
});

test('checkpoint-read rejects explicit null byte bounds while omitted bounds retain defaults',platform,async()=>{
  const f=fixture();try{f.put('a','draft');const captured=await f.capture();assert.equal(captured.ok,true);const checkpointDigest=captured.result.checkpointDigest;
    for(const bounds of [{startByte:null,endByte:5},{startByte:0,endByte:null}]){
      const response=await f.call({kind:'checkpoint-read',checkpointDigest,path:'a',...bounds});
      assert.equal(response.ok,false,JSON.stringify(bounds));assert.equal(response.code,'invalid-range');
    }
    const response=await f.call({kind:'checkpoint-read',checkpointDigest,path:'a'});assert.equal(response.ok,true);assert.equal(response.result.startByte,0);assert.equal(response.result.endByte,5);assert.equal(Buffer.from(response.result.base64,'base64').toString(),'draft');
  }finally{f.cleanup();}
});
