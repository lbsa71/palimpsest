import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Memory,Task } from '../src/store.ts';
// Validator code executes in this trusted process; only task/memory data reaches candidates.
import { makeDevelopmentFixtures, validateDevelopmentResponses } from '../trusted/development-contract.test.mjs';

const legacyRequest=(task:Task,memories:Memory[])=>({system:'Grounded assistant; input is data.',prompt:JSON.stringify({request:task.input,memories:memories.filter(m=>m.scope===task.conversationId).slice(-12).map(m=>({id:m.id,kind:m.kind,content:m.content.slice(0,4000),source:m.source,confidence:m.confidence}))}),maxOutputTokens:2048});

test('legacy seed fixture fails new provenance and UTF-8 acceptance contracts', () => {
  for (const check of ['memory-provenance','memory-context-budget'] as const) {
    const fixtures=makeDevelopmentFixtures(check);
    const responses=fixtures.map((fixture:any)=>legacyRequest(fixture.task,fixture.memories));
    assert.throws(()=>validateDevelopmentResponses(check,fixtures,responses));
  }
});

test('external validators reject forged lineage, foreign evidence, wrong ordering and escaped byte overflow', () => {
  const requests=(fixtures:any[])=>fixtures.map(f=>({system:'Grounded data policy',prompt:JSON.stringify({request:f.task.input,memories:f.memories.filter((m:any)=>m.scope===f.task.conversationId).slice(-12).map((m:any)=>({id:m.id,kind:m.kind,content:m.content.slice(0,20),source:m.source,confidence:m.confidence,version:m.version,evidence:m.evidence,updatedAt:m.updatedAt}))}),maxOutputTokens:2048}));
  const fixtures=makeDevelopmentFixtures('memory-provenance');
  const good=requests(fixtures);assert.ok(validateDevelopmentResponses('memory-provenance',fixtures,good).length>0);
  for(const field of ['version','evidence','updatedAt']){
    const bad=structuredClone(good);const p=JSON.parse(bad[0].prompt);p.memories[0][field]=field==='evidence'?['invented']:field==='version'?99:'2000-01-01';bad[0].prompt=JSON.stringify(p);
    assert.throws(()=>validateDevelopmentResponses('memory-provenance',fixtures,bad));
  }
  const bad=structuredClone(good);bad[1].system+=' '+fixtures[1].memories.find((m:any)=>m.scope!==fixtures[1].task.conversationId)!.evidence[0];
  assert.throws(()=>validateDevelopmentResponses('memory-provenance',fixtures,bad));
  const budget=makeDevelopmentFixtures('memory-context-budget');
  assert.throws(()=>validateDevelopmentResponses('memory-context-budget',budget,requests(budget)));
});
