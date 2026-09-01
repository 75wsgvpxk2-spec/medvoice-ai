/**
 * Checks a parsed model response against the schema the model was given.
 *
 * A JSON schema is sent with every agent request, but nothing verified the
 * reply against it: both provider paths did `JSON.parse(text) as T`, and a cast
 * is a promise to the compiler rather than a check on the data. Any shape the
 * model returned — a missing field, a string where an array belongs, an invented
 * key — flowed into the agents and out to the clinician as though it had been
 * validated.
 *
 * This covers exactly the JSON Schema subset the agents actually use, measured
 * across `server/src/agents/*.ts`: objects with `properties`, `required` and
 * `additionalProperties`, arrays with `items`, strings with an optional `enum`,
 * and booleans. Anything richer would be unused code pretending to be a
 * guarantee, so an unknown `type` is reported rather than quietly accepted.
 */

export interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: string[];
}

/** Every problem found, as paths a person can act on. Empty means valid. */
export function validate(value: unknown, schema: Schema, path = 'output'): string[] {
  const problems: string[] = [];

  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [`${path} should be an object, got ${describe(value)}`];
      }
      const record = value as Record<string, unknown>;

      for (const key of schema.required ?? []) {
        if (!(key in record)) problems.push(`${path}.${key} is missing`);
      }

      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key in record) problems.push(...validate(record[key], child, `${path}.${key}`));
      }

      // A key the schema did not declare is a field nothing downstream reads
      // and nobody asked for, which on a clinical record is worth refusing
      // rather than ignoring.
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(schema.properties && key in schema.properties)) {
            problems.push(`${path}.${key} is not a field this agent returns`);
          }
        }
      }
      return problems;
    }

    case 'array': {
      if (!Array.isArray(value)) return [`${path} should be an array, got ${describe(value)}`];
      if (schema.items) {
        value.forEach((item, index) => {
          problems.push(...validate(item, schema.items!, `${path}[${index}]`));
        });
      }
      return problems;
    }

    case 'string': {
      if (typeof value !== 'string') return [`${path} should be a string, got ${describe(value)}`];
      if (schema.enum && !schema.enum.includes(value)) {
        // The enums here are the clinical vocabulary — observation types,
        // urgency, gap types. A value outside one matches nothing downstream
        // and would be silently dropped.
        return [`${path} is "${value}", which is not one of: ${schema.enum.join(', ')}`];
      }
      return problems;
    }

    case 'boolean':
      return typeof value === 'boolean' ? problems : [`${path} should be true or false, got ${describe(value)}`];

    case 'number':
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value)
        ? problems
        : [`${path} should be a number, got ${describe(value)}`];

    default:
      // No declared type means nothing to check; a type this validator does not
      // implement is said out loud rather than treated as a pass.
      if (schema.type === undefined) return problems;
      return [`${path} uses schema type "${schema.type}", which is not checked here`];
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}
