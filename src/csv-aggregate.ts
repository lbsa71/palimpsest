import type { ProcedureDefinition } from './procedures.ts';

/** A definition for explicit review/publication, never an implicit approval. */
export const CSV_AGGREGATE_PROCEDURE: ProcedureDefinition = {
  manifest: {
    schemaVersion: 1, name: 'csv-aggregate', version: '1.0.0', runtime: 'node',
    description: 'Sum one explicitly selected finite numeric CSV column; reject malformed or ambiguous input.',
    inputSchema: { type: 'object', properties: { csv: { type: 'string' }, column: { type: 'string' } }, required: ['csv', 'column'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { column: { type: 'string' }, count: { type: 'integer' }, sum: { type: 'number' } }, required: ['column', 'count', 'sum'], additionalProperties: false },
    permissions: [], timeoutMs: 1000, maxOutputBytes: 4096,
    examples: [{ input: { csv: 'name,amount\nAda,3\nLin,4\n', column: 'amount' }, output: { column: 'amount', count: 2, sum: 7 } }],
    tests: [
      { input: { csv: 'name,amount\nAda,3\nLin,4\n', column: 'amount' }, expected: { column: 'amount', count: 2, sum: 7 } },
      { input: { csv: 'value\n-2\n5\n', column: 'value' }, expected: { column: 'value', count: 2, sum: 3 } },
    ],
  },
  source: String.raw`
let body=''; for await (const chunk of process.stdin) body+=chunk;
const {csv,column}=JSON.parse(body);
const rows=[]; let row=[],field='',quoted=false,closed=false;
for(let i=0;i<csv.length;i++) {
  const char=csv[i];
  if(quoted) {
    if(char==='"' && csv[i+1]==='"') {field+='"';i++;}
    else if(char==='"') {quoted=false;closed=true;}
    else field+=char;
    continue;
  }
  if(closed && char!==',' && char!=='\n' && char!=='\r') throw new Error('Invalid text after quote');
  if(char==='"') {if(field.length) throw new Error('Quote in unquoted field');quoted=true;}
  else if(char===',') {row.push(field);field='';closed=false;}
  else if(char==='\n' || char==='\r') {if(char==='\r' && csv[i+1]==='\n') i++;row.push(field);rows.push(row);row=[];field='';closed=false;}
  else field+=char;
}
if(quoted) throw new Error('Unterminated quote');
if(row.length || field.length || closed) {row.push(field);rows.push(row);}
if(!rows.length) throw new Error('CSV requires header');
const headers=rows.shift();
if(headers.some(name=>!name.trim()) || new Set(headers).size!==headers.length) throw new Error('Ambiguous header');
const index=headers.indexOf(column);
if(index<0) throw new Error('Selected column is absent');
let sum=0;
for(const row of rows) {
  if(row.length!==headers.length) throw new Error('Unequal row widths');
  const value=row[index].trim();
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error('Selected cell is not a decimal number');
  const number=Number(value);
  if(!Number.isFinite(number)) throw new Error('Selected cell is not finite');
  sum+=number;
  if(!Number.isFinite(sum)) throw new Error('Total overflow');
}
process.stdout.write(JSON.stringify({column,count:rows.length,sum}));
`,
};
