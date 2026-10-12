import assert from 'node:assert/strict';
import test from 'node:test';
import { Validator, type Schema } from '../packages/narrow-schema/index.ts';
import { dereference, initialBaseURI } from '../packages/narrow-schema/vendor/cfworker/dereference.ts';
import { validate } from '../packages/narrow-schema/vendor/cfworker/validate.ts';

test('same caller schema resolves independently under two captured instance bases',()=>{
  const schema:Schema={$ref:'child'},first=new Validator(schema,'2020-12',false,'https://first.invalid/schemas/root'),second=new Validator(schema,'2020-12',false,'https://second.invalid/schemas/root');
  first.addSchema({type:'string'},'child');second.addSchema({type:'number'},'child');
  assert.equal(first.validate('value').valid,true);assert.equal(first.validate(1).valid,false);assert.equal(second.validate(1).valid,true);assert.equal(second.validate('value').valid,false);assert.deepEqual(Reflect.ownKeys(schema),['$ref']);
});
test('captured root and added schemas ignore later caller mutations and private metadata',()=>{
  const schema:Schema={$ref:'child'},child:Schema={type:'string'},v=new Validator(schema,'2020-12',false,'https://instance.invalid/root');
  v.addSchema(child,'child');schema.$ref='elsewhere';child.type='number';Object.defineProperty(child,'__absolute_ref__',{value:'https://wrong.invalid/'});
  assert.equal(v.validate('value').valid,true);assert.equal(v.validate(3).valid,false);assert.deepEqual(Reflect.ownKeys(schema).sort(),['$ref']);
});
test('shared added schema metadata cannot contaminate another base',()=>{
  const a=new Validator({$ref:'entry'},'2020-12',false,'https://a.invalid/root'),b=new Validator({$ref:'entry'},'2020-12',false,'https://b.invalid/root'),entry:Schema={$id:'entry',$ref:'value'};
  a.addSchema(entry);b.addSchema(entry);a.addSchema({const:'a'},'value');b.addSchema({const:'b'},'value');
  assert.equal(a.validate('a').valid,true);assert.equal(a.validate('b').valid,false);assert.equal(b.validate('b').valid,true);assert.equal(b.validate('a').valid,false);assert.deepEqual(Reflect.ownKeys(entry).sort(),['$id','$ref']);
});
test('explicit root and nested schema identifiers override the composition base',()=>{
  const schema:Schema={$id:'https://root.invalid/root',$defs:{value:{$id:'nested',type:'integer',minimum:1}},$ref:'nested'},v=new Validator(schema,'2020-12',false,'https://other.invalid/');
  assert.equal(v.validate(2).valid,true);assert.equal(v.validate(0).valid,false);assert.equal(v.validate('2').valid,false);
});
test('explicit base retains anchors and escaped local pointers',()=>{
  const anchored=new Validator({$defs:{x:{$anchor:'positive',type:'integer',minimum:1}},$ref:'#positive'},'2020-12',false,'https://anchor.invalid/root');
  assert.equal(anchored.validate(1).valid,true);assert.equal(anchored.validate(0).valid,false);
  const pointer=new Validator({$defs:{'a/b~c':{const:'ok'}},$ref:'#/$defs/a~1b~0c'},'2020-12',false,'https://pointer.invalid/root');
  assert.equal(pointer.validate('ok').valid,true);assert.equal(pointer.validate('bad').valid,false);
});
test('recursive reference retains the captured base across nested recursion',()=>{
  const schema:Schema={$id:'tree',$recursiveAnchor:true,type:'object',properties:{value:{type:'integer'},next:{$recursiveRef:'#'}},required:['value'],additionalProperties:false};
  const a=new Validator(schema,'2019-09',false,'https://tree-a.invalid/'),b=new Validator(schema,'2019-09',false,'https://tree-b.invalid/');
  for(const v of [a,b]){assert.equal(v.validate({value:1,next:{value:2}}).valid,true);assert.equal(v.validate({value:1,next:{value:'wrong'}}).valid,false);}
});
for(const base of ['relative','',123] as const)test(`invalid base ${base} refuses before caller schema mutation`,()=>{
  const schema:Schema={$ref:'child'},before=Reflect.ownKeys(schema);assert.throws(()=>new Validator(schema,'2020-12',false,base as string));assert.deepEqual(Reflect.ownKeys(schema),before);assert.deepEqual(schema,{$ref:'child'});
});
test('default dereference starts from an immutable string and each explicit URL is independent',()=>{
  assert.equal(initialBaseURI,'https://github.com/cfworker');const supplied=new URL('https://explicit.invalid/root'),a=dereference({const:1},undefined,supplied);supplied.pathname='/changed';
  assert.equal(validate(1,a['https://explicit.invalid/root']!,'2020-12',a).valid,true);
  const b=dereference({const:2}),c=dereference({const:3});assert.deepEqual(Object.keys(b),[initialBaseURI]);assert.deepEqual(Object.keys(c),[initialBaseURI]);
  assert.equal(new Validator({const:4}).validate(4).valid,true);assert.equal(validate(5,{const:5}).valid,true);
});
test('standalone validate accepts caller-composed lookup with an explicit base',()=>{
  const schema:Schema={$ref:'value'},lookup=dereference(schema,undefined,new URL('https://standalone.invalid/root'));dereference({$id:'value',type:'boolean'},lookup,new URL('https://standalone.invalid/root'));
  assert.equal(validate(true,schema,'2020-12',lookup).valid,true);assert.equal(validate('true',schema,'2020-12',lookup).valid,false);
});
