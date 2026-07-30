/**
 * Shared primitives for scanning Playwright JUnit XML. (MINCRM-689)
 *
 * WHY THIS EXISTS
 * ---------------
 * Playwright's JUnit reporter emits a flat document — <testsuites> wrapping one
 * <testsuite> per (spec file, project), each wrapping <testcase> elements. What
 * is NOT flat are the CDATA-bodied elements: <system-out>/<system-err> carry a
 * test's captured console output, and <failure>/<error> carry formatFailure()
 * output including the failing source snippet. Their payloads can contain
 * anything, and the reporter's escaping only rewrites a literal `]]>`
 * (`text.replace(/]]>/g, ']]&gt;')` — a single CDATA section, not a split
 * across two). So a payload containing the text `</testsuite>` reaches a naive
 * structural regex verbatim and terminates the suite scan early, silently
 * dropping every later testcase.
 *
 * That is not hypothetical here. A captured CI artifact from run 30483113589
 * (checked in at qa/e2e/tests/framework/__fixtures__/) shows the live payload
 * source is AI-healer diagnostics that embed raw LLM responses — arbitrary
 * model-generated text, on every run with AI_HEALING enabled.
 *
 * ONE SCANNER, TWO POLICIES
 * -------------------------
 * `redactEmbeddedPayloads` is deliberately parameterized by its replacement
 * policy rather than duplicated per caller, because two consumers need the
 * same region identification with different output:
 *
 *   - Masking (this repo's JUnit merger) needs the payload NEUTRALIZED IN
 *     PLACE, preserving byte length, so offsets found in the masked text map
 *     1:1 onto the original document and can be sliced from it exactly.
 *   - Stripping (server/src/scripts/verify-test-attestation.ts's
 *     `stripCapturedOutput`) needs the payload GONE, because it only ever
 *     classifies structure and never re-emits the document.
 *
 * A parity test in qa/e2e/tests/framework/merge-junit-results.spec.ts asserts
 * this module and the server-side stripper identify the SAME regions, so the
 * two definitions cannot drift. They deliberately differ in output: the
 * server-side stripper deletes <system-out>/<system-err> tags entirely, which
 * a length-preserving mask cannot do.
 *
 * Deliberately hand-written rather than using an XML library, matching the
 * reasoning in verify-test-attestation.ts: no XML parser is a real dependency
 * of this workspace (fast-xml-parser appears in node_modules only as an
 * undeclared transitive dep of minio/promptfoo, not safe to rely on surviving a
 * dependency bump).
 */

/** Elements whose bodies are reporter-captured payloads, not structure. */
const PAYLOAD_ELEMENTS = ['system-out', 'system-err', 'failure', 'error'] as const;

/**
 * Matches a CDATA section, including its delimiters. Non-greedy so it closes at
 * the first `]]>`, which is correct because the reporter guarantees no payload
 * contains a literal `]]>` (it rewrites them to `]]&gt;` before emitting).
 */
const CDATA_PATTERN = /<!\[CDATA\[[\s\S]*?\]\]>/g;

/**
 * Matches a payload element with its body, capturing the tag name (group 1),
 * the opening tag's attribute text (group 2), and the body (group 3). The
 * backreference on the closing tag keeps <failure> from closing on
 * </system-out>.
 */
