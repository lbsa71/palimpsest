import { canonicalJson } from "../../../../../contracts/common.ts";
import { Validator } from "../../../../../narrow-schema/index.ts";
import type { Schema } from "../../../../../narrow-schema/index.ts";
import type { Tool, ToolCall } from "../types.ts";

// Schema definitions are owned, immutable configuration for the lifetime of a shell run.
// cfworker annotates schemas during dereferencing, so give it a private clone.
const validatorCache = new WeakMap<object, Validator>();
function getValidator(schema: Tool["parameters"]): Validator {
  const cached = validatorCache.get(schema);
  if (cached) return cached;
  const validator = new Validator(structuredClone(schema) as Schema, "2020-12", false);
  validatorCache.set(schema, validator);
  return validator;
}

export function validateToolCall(tools: Tool[], toolCall: ToolCall): Record<string, unknown> {
  const tool = tools.find(candidate => candidate.name === toolCall.name);
  if (!tool) throw new Error(`Tool "${toolCall.name}" not found`);
  return validateToolArguments(tool, toolCall);
}

/** Strict JSON Schema validation. No coercion, optional-null removal, or default insertion. */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): Record<string, unknown> {
  canonicalJson(toolCall.arguments);
  const args = structuredClone(toolCall.arguments);
  const result = getValidator(tool.parameters).validate(args);
  if (result.valid) return args;
  const errors = result.errors.map(error => `  - ${error.instanceLocation}: ${error.error}`).join("\n");
  throw new Error(`Validation failed for tool "${toolCall.name}":\n${errors}`);
}
