// This script and its inputs run entirely inside the candidate namespace.
import { readFileSync } from 'node:fs';
const inputs = JSON.parse(readFileSync('/work/inputs.json', 'utf8'));
// Capture the actual inputs before candidate initialization can rewrite its visible files.
for (const input of inputs) { Object.freeze(input.schema); Object.freeze(input); }
Object.freeze(inputs);
const { Validator } = await import('/app/packages/narrow-schema/index.ts');
// Validator annotates its schema with dereference metadata; give each call a fresh copy.
process.stdout.write(JSON.stringify(inputs.map(({ schema, value }) => new Validator({ ...schema }).validate(value).valid)));
