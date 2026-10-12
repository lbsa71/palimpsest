import { dereference, initialBaseURI } from './dereference.ts';
import type { Schema, SchemaDraft, ValidationResult } from './types.ts';
import { validate } from './validate.ts';

export class Validator {
  private readonly lookup: ReturnType<typeof dereference>;

  private readonly schema: Schema | boolean;
  private readonly draft: SchemaDraft;
  private readonly shortCircuit: boolean;
  private readonly baseURI: string;

  constructor(
    schema: Schema | boolean,
    draft: SchemaDraft = '2019-09',
    shortCircuit = true,
    baseURI: string = initialBaseURI
  ) {
    if (typeof baseURI !== 'string') throw new TypeError('Schema base URI must be a string');
    this.baseURI = new URL(baseURI).href;
    this.schema = structuredClone(schema);
    this.draft = draft;
    this.shortCircuit = shortCircuit;
    this.lookup = dereference(this.schema, undefined, new URL(this.baseURI));
  }

  public validate(instance: any): ValidationResult {
    return validate(
      instance,
      this.schema,
      this.draft,
      this.lookup,
      this.shortCircuit
    );
  }

  public addSchema(schema: Schema, id?: string): void {
    schema = structuredClone(schema);
    if (id) {
      schema = { ...schema, $id: id };
    }
    dereference(schema, this.lookup, new URL(this.baseURI));
  }
}
