import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const descriptor=(memory,content=memory.content.slice(0,4000))=>({id:memory.id,kind:memory.kind,content,source:memory.source,confidence:memory.confidence,version:memory.version,evidence:memory.evidence,updatedAt:memory.updatedAt});
const size=memories=>Buffer.byteLength(JSON.stringify(memories),'utf8');
const nonisolated=content=> !/[\uD800-\uDBFF]$/.test(content);

/** Fresh inputs and assertions are created outside candidate execution. Models
 * receive the work contract, never this fixture generator or validator output. */
export function makeDevelopmentFixtures(check) {
  assert.ok(['memory-provenance','memory-context-budget'].includes(check));
  const nonce=randomUUID();const scope=`development-${nonce}`;
  const task={id:nonce,conversationId:scope,input:`Inspect current experiences ${nonce}`,source:'direct',state:'running',checkpoint:null,output:null,error:null,createdAt:'2026-10-08T00:00:00Z',updatedAt:'2026-10-08T00:00:00Z'};
  const memory=(index,extra={})=>({id:`experience-${nonce}-${index}`,version:index+2,scope,kind:index%2?'episodic':'semantic',content:`A grounded ordinary experience ${nonce} ${index}`,source:`task:${nonce}:${index}`,confidence:0.3+index%5/10,evidence:[`episode:${nonce}:${index}`,`correction:${nonce}:${index}`],createdAt:task.createdAt,updatedAt:`2026-10-08T00:00:${String(index%60).padStart(2,'0')}Z`,...extra});
  const small=Array.from({length:4},(_,i)=>memory(i,{evidence:i===0?[]:[`first-${nonce}-${i}`,`second-${nonce}-${i}`]}));
  const foreign=memory(40,{id:`FOREIGN-${nonce}`,scope:`foreign-${nonce}`,content:`FOREIGN-CONTENT-${nonce}`,evidence:[`FOREIGN-EVIDENCE-${nonce}`]});
  const fixtures=[
    {name:'corrected current descriptors',task,memories:small},
    {name:'mixed scope descriptors remain private',task,memories:[small[0],foreign,small[1]]},
    {name:'foreign-only descriptors absent',task,memories:[foreign]},
  ];
  if(check==='memory-provenance')return fixtures;
  fixtures.push(
    {name:'chronological order, not input order, with later-position tie first',task,memories:[memory(9),memory(1),memory(8),memory(3),memory(7),memory(2),memory(7,{id:`tie-${nonce}`})]},
    {name:'UTF-8 bytes include Unicode and JSON escapes',task,memories:Array.from({length:20},(_,i)=>memory(i,{content:(i%2?'🌱\\\"\n':'å漢').repeat(3000)})).reverse()},
    {name:'large exact metadata omits latest but retains fitting older experience',task,memories:[memory(1),memory(55,{evidence:[`evidence-${nonce}-`+'漢'.repeat(15000)]})]},
    {name:'surrogate-safe truncation and aggregate metadata budget',task,memories:Array.from({length:14},(_,i)=>memory(i,{content:'x'.repeat(3999)+'🌱'+'ordinary'.repeat(100),evidence:[`evidence-${nonce}-`+'漢'.repeat(300)]}))},
  );
  return fixtures;
}

export function validateDevelopmentResponses(check,fixtures,responses) {
  assert.ok(Array.isArray(responses));assert.equal(responses.length,fixtures.length);
  for(let index=0;index<fixtures.length;index++) {
    const fixture=fixtures[index],response=responses[index];
    const prompt=JSON.parse(response.prompt);assert.equal(prompt.request,fixture.task.input);
    assert.ok(Array.isArray(prompt.memories)&&prompt.memories.length<=12);
    const eligible=fixture.memories.filter(m=>m.scope===fixture.task.conversationId);
    const serialized=JSON.stringify(response);
    for(const m of fixture.memories.filter(m=>m.scope!==fixture.task.conversationId))
      for(const secret of [m.id,m.content,...m.evidence])assert.ok(!serialized.includes(secret),`${fixture.name}: foreign descriptor leaked`);
    const seen=new Set();
    for(const m of prompt.memories) {
      const source=eligible.find(v=>v.id===m.id);assert.ok(source,`${fixture.name}: invented memory`);
      assert.ok(!seen.has(m.id),`${fixture.name}: duplicate memory`);seen.add(m.id);
      for(const field of ['kind','source','confidence','version','evidence','updatedAt'])assert.deepEqual(m[field],source[field],`${fixture.name}: exact ${field}`);
      assert.ok(typeof m.content==='string'&&m.content.length>0&&m.content.length<=4000&&source.content.startsWith(m.content),`${fixture.name}: grounded bounded prefix`);
      assert.ok(nonisolated(m.content),`${fixture.name}: truncation introduced isolated surrogate`);
    }
    if(check==='memory-provenance') {
      assert.equal(prompt.memories.length,eligible.length,`${fixture.name}: small ordinary descriptors retained`);
      continue;
    }
    assert.ok(size(prompt.memories)<=32768,`${fixture.name}: total UTF-8 memory budget`);
    const ordered=eligible.map((m,position)=>({m,position})).sort((a,b)=>Date.parse(b.m.updatedAt)-Date.parse(a.m.updatedAt)||b.position-a.position).map(v=>v.m);
    const expected=[];let offset=0;
    // Independent admission oracle uses only the shortest complete descriptor.
    // It permits different valid prefix lengths while enforcing greedy order.
    for(const source of ordered) {
      if(offset>=12)break;
      const first=Array.from(source.content)[0];
      if(!first||size([...prompt.memories.slice(0,offset),descriptor(source,first)])>32768)continue;
      expected.push(source.id);offset++;
    }
    assert.deepEqual(prompt.memories.map(m=>m.id),expected,`${fixture.name}: newest eligible fitting experiences first`);
  }
  return fixtures.map(f=>({name:f.name,status:'passed'}));
}
