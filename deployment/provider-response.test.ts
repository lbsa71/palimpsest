import assert from 'node:assert/strict';
import test from 'node:test';
import { identity, type PhysicalRequest } from '../packages/contracts/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { providerResponseRecorder } from './provider-gateway.ts';
function fixture() {
  const rows = new Map<string, unknown>(), artifacts = new Map<string,string>();
  const store = { transaction<T>(fn:()=>T) { return fn(); }, putArtifact(body:string) { artifacts.set(identity(body),body); return {uri:'fixture:'+identity(body),sha256:identity(body)}; }, get(namespace:string,id:string) { const value=rows.get(namespace+id);return value && {value}; }, put(namespace:string,id:string,value:unknown) { rows.set(namespace+id,structuredClone(value)); } } as unknown as OperationalStore;
  const request = {id:'request',runId:'run',provider:'mistral',status:'dispatched'} as PhysicalRequest;
  const scope = {kind:'restricted' as const,principals:['private:user']};
  const record = providerResponseRecorder({store,ledger:{request:id=>id===request.id?request:undefined},runId:'run',scope,maxBytes:1000});
  return {rows,artifacts,request,scope,record};
}
test('raw rejected-provider response survives privately with its dispatched request and audience', () => {
  const f=fixture(); const body='{"choices":[{"message":{"unexpected":"rejected by parser"}}]}';
  f.scope.principals[0]='another:user'; f.record('request',{status:200,body});
  assert.equal([...f.artifacts.values()][0],body);
  const row=[...f.rows.values()][0] as {runId:string;scope:unknown;httpStatus:number};
  assert.equal(row.runId,'run');assert.equal(row.httpStatus,200);assert.deepEqual(row.scope,{kind:'restricted',principals:['private:user']});
  f.record('request',{status:200,body});assert.equal(f.rows.size,1);
  assert.throws(()=>f.record('request',{status:200,body:'different response'}),/identity changed/);assert.deepEqual([...f.rows.values()][0],row);
});
test('foreign, unentered and oversized responses cannot enter the retained evidence', () => {
  const f=fixture();assert.throws(()=>f.record('foreign',{status:200,body:'x'}),/dispatched model request/);
  f.request.status='reserved';assert.throws(()=>f.record('request',{status:200,body:'x'}),/dispatched model request/);
  f.request.status='dispatched';assert.throws(()=>f.record('request',{status:200,body:'x'.repeat(1001)}),/bounded provider response/);
  assert.equal(f.rows.size,0);assert.equal(f.artifacts.size,0);
});
