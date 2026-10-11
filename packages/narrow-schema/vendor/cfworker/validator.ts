import { dereference } from './dereference.ts';
import type { Schema, SchemaDraft, ValidationResult } from './types.ts';
import { validate } from './validate.ts';

export class Validator {
  private readonly lookup: ReturnType<typeof dereference>;

  private readonly schema: Schema | boolean;
  private readonly draft: SchemaDraft;
  private readonly shortCircuit: boolean;

  constructor(
    schema: Schema | boolean,
    draft: SchemaDraft = '2019-09',
    shortCircuit = true
  ) {
    this.schema = schema;
    this.draft = draft;
    this.shortCircuit = shortCircuit;
    this.lookup = dereference(schema);
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
    if (id) {
      schema = { ...schema, $id: id };
    }
    dereference(schema, this.lookup);
  }
}
