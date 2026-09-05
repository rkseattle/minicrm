// The named export, not the default: ajv v8 is CommonJS, and its default is not
// constructable under Node16 resolution.
import { Ajv, type ValidateFunction } from 'ajv';

import discovery from './__fixtures__/gmail-discovery.json';

/**
 * Holds the Gmail fake to Google's published schema.
 *
 * Gmail has no sandbox, so the fake is the only double available and its failure mode is
 * agreeing with our own assumptions rather than with Google. The Discovery Document is the
 * contract to check it against.
 *
 * Discovery is not JSON Schema, and compiling it unmodified proves almost nothing: not one
 * schema in the published document carries `required` or `additionalProperties`, so an
 * untouched compile accepts `{}` and accepts invented fields. It catches only a wrong type
 * on a field that happens to be present. Normalization is what makes it a contract.
 *
 * The fixture is a subset: the schemas this driver reads, plus everything they `$ref`,
 * closed transitively. Refreshing it means re-running that closure, not hand-adding a name.
 */

/**
 * Discovery keywords that are documentation, not validation — ajv rejects some outright.
 * Only what this fixture actually contains: a name listed here that never appears reads as
 * evidence the fixture exercises it.
 */
const DISCOVERY_ONLY_KEYWORDS = ['annotations', 'description', 'id'] as const;

/** Discovery's own format names, none of which JSON Schema defines. */
const DISCOVERY_FORMATS = ['byte', 'int32', 'int64', 'uint32', 'uint64'] as const;

/**
 * Fields this driver dereferences without a guard. Declaring them is the half of the
 * contract Discovery omits, and the list is deliberately short: a field the driver
 * handles the absence of does not belong here, because requiring it would stop the fake
 * expressing a case the driver is built for.
 *
 * `Message.threadId` is the example — the RFC 5322 fallback exists precisely for a message
 * that arrives without one — as is `Profile.historyId`, whose absence means an unanchored
 * mailbox rather than a malformed response.
 */
const REQUIRED_BY_SCHEMA: Record<string, readonly string[]> = {
  Message: ['id'],
  Profile: ['emailAddress'],
  History: ['id'],
  HistoryMessageAdded: ['message'],
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rewrites one Discovery node into JSON Schema.
 *
 * `additionalProperties: false` is injected into every object node, not just named schemas:
 * an inline nested object is exactly where a fake invents a field, and leaving those open
 * would let the misspelling this suite exists to catch pass.
 *
 * The walk has to know where it is. Under `properties` the keys are field names, and Gmail
 * has real fields called `id` and `description` — stripping by name at every depth deletes
 * `Message.id` along with the `"id": "Message"` keyword beside it, which `additionalProperties`
 * then rejects.
 */
function normalizeNode(node: unknown, inPropertyMap = false): unknown {
  if (Array.isArray(node)) return node.map((item) => normalizeNode(item));
  if (!isObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (inPropertyMap) {
      out[key] = normalizeNode(value);
      continue;
    }
    if ((DISCOVERY_ONLY_KEYWORDS as readonly string[]).includes(key)) continue;

    if (key === '$ref' && typeof value === 'string') {
      out.$ref = `#/definitions/${value}`;
      continue;
    }
    if (key === 'format' && typeof value === 'string') {
      if ((DISCOVERY_FORMATS as readonly string[]).includes(value)) continue;
      out.format = value;
      continue;
    }
    out[key] = normalizeNode(value, key === 'properties');
  }

  if (out.type === 'object' && out.additionalProperties === undefined) {
    out.additionalProperties = false;
  }
  return out;
}

interface DiscoveryFixture {
  revision: string;
  schemas: Record<string, unknown>;
}

const fixture = discovery as DiscoveryFixture;

/** The vendored document's revision, so a copy without provenance cannot land. */
export const DISCOVERY_REVISION = fixture.revision;

export const GMAIL_SCHEMA_NAMES = Object.keys(fixture.schemas);

/** The raw vendored schemas, so a test can walk the reference graph they declare. */
export const GMAIL_SCHEMAS: Record<string, unknown> = fixture.schemas;

const definitions: JsonObject = {};
for (const [name, schema] of Object.entries(fixture.schemas)) {
  const normalized = normalizeNode(schema);
  const required = REQUIRED_BY_SCHEMA[name];
  definitions[name] =
    required && isObject(normalized) ? { ...normalized, required: [...required] } : normalized;
}

// Discovery carries keywords ajv would reject outright, and normalization cannot strip
// every one without hard-coding more of Google's vocabulary than is worth pinning.
const ajv = new Ajv({ strict: false, allErrors: true });

// Registered once under a single root: compiling per name would re-embed all 14
// definitions into every validator.
ajv.addSchema({ $id: 'gmail', definitions }, 'gmail');

const validators = new Map<string, ValidateFunction>();

/** Resolves one named schema against the shared registry, memoized. */
function validatorFor(name: string): ValidateFunction {
  const cached = validators.get(name);
  if (cached) return cached;
  if (!(name in definitions)) {
    throw new Error(`No Gmail schema named ${name} in the vendored Discovery Document`);
  }
  const compiled = ajv.getSchema(`gmail#/definitions/${name}`);
  if (!compiled) throw new Error(`Gmail schema ${name} did not compile`);
  validators.set(name, compiled);
  return compiled;
}

/**
 * Marks the thrown error as already-classified.
 *
 * `json()` runs inside the driver's own request `try`, whose catch rewrites anything
 * without a `code` into `CONNECTION_FAILED / "Could not reach Gmail."` — which would
 * replace every schema message with the one diagnostic that hides it, inside tests whose
 * assertions expect exactly that error.
 */
export const SCHEMA_VIOLATION = 'GMAIL_FAKE_SCHEMA_VIOLATION';

/**
 * Throws unless `body` matches the named Gmail schema.
 *
 * Called from the test fake's `json()`, so every response the driver is given is checked
 * without any individual test having to opt in.
 */
export function assertMatchesGmailSchema(name: string, body: unknown): void {
  const validate = validatorFor(name);
  if (validate(body)) return;
  const detail = (validate.errors ?? [])
    .map((err) => `${err.instancePath || '/'} ${err.message ?? ''}`.trim())
    .join('; ');
  throw Object.assign(
    new Error(`Gmail fake does not match ${name} (revision ${DISCOVERY_REVISION}): ${detail}`),
    { code: SCHEMA_VIOLATION },
  );
}
