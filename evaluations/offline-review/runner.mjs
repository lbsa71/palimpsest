// This script and its inputs run entirely inside the candidate namespace.
import { readFileSync } from 'node:fs';
import { Validator } from '/app/packages/narrow-schema/index.ts';
const inputs = JSON.parse(readFileSync('/work/inputs.json', 'utf8'));
process.stdout.write(JSON.stringify(inputs.map(({ schema, value }) => new Validator(schema).validate(value).valid)));