function payloadElementPattern(): RegExp {
  return new RegExp(`<(${PAYLOAD_ELEMENTS.join('|')})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'g');
}

/**
 * One definition of a <testsuite>…</testsuite> region. Built fresh per call
 * because a /g regex carries mutable lastIndex state between uses.
 *
 * `<testsuites>` cannot match: the `\b` after `testsuite` requires a non-word
 * character next and `s` is a word character. No negative lookahead is needed —
 * the defective ci.yml heredocs carried a `(?!s)` that was always redundant, and
 * this matches server/src/scripts/verify-test-attestation.ts's own
 * `suiteRegionRegex`, which omits it.
 *
 * The body match is non-greedy deliberately: a greedy
 * `[\s\S]*` would run past a sibling suite's closing tag and coalesce two
 * suites into one region, which matters because the reporter emits one
 * <testsuite> per (spec file, project) and a multi-project run therefore has
 * siblings. Non-greedy is only safe once payloads have been redacted — that is
 * the whole point of pairing this with redactEmbeddedPayloads.
 */
export function suiteRegionPattern(): RegExp {
  return /<testsuite\b([^>]*?)>([\s\S]*?)<\/testsuite>/g;
}

/** Matches a <testcase> element, self-closing or with a body. */
export function testCasePattern(): RegExp {
  return /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
}

/**
 * Rewrites every reporter-captured payload using `replace`, leaving all
 * structural markup untouched.
 *
 * Two stages, in this order, and the order is load-bearing:
 *
 *  1. CDATA sections are redacted first. A CDATA section's boundary is findable
 *     without understanding the surrounding structure, so this neutralizes a
 *     hostile payload regardless of which element encloses it — including any
 *     element type added to the reporter in future.
 *  2. Payload elements are then redacted. Today's reporter always CDATA-wraps
 *     these bodies (`escape(..., true)` then an unconditional `<![CDATA[` wrap,
 *     with no size threshold and no plain-text path), so stage 1 alone already
 *     neutralizes real output. Stage 2 is defense in depth against a reporter
 *     that stops wrapping: without it, a plain-text body would be scanned as
 *     structure. It costs one pass and removes a dependency on reporter
 *     internals staying as they are.
 *
 * Reversing these two stages would mean step 2's `[^>]*` attribute scan runs
 * over un-redacted CDATA, where a payload containing `>` can terminate the
 * attribute match early.
 *
 * @param replace Receives the text being removed — for a CDATA section that is
 *   the WHOLE section including its `<![CDATA[`/`]]>` delimiters, and for a
 *   payload element it is the element's body. Whatever is passed in is exactly
 *   what the return value replaces, so a policy returning
 *   `FILLER.repeat(text.length)` preserves byte length everywhere. Return `''`
 *   to strip.
 */
export function redactEmbeddedPayloads(xml: string, replace: (payload: string) => string): string {
  // `replace` receives the entire matched section, delimiters included, so that
  // "length of what I was given" equals "length of what I am replacing". An
  // earlier version passed only the inner text while substituting for the whole
  // section, which silently shrank the document by the 12 delimiter bytes per
  // block and invalidated every offset a masking caller derived from it.
  const withoutCdata = xml.replace(CDATA_PATTERN, (section) => replace(section));
  // Preserve each element's own tags and hand `replace` only the body, so
  // structure survives and a length-preserving policy still balances: the
  // returned run substitutes for `body` alone.
  return withoutCdata.replace(
    payloadElementPattern(),
    (_full, tag: string, attrs: string, body: string) =>
      `<${tag}${attrs}>${replace(body)}</${tag}>`,
  );
}

/**
 * Extracts a double-quoted attribute value from an opening tag's attribute
 * text. Returns null when absent.
 *
 * Deliberately NOT exported. A general-purpose attribute reader already exists
 * in server/src/scripts/verify-test-attestation.ts, and that one additionally
 * handles backslash escapes and decodes XML entities. Exporting a second,
 * simpler one invites a caller to pick up the non-decoding version by accident,
 * which is a silent-wrong-value bug rather than a visible one. This copy stays
 * private to extractNumericAttr, whose inputs are the four integer count
 * attributes — no entities, no escapes — so the simpler pattern is sufficient
 * and provably safe for that use alone. Anything needing text attributes should
 * use the server-side reader, not this.
 */
function extractAttr(tagText: string, attrName: string): string | null {
  const match = new RegExp(`\\b${attrName}="([^"]*)"`).exec(tagText);
  return match ? match[1] : null;
}

/**
 * Reads a count attribute, treating absent, unparseable and negative alike as 0.
 *
 * Negatives are clamped rather than passed through: these four attributes are
 * counts, nothing downstream validates the merged root, and a negative would
 * silently corrupt a sum (or make `tests` disagree with the row count and trip
 * `hasParseDisagreement` for a reason no reader could trace back to here).
 */
export function extractNumericAttr(tagText: string, attrName: string): number {
  const raw = extractAttr(tagText, attrName);
  if (raw === null) return 0;
  const value = parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) return 0;
  return value;
}
