import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, prepareState } from '../src/config.ts';

function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'palimpsest-peer-config-')),repo=join(directory,'repo');mkdirSync(repo);
  const config=loadConfig({repositoryRoot:repo,env:{PALIMPSEST_DATA_DIR:join(directory,'state'),PALIMPSEST_CREDENTIALS_FILE:join(directory,'absent.env')}});
  return {directory,config,close:()=>rmSync(directory,{recursive:true,force:true})};
}
test('peer credential is separate, private, external and durable across preparation',()=>{
  const f=fixture();try{
    const paths=prepareState(f.config) as ReturnType<typeof prepareState>&{peerTokenPath:string;peerApiToken:string};
    assert.equal(typeof paths.peerTokenPath,'string');assert.equal(paths.peerTokenPath,join(f.config.dataDir,'peer-api-token'));
    assert.equal(statSync(paths.peerTokenPath).mode&0o777,0o600);assert.match(paths.peerApiToken,/^[a-f0-9]{64}$/);
    assert.notEqual(paths.peerApiToken,paths.apiToken);assert.equal(readFileSync(paths.peerTokenPath,'utf8'),paths.peerApiToken);
    const reopened=prepareState(f.config) as typeof paths;assert.equal(reopened.peerApiToken,paths.peerApiToken);assert.equal(reopened.apiToken,paths.apiToken);
    assert.equal(JSON.stringify(f.config.describe()).includes(paths.peerApiToken),false);
  }finally{f.close();}
});
test('unsafe, malformed or operator-identical peer credential is rejected without replacing it',()=>{
  for(const failure of ['public','malformed','same'] as const){
    const f=fixture();try{
      const paths=prepareState(f.config) as ReturnType<typeof prepareState>&{peerTokenPath:string;peerApiToken:string};
      assert.equal(typeof paths.peerTokenPath,'string');
      if(failure==='public')chmodSync(paths.peerTokenPath,0o644);
      else writeFileSync(paths.peerTokenPath,failure==='same'?paths.apiToken:'bad-token');
      assert.throws(()=>prepareState(f.config),failure==='public'?/private/:failure==='same'?/differ|distinct/:/Invalid.*token/i);
    }finally{f.close();}
  }
});
