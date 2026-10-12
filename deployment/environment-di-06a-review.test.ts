import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createContext, Script } from 'node:vm';
import { Validator, type Schema } from '../packages/narrow-schema/index.ts';
import { dereference } from '../packages/narrow-schema/vendor/cfworker/dereference.ts';
import { validate } from '../packages/narrow-schema/vendor/cfworker/validate.ts';

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

test('DI06a review: shared frozen graph resolves relative dot segments and query identifiers independently', () => {
  const root: Schema = freezeTree({ type: 'object', properties: { value: { $ref: '../values/item?edition=2#chosen' } }, required: ['value'] });
  const entry: Schema = freezeTree({ $id: '../values/item?edition=2', $defs: { selected: { $anchor: 'chosen', $ref: './constraint' } } });
  const a = new Validator(root, '2020-12', false, 'https://one.invalid/api/roots/root');
  const b = new Validator(root, '2020-12', false, 'https://two.invalid/api/roots/root');
  for (const v of [a, b]) v.addSchema(entry);
  a.addSchema({ const: 'one' }, '../values/constraint');
  b.addSchema({ const: 'two' }, '../values/constraint');
  assert.equal(a.validate({ value: 'one' }).valid, true);
  assert.equal(a.validate({ value: 'two' }).valid, false);
  assert.equal(b.validate({ value: 'two' }).valid, true);
  assert.equal(b.validate({ value: 'one' }).valid, false);
  assert.deepEqual(Reflect.ownKeys(root.properties!.value as Schema), ['$ref']);
});

test('DI06a review: nested absolute resource IDs and anchors resolve independently of caller base', () => {
  const schema: Schema = freezeTree({
    $id: 'https://canonical.invalid/root',
    $defs: { resource: { $id: 'https://nested.invalid/folder/resource', $defs: { value: { $anchor: 'value', type: 'integer', minimum: 4 } }, $ref: '#value' } },
    $ref: 'https://nested.invalid/folder/resource',
  });
  for (const base of ['https://other.invalid/root', 'file:///controlled/schema.json']) {
    const v = new Validator(schema, '2020-12', false, base);
    assert.equal(v.validate(4).valid, true);
    assert.equal(v.validate(3).valid, false);
    assert.equal(v.validate('4').valid, false);
  }
});

test('DI06a review: frozen escaped unicode pointer and boolean subschema preserve assertions', () => {
  const root: Schema = freezeTree({ $defs: { 'a/b~ café': { type: 'array', items: { type: 'integer' }, minItems: 1 }, denied: false }, allOf: [{ $ref: '#/$defs/a~1b~0%20caf%C3%A9' }, { not: { $ref: '#/$defs/denied' } }] });
  const v = new Validator(root, '2020-12', false, 'https://pointer.invalid/a/root');
  assert.equal(v.validate([1]).valid, true);
  assert.equal(v.validate([]).valid, false);
  assert.equal(v.validate(['1']).valid, false);
});

test('DI06a review: recursive added resource keeps deep failures in both isolated bases', () => {
  const root: Schema = freezeTree({ $ref: 'tree' });
  const tree: Schema = freezeTree({ $id: 'tree', $recursiveAnchor: true, type: 'object', required: ['value'], properties: { value: { type: 'integer' }, children: { type: 'array', items: { $recursiveRef: '#' } } }, additionalProperties: false });
  for (const base of ['https://first.invalid/root', 'https://second.invalid/root']) {
    const v = new Validator(root, '2019-09', false, base);
    v.addSchema(tree);
    assert.equal(v.validate({ value: 1, children: [{ value: 2, children: [{ value: 3 }] }] }).valid, true);
    const bad = v.validate({ value: 1, children: [{ value: 2, children: [{ value: '3' }] }] });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some(error => error.instanceLocation === '#/children/0/children/0/value'));
  }
});

test('DI06a review: already-dereferenced caller metadata cannot override a new instance base', () => {
  const schema: Schema = { type: 'object', properties: { value: { $ref: 'leaf' } } };
  dereference(schema, undefined, new URL('https://prior.invalid/root'));
  freezeTree(schema);
  const v = new Validator(schema, '2020-12', false, 'https://current.invalid/root');
  v.addSchema({ const: 7 }, 'leaf');
  assert.equal(v.validate({ value: 7 }).valid, true);
  assert.equal(v.validate({ value: 8 }).valid, false);
  assert.equal((schema.properties!.value as Schema).__absolute_ref__, 'https://prior.invalid/leaf');
});

test('DI06a review: root and addSchema snapshots isolate deep constraints and later instances', () => {
  const schema: Schema = { type: 'object', properties: { value: { $ref: 'entry' } }, required: ['value'] };
  const entry: Schema = { $id: 'entry', $defs: { rule: { enum: ['old'], type: 'string' } }, $ref: '#/$defs/rule' };
  const a = new Validator(schema, '2020-12', false, 'https://first.invalid/root');
  a.addSchema(entry);
  schema.required!.push('other');
  entry.$defs.rule.enum[0] = 'new';
  const b = new Validator(schema, '2020-12', false, 'https://second.invalid/root');
  b.addSchema(entry);
  assert.equal(a.validate({ value: 'old' }).valid, true);
  assert.equal(a.validate({ value: 'new' }).valid, false);
  assert.equal(b.validate({ value: 'new' }).valid, false);
  assert.equal(b.validate({ value: 'new', other: true }).valid, true);
  assert.equal(b.validate({ value: 'old', other: true }).valid, false);
  assert.deepEqual(Reflect.ownKeys(entry.$defs.rule).sort(), ['enum', 'type']);
});

