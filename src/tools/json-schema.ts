import { z } from 'zod';

/** Publish the existing MCP input contract using Zod's native converter. */
export function toToolInputSchema(schema: z.ZodType) {
  const result = z.toJSONSchema(schema, {
    target: 'draft-07',
    io: 'input',
    reused: 'inline',
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema instanceof z.ZodObject) {
        // The previous converter advertised stripping objects as closed and
        // explicit passthrough objects as open, including nested PDF options.
        if (jsonSchema.additionalProperties === undefined) {
          jsonSchema.additionalProperties = false;
        } else if (typeof jsonSchema.additionalProperties === 'object'
          && Object.keys(jsonSchema.additionalProperties).length === 0) {
          jsonSchema.additionalProperties = true;
        }
      }
      if (zodSchema instanceof z.ZodRecord
        && typeof jsonSchema.propertyNames === 'object'
        && jsonSchema.propertyNames !== null
        && jsonSchema.propertyNames.type === 'string'
        && Object.keys(jsonSchema.propertyNames).length === 1) {
        // Every JSON object key is already a string; retain the prior wire shape.
        delete jsonSchema.propertyNames;
      }
      if (zodSchema instanceof z.ZodString && jsonSchema.format === 'date-time') {
        // Keep the existing date-time wire contract; runtime ISO validation
        // remains in the original string schema.
        delete jsonSchema.pattern;
      }
    },
  });
  if (result.type !== 'object') throw new Error('Tool input schema must be an object');
  return { ...result, type: 'object' as const };
}
