// The named export, not the default: ajv v8 is CommonJS, and its default is not
// constructable under Node16 resolution.
import { Ajv, type ValidateFunction } from 'ajv';

import schema from './__fixtures__/graph-message-schema.json';

/**
 * Holds the Graph fake to a written contract.
 *
 * Microsoft publishes no sandbox, so the fake is the only double available and its failure
 * mode is agreeing with our own assumptions. The fixture is weaker evidence than Gmail's:
 * `gmail-discovery.json` is a subset of a document Google publishes, where Microsoft
 * publishes CSDL and a very large OpenAPI document that `gmailSchema.ts`'s normalizer
 * cannot read — so this one is written by hand and encodes the same reading of the API the
 * fake does.
 *
 * What it still catches is the failure that bit the IMAP fake repeatedly: a fake drifting
 * from itself as tests are added — an invented field, a missing `id`, a wrong type —
 * because it is written once and every route is checked against it.
 */

interface SchemaFixture {
  apiVersion: string;
  definitions: Record<string, unknown>;
}

const fixture = schema as unknown as SchemaFixture;

/** The API version this fixture describes, so a copy without provenance cannot land. */
export const GRAPH_API_VERSION = fixture.apiVersion;

export const GRAPH_SCHEMA_NAMES = Object.keys(fixture.definitions);

const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema({ $id: 'graph', definitions: fixture.definitions }, 'graph');

const validators = new Map<string, ValidateFunction>();

/** Resolves one named schema against the shared registry, memoized. */
function validatorFor(name: string): ValidateFunction {
  const cached = validators.get(name);
  if (cached) return cached;
  if (!(name in fixture.definitions)) {
    throw new Error(`No Graph schema named ${name} in the vendored fixture`);
  }
  const compiled = ajv.getSchema(`graph#/definitions/${name}`);
  if (!compiled) throw new Error(`Graph schema ${name} did not compile`);
  validators.set(name, compiled);
  return compiled;
}

/**
 * Marks the thrown error as already-classified.
 *
 * `json()` runs inside the driver's own request `try`, whose catch rewrites anything
 * without a `code` into CONNECTION_FAILED — which would replace every schema message with
 * the one diagnostic that hides it, inside tests whose assertions expect exactly that
 * error.
 */
const SCHEMA_VIOLATION = 'GRAPH_FAKE_SCHEMA_VIOLATION';

/**
 * Throws unless `body` matches the named Graph schema.
 *
 * Called from the test fake's `json()`, so every response the driver is given is checked
 * without any individual test having to opt in.
 */
export function assertMatchesGraphSchema(name: string, body: unknown): void {
  const validate = validatorFor(name);
  if (validate(body)) return;
  const detail = (validate.errors ?? [])
    .map((err) => `${err.instancePath || '/'} ${err.message ?? ''}`.trim())
    .join('; ');
  throw Object.assign(
    new Error(`Graph fake does not match ${name} (${GRAPH_API_VERSION}): ${detail}`),
    { code: SCHEMA_VIOLATION },
  );
}
