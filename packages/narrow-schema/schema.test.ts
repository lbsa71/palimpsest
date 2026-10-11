import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Validator } from './index.ts';
import type { Schema } from './index.ts';
const fixtures = new URL('./test/fixtures/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtures), 'utf8'));
interface Group { description: string; schema: Schema | boolean; tests: { description: string; data: unknown; valid: boolean }[]; }
for (const file of manifest.files) {
  const groups: Group[] = JSON.parse(readFileSync(new URL(file.retained, fixtures), 'utf8'));
  for (const group of groups) {
    test(`JSON-Schema-Test-Suite: ${file.retained}: ${group.description}`, () => {
      const validator = new Validator(structuredClone(group.schema), '2020-12', false);
      for (const entry of group.tests) assert.equal(validator.validate(entry.data).valid, entry.valid, entry.description);
    });
  }
}

// Original cfworker Validator API cases retained with node:test instead of chai/mocha.
test('upstream Validator validates, adds schemas, and supports explicit identifiers', () => {
  const numeric = new Validator({ type: 'number' });
  assert.equal(numeric.validate(7).valid, true);
  assert.equal(numeric.validate('hello world').valid, false);
  for (const explicitId of [false, true]) {
    const validator = new Validator({ $id: 'https://foo.bar/baz', $ref: '/beep' });
    validator.addSchema(explicitId ? { type: 'boolean' } : { $id: 'https://foo.bar/beep', type: 'boolean' }, explicitId ? 'https://foo.bar/beep' : undefined);
    assert.equal(validator.validate(true).valid, true);
    assert.equal(validator.validate('hello world').valid, false);
  }
});
test('upstream Validator emits nested array errors and nested object errors', () => {
  const array = new Validator({ type: 'array', items: { name: { type: 'string' }, email: { type: 'string' }, required: ['name', 'email'] } }, '2019-09', false);
  const arrayResult = array.validate([{ name: 'hello' }, { email: 'a@b.c' }]);
  assert.equal(arrayResult.valid, false); assert.equal(arrayResult.errors.length, 4);
  const object = new Validator({ type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, number: { type: 'number' }, required: ['name', 'email', 'number'] } }, '2019-09', false);
  const objectResult = object.validate({ name: 'hello', email: 5, number: 'Hello' });
  assert.equal(objectResult.valid, false); assert.equal(objectResult.errors.length, 4);
});
test('JSON required/properties/dependencies use own fields even when keys name prototype properties', () => {
  for (const key of ['constructor', 'toString', '__proto__']) {
    const validator = new Validator({ type: 'object', required: [key], properties: { [key]: { type: 'string' } }, additionalProperties: false }, '2020-12', false);
    assert.equal(validator.validate({}).valid, false);
    assert.equal(validator.validate(JSON.parse(`{"${key}":"present"}`)).valid, true);
    assert.equal(validator.validate(JSON.parse(`{"${key}":false}`)).valid, false);
  }
});
test('local references, oneOf ambiguity, boolean schemas, and nested paths remain supported', () => {
  const ref = new Validator({ $defs: { entry: { type: 'integer', minimum: 1 } }, type: 'array', items: { $ref: '#/$defs/entry' } }, '2020-12', false);
  assert.equal(ref.validate([1, 2]).valid, true);
  const result = ref.validate([1, 0]); assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.instanceLocation === '#/1'));
  assert.equal(new Validator({ oneOf: [{ type: 'number' }, { type: 'integer' }] }, '2020-12').validate(2).valid, false);
  assert.equal(new Validator(false).validate({}).valid, false);
  assert.equal(new Validator(true).validate({}).valid, true);
});