test('DI06a review: addSchema ID argument overrides input ID using the captured base', () => {
  const added: Schema = freezeTree({ $id: 'https://irrelevant.invalid/other', $ref: './leaf' });
  const v = new Validator({ $ref: 'child/entry' }, '2020-12', false, 'https://base.invalid/root');
  v.addSchema(added, 'child/entry');
  v.addSchema({ const: 23 }, 'child/leaf');
  assert.equal(v.validate(23).valid, true);
  assert.equal(v.validate(24).valid, false);
  assert.equal(added.$id, 'https://irrelevant.invalid/other');
});

test('DI06a review: invalid base is rejected before traversing caller schema', () => {
  let reads = 0;
  const schema: Schema = { get $ref() { reads++; return 'child'; } };
  for (const base of ['https://[invalid', '/relative', '', null, new URL('https://valid.invalid/')]) {
    assert.throws(() => new Validator(schema, '2020-12', false, base as string), TypeError);
  }
  assert.equal(reads, 0);
  assert.deepEqual(Reflect.ownKeys(schema), ['$ref']);
});

test('DI06a review: malformed identifiers fail visibly and rejected add does not replace existing schema', () => {
  const invalid: Schema = freezeTree({ $id: 'https://[bad', type: 'integer' });
  assert.throws(() => new Validator(invalid, '2020-12', false, 'https://base.invalid/'), TypeError);
  const v = new Validator({ $ref: 'child' }, '2020-12', false, 'https://base.invalid/');
  v.addSchema({ const: 'retained' }, 'child');
  assert.throws(() => v.addSchema(invalid), TypeError);
  assert.throws(() => v.addSchema({ const: 'replacement' }, 'child'), /Duplicate schema URI/);
  assert.equal(v.validate('retained').valid, true);
  assert.equal(v.validate('replacement').valid, false);
  assert.deepEqual(Reflect.ownKeys(invalid), ['$id', 'type']);
});

test('DI06a review: missing remote reference remains an explicit lookup failure', () => {
  const v = new Validator({ $ref: 'https://unprovided.invalid/schema' }, '2020-12', false, 'https://base.invalid/');
  assert.throws(() => v.validate({}), /https:\/\/unprovided.invalid\/schema/);
  v.addSchema({ type: 'integer' }, 'https://unprovided.invalid/schema');
  assert.equal(v.validate(5).valid, true);
  assert.equal(v.validate('5').valid, false);
});

test('DI06a review: direct dereference captures supplied URL before caller getters run', () => {
  const supplied = new URL('https://captured.invalid/root');
  const schema: Schema = { get $id() { supplied.pathname = '/changed/elsewhere'; return undefined; }, $ref: 'leaf' };
  const lookup = dereference(schema, undefined, supplied);
  dereference({ $id: 'leaf', const: 'ok' }, lookup, new URL('https://captured.invalid/root'));
  assert.equal(schema.__absolute_ref__, 'https://captured.invalid/leaf');
  assert.equal(validate('ok', schema, '2020-12', lookup).valid, true);
  assert.equal(validate('bad', schema, '2020-12', lookup).valid, false);
});

test('DI06a review: entire retained module initialization is inert in isolated hostile host realm', () => {
  const vendor = new URL('../packages/narrow-schema/vendor/cfworker/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('source-manifest.json', vendor), 'utf8')) as { files: Array<{ retained: string }> };
  const sources = new Map(manifest.files.map(entry => [entry.retained, readFileSync(new URL(entry.retained, vendor), 'utf8')]));
  const observed: string[] = [];
  const sandbox = Object.create(null) as Record<string, unknown>;
  for (const name of ['self', 'window', 'location', 'process', 'fetch', 'WebSocket', 'Date', 'performance', 'setTimeout', 'setInterval', 'URL', 'structuredClone']) {
    Object.defineProperty(sandbox, name, { get() { observed.push(name); throw new Error(`Unexpected initialization read: ${name}`); } });
  }
  const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const loaded = new Map<string, Record<string, unknown>>();
  function load(name: string): Record<string, unknown> {
    if (loaded.has(name)) return loaded.get(name)!;
    const source = sources.get(name);
    assert.ok(source !== undefined, `Only retained source imports allowed: ${name}`);
    // Node erases types. This small linker changes only static import/export syntax,
    // preserving module bodies and evaluating each once in the isolated realm.
    const stripped = stripTypeScriptTypes(source);
    const exported = [...stripped.matchAll(/\bexport\s+(?:const|let|function|class)\s+(\w+)/g)].map(match => match[1]);
    const body = stripped.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?/g, (_all, bindings: string, dependency: string) => `const {${bindings}} = __load(${JSON.stringify(dependency)});`).replace(/\bexport\s+(?=const|let|function|class)/g, '');
    const factory = new Script(`(function(__load) { 'use strict';\n${body}\nreturn { ${exported.join(', ')} }; })`, { filename: name }).runInContext(context);
    const result = factory(load) as Record<string, unknown>;
    loaded.set(name, result);
    return result;
  }
  const exports = load('validator.ts');
  assert.equal(typeof exports.Validator, 'function');
  for (const name of sources.keys()) load(name);
  assert.equal(loaded.size, 8);
  assert.deepEqual(observed, []);
});
