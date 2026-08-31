/**
 * Audit script: cross-reference data-testid attributes in the application
 * source against testId strategy values referenced in E2E Page Objects,
 * behaviors, and functional specs.
 *
 * Both sides are read from the AST. A testid is whatever an expression can
 * evaluate to — a ternary's two branches, a `.map()` parameter's members, a
 * value forwarded through a JSX prop — and answering that is a dataflow
 * question, not a text-shape one. A value this cannot resolve is reported for
 * manual review rather than guessed at: matching it on a shared tail like
 * `-select` would absolve every dead id ending the same way.
 *
 * Usage:
 *   tsx qa/scripts/audit-testids.ts
 *
 * Exit codes:
 *   0 — no stale testids found (unexercised testids are informational only)
 *   1 — one or more stale testids found (broken locators, CI-blocking)
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@typescript-eslint/typescript-estree';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestidOccurrence {
  value: string;
  file: string;
  line: number;
}

/**
 * An estree node. The parser is untyped here on purpose: this walk touches a
 * handful of node kinds by name and the full AST union costs more than it pays.
 */
type AstNode = Record<string, unknown> & { type: string };

/**
 * A constant family a testid template can be enumerated over. `byKey` is
 * present for object literals, where a member access names one value.
 */
interface StaticFamily {
  members: string[];
  byKey?: Map<string, string>;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

/** Visit every node in the tree, depth-first. */
function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  if (isNode(node)) visit(node);
  for (const [key, child] of Object.entries(node)) {
    // `parent` would make the walk cyclic; estree sets it under some options.
    if (key === 'parent') continue;
    walk(child, visit);
  }
}

/**
 * Depth-first walk carrying the `.map()` parameter bindings in scope.
 *
 * Scope is tracked rather than flattened because two callbacks in one file
 * routinely name their parameter the same thing, and a flat map would resolve
 * one family's ids against the other's members.
 */
function walkScoped(
  node: unknown,
  bindings: Map<string, string[]>,
  staticMembers: Map<string, StaticFamily>,
  visit: (node: AstNode, bindings: Map<string, string[]>) => void,
): void {
  if (Array.isArray(node)) {
    for (const child of node) walkScoped(child, bindings, staticMembers, visit);
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  let scope = bindings;
  if (isNode(node)) {
    visit(node, bindings);
    const bound = mapCallbackBinding(node, staticMembers);
    if (bound) scope = new Map([...bindings, ...bound]);
  }

  for (const [key, child] of Object.entries(node)) {
    if (key === 'parent') continue;
    walkScoped(child, scope, staticMembers, visit);
  }
}

/** `TAB_KEYS.map((tab) => …)` → the members `tab` takes, keyed by its name. */
function mapCallbackBinding(
  node: AstNode,
  staticMembers: Map<string, StaticFamily>,
): Map<string, string[]> | undefined {
  if (node.type !== 'CallExpression') return undefined;
  const callee = node.callee as AstNode | undefined;
  if (callee?.type !== 'MemberExpression') return undefined;
  const property = callee.property as AstNode | undefined;
  const object = callee.object as AstNode | undefined;
  if (property?.name !== 'map' || object?.type !== 'Identifier') return undefined;

  const family = staticMembers.get(object.name as string);
  if (!family) return undefined;
  const callback = (node.arguments as unknown[])[0];
  if (!isNode(callback)) return undefined;
  const firstParam = (callback.params as unknown[])?.[0];
  if (!isNode(firstParam) || firstParam.type !== 'Identifier') return undefined;
  return new Map([[firstParam.name as string, family.members]]);
}

function lineOf(node: AstNode): number {
  const loc = node.loc as { start?: { line?: number } } | undefined;
  return loc?.start?.line ?? 1;
}

function parseFile(filePath: string, content: string): AstNode {
  try {
    return parse(content, { jsx: true, loc: true }) as unknown as AstNode;
  } catch (err) {
    // A skipped file is a silently smaller corpus, which is exactly how this
    // audit lost sight of the app in the first place.
    throw new Error(
      `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// File traversal
// ---------------------------------------------------------------------------

function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Unit-test sources, which render testids that are not part of the app. */
function isUnitTestFile(filePath: string): boolean {
  return /\.test\.tsx?$/.test(filePath) || filePath.includes(`${path.sep}__tests__${path.sep}`);
}

// ---------------------------------------------------------------------------
// Application-side collection
// ---------------------------------------------------------------------------

/** Attribute and property names whose value IS a testid. */
const TESTID_VALUE_NAMES = new Set(['data-testid', 'testId']);

/**
 * Props whose value is a stem the receiving component appends to. Only
 * OwnerToggle's three suffixes are fixed enough to expand concretely; the rest
 * become dynamic prefixes, because resolving them needs cross-file dataflow.
 *
 * `panelTestidPrefix` is deliberately absent — despite the name it feeds
 * `aria-controls`, never `data-testid`.
 */
const TESTID_PREFIX_NAMES = new Set(['testIdPrefix', 'itemTestidPrefix']);
const OWNER_TOGGLE_SUFFIXES = ['-all', '-mine', '-my-team'] as const;

/** The name a JSX attribute or object property is written under, if it has one. */
function memberName(node: AstNode): string | undefined {
  const key = (node.name ?? node.key) as AstNode | undefined;
  if (!key) return undefined;
  if (key.type === 'JSXIdentifier' || key.type === 'Identifier') return key.name as string;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  // Namespaced JSX (`foo:bar`) nests its own identifier.
  const nested = key.name as AstNode | undefined;
  if (nested && typeof nested.name === 'string') return nested.name;
  return undefined;
}

/**
 * Parse every testid the application can render.
 *
 * Returns statics (exact values) and dynamics (prefix + "*").
 */
export function collectAppTestids(srcDir: string): {
  statics: TestidOccurrence[];
  dynamics: TestidOccurrence[];
} {
  const statics: TestidOccurrence[] = [];
  const dynamics: TestidOccurrence[] = [];

  for (const filePath of findFiles(srcDir, ['.tsx', '.ts'])) {
    // Unit-test fixtures render testids the app never does. The AST reads their
    // JSX as readily as a component's, so an id existing only in a Vitest
    // fixture would answer for a locator against the real app.
    if (isUnitTestFile(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const relPath = path.relative(process.cwd(), filePath);
    const ast = parseFile(relPath, content);

    const staticMembers = collectStaticMembers(ast);

    const addStatic = (value: string, node: AstNode): void => {
      statics.push({ value, file: relPath, line: lineOf(node) });
    };
    const addDynamic = (value: string, node: AstNode): void => {
      dynamics.push({ value, file: relPath, line: lineOf(node) });
    };

    walkScoped(ast, new Map(), staticMembers, (node, bindings) => {
      if (node.type === 'JSXAttribute') {
        const name = memberName(node);
        if (!name) return;
        if (TESTID_VALUE_NAMES.has(name)) {
          harvestTestidExpression(node.value, bindings, staticMembers, addStatic, addDynamic);
        } else if (TESTID_PREFIX_NAMES.has(name)) {
          harvestPrefixProp(name, node.value, addStatic, addDynamic);
        }
        return;
      }
      if (node.type === 'Property') {
        const name = memberName(node);
        if (name && TESTID_VALUE_NAMES.has(name)) {
          harvestTestidExpression(node.value, bindings, staticMembers, addStatic, addDynamic);
        }
      }
    });
  }

  return { statics, dynamics };
}

/** `testIdPrefix="contacts-owner-filter"` → the three ids OwnerToggle renders. */
function harvestPrefixProp(
  propName: string,
  value: unknown,
  addStatic: (value: string, node: AstNode) => void,
  addDynamic: (value: string, node: AstNode) => void,
): void {
  const literal = jsxAttributeLiteral(value);
  if (!literal) return;
  if (propName === 'testIdPrefix') {
    // Concrete ids only: an accompanying `prefix-*` would absolve any dead
    // sibling, which is the fail-open this audit exists to report.
    for (const suffix of OWNER_TOGGLE_SUFFIXES)
      addStatic(`${literal.value}${suffix}`, literal.node);
    return;
  }
  addDynamic(`${literal.value}-*`, literal.node);
}

/** The string behind `foo="bar"` or `foo={'bar'}`, if it is a plain literal. */
function jsxAttributeLiteral(value: unknown): { value: string; node: AstNode } | undefined {
  if (!isNode(value)) return undefined;
  const inner = value.type === 'JSXExpressionContainer' ? value.expression : value;
  if (isNode(inner) && inner.type === 'Literal' && typeof inner.value === 'string') {
    return { value: inner.value, node: inner };
  }
  return undefined;
}

/**
 * Every `const X = [...]` / `const X = {...}` in a file whose members are all
 * string literals, keyed by name. These are the families a testid template can
 * be enumerated over instead of being written off as dynamic.
 */
function collectStaticMembers(ast: AstNode): Map<string, StaticFamily> {
  const families = new Map<string, StaticFamily>();
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    const id = node.id as AstNode | undefined;
    const init = unwrapTypeExpression(node.init);
    if (!id || id.type !== 'Identifier' || !init) return;

    if (init.type === 'ArrayExpression') {
      const elements = (init.elements as unknown[]).filter(isNode);
      const literals = elements.filter((e) => e.type === 'Literal' && typeof e.value === 'string');
      if (literals.length === elements.length && literals.length > 0) {
        families.set(id.name as string, { members: literals.map((e) => e.value as string) });
      }
      return;
    }

    if (init.type === 'ObjectExpression') {
      const properties = (init.properties as unknown[]).filter(isNode);
      const byKey = new Map<string, string>();
      for (const property of properties) {
        const key = memberName(property);
        const value = unwrapTypeExpression(property.value);
        if (!key || value?.type !== 'Literal' || typeof value.value !== 'string') return;
        byKey.set(key, value.value);
      }
      if (byKey.size > 0) {
        families.set(id.name as string, { members: [...byKey.values()], byKey });
      }
    }
  });
  return families;
}

/**
 * `as const` and `satisfies` wrap the initializer in a type node. Reading
 * through them is not cosmetic: `as const` is this repo's dominant idiom for
 * exactly the constant families this enumeration exists to read.
 */
function unwrapTypeExpression(node: unknown): AstNode | undefined {
  let current = node;
  while (
    isNode(current) &&
    (current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression')
  ) {
    current = current.expression;
  }
  return isNode(current) ? current : undefined;
}

/**
 * Reduce a testid expression to the strings it can produce. Anything this walk
 * cannot resolve concretely degrades to a dynamic prefix rather than being
 * dropped, so an unresolvable value never reads as an absent one.
 */
function harvestTestidExpression(
  value: unknown,
  mapBindings: Map<string, string[]>,
  staticMembers: Map<string, StaticFamily>,
  addStatic: (value: string, node: AstNode) => void,
  addDynamic: (value: string, node: AstNode) => void,
  constants?: Map<string, string>,
): void {
  if (!isNode(value)) return;

  switch (value.type) {
    case 'Literal':
      if (typeof value.value === 'string') addStatic(value.value, value);
      return;

    case 'JSXExpressionContainer':
      harvestTestidExpression(
        value.expression,
        mapBindings,
        staticMembers,
        addStatic,
        addDynamic,
        constants,
      );
      return;

    // Both arms of `cond ? 'a' : 'b'` are reachable, so both are real testids.
    case 'ConditionalExpression':
      for (const branch of [value.consequent, value.alternate]) {
        harvestTestidExpression(
          branch,
          mapBindings,
          staticMembers,
          addStatic,
          addDynamic,
          constants,
        );
      }
      return;

    case 'LogicalExpression':
      for (const side of [value.left, value.right]) {
        harvestTestidExpression(side, mapBindings, staticMembers, addStatic, addDynamic, constants);
      }
      return;

    case 'Identifier': {
      const resolved = constants?.get(value.name as string);
      if (resolved !== undefined) addStatic(resolved, value);
      return;
    }

    case 'TemplateLiteral':
      harvestTemplateLiteral(value, mapBindings, staticMembers, addStatic, addDynamic);
      return;

    default:
      return;
  }
}

/** Enumerate a template over a known family, else fall back to its prefix. */
function harvestTemplateLiteral(
  template: AstNode,
  mapBindings: Map<string, string[]>,
  staticMembers: Map<string, StaticFamily>,
  addStatic: (value: string, node: AstNode) => void,
  addDynamic: (value: string, node: AstNode) => void,
): void {
  const quasis = (template.quasis as unknown[]).filter(isNode);
  const expressions = (template.expressions as unknown[]).filter(isNode);
  const text = (quasi: AstNode): string =>
    ((quasi.value as { cooked?: string; raw?: string }).cooked ??
      (quasi.value as { raw?: string }).raw ??
      '') as string;

  if (expressions.length === 0) {
    addStatic(quasis.map(text).join(''), template);
    return;
  }

  if (expressions.length === 1) {
    const members = resolveFamily(expressions[0], mapBindings, staticMembers);
    if (members) {
      const tail = quasis.length > 1 ? text(quasis[1]) : '';
      for (const member of members) addStatic(`${text(quasis[0])}${member}${tail}`, template);
      return;
    }
  }

  const head = text(quasis[0]);
  if (head) {
    addDynamic(`${head}*`, template);
    return;
  }

  // A leading interpolation has no prefix to match on. It is still reported for
  // manual review, but deliberately matches nothing: the only thing left to key
  // on is a tail like `-select`, shared by unrelated ids across the app.
  addDynamic(`*${quasis.map(text).join('*')}`, template);
}

/**
 * The values an interpolated expression can take, if this file can see them.
 *
 * A member access resolves to its ONE named property. Returning the whole
 * family would mint testids the app never renders, and they would register as
 * statics — each one able to match a dead locator and report it healthy.
 */
function resolveFamily(
  expression: AstNode,
  mapBindings: Map<string, string[]>,
  staticMembers: Map<string, StaticFamily>,
): string[] | undefined {
  if (expression.type === 'Identifier') return mapBindings.get(expression.name as string);

  if (expression.type === 'MemberExpression') {
    const object = expression.object as AstNode | undefined;
    if (object?.type !== 'Identifier') return undefined;
    const family = staticMembers.get(object.name as string);
    if (!family?.byKey) return undefined;
    const property = expression.property as AstNode | undefined;
    if (!property) return undefined;
    const key =
      property.type === 'Identifier' && expression.computed !== true
        ? (property.name as string)
        : property.type === 'Literal' && typeof property.value === 'string'
          ? property.value
          : undefined;
    if (key === undefined) return undefined;
    const value = family.byKey.get(key);
    return value === undefined ? undefined : [value];
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Test-side collection
// ---------------------------------------------------------------------------

/**
 * Parse every { type: 'testId', value: ... } strategy object from test files.
 *
 * Identifier values resolve through same-file `const` declarations: a locator
 * built from a computed id would otherwise read as absent and go unwatched.
 */
export function collectTestTestids(dirs: string[]): {
  statics: TestidOccurrence[];
  dynamics: TestidOccurrence[];
} {
  const statics: TestidOccurrence[] = [];
  const dynamics: TestidOccurrence[] = [];

  for (const dir of dirs) {
    for (const filePath of findFiles(dir, ['.ts', '.tsx'])) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(process.cwd(), filePath);
      const ast = parseFile(relPath, content);

      const staticMembers = collectStaticMembers(ast);
      const constants = collectStringConstants(ast);

      const addStatic = (value: string, node: AstNode): void => {
        statics.push({ value, file: relPath, line: lineOf(node) });
      };
      const addDynamic = (value: string, node: AstNode): void => {
        dynamics.push({ value, file: relPath, line: lineOf(node) });
      };

      walkScoped(ast, new Map(), staticMembers, (node, bindings) => {
        if (node.type !== 'ObjectExpression') return;
        const properties = (node.properties as unknown[]).filter(isNode);
        const typeProperty = properties.find((p) => memberName(p) === 'type');
        const valueProperty = properties.find((p) => memberName(p) === 'value');
        if (!typeProperty || !valueProperty) return;

        const strategy = typeProperty.value as AstNode | undefined;
        if (strategy?.type !== 'Literal' || strategy.value !== 'testId') return;

        harvestTestidExpression(
          valueProperty.value,
          bindings,
          staticMembers,
          addStatic,
          addDynamic,
          constants,
        );
      });
    }
  }

  return { statics, dynamics };
}

/** Every `const X = 'literal'` in a file, for resolving identifier references. */
function collectStringConstants(ast: AstNode): Map<string, string> {
  const constants = new Map<string, string>();
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    const id = node.id as AstNode | undefined;
    const init = unwrapTypeExpression(node.init);
    if (id?.type === 'Identifier' && init?.type === 'Literal' && typeof init.value === 'string') {
      constants.set(id.name as string, init.value);
    }
  });
  return constants;
}

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

/**
 * Whether a value matches any dynamic pattern.
 *
 * Only `prefix*` matches. A leading interpolation leaves nothing but a common
 * tail — `-select`, `-link` — and matching on that would absolve every dead id
 * sharing it, a far wider hole than the one such a rule closes.
 */
export function matchesAnyPattern(value: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith('*')) continue;
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    if (prefix && value.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * A test-referenced testid is considered "matched" if:
 *   - It exactly equals a static app testid, OR
 *   - It matches a dynamic app pattern
 *     (e.g. test value "contact-link-abc123" matches app dynamic "contact-link-*")
 */
export function isMatchedByApp(
  testValue: string,
  appStaticValues: Set<string>,
  appDynamicPrefixes: string[],
): boolean {
  if (appStaticValues.has(testValue)) return true;
  return matchesAnyPattern(testValue, appDynamicPrefixes);
}

/**
 * A static app testid is "exercised" if:
 *   - It exactly equals a static test-referenced testid, OR
 *   - It matches a dynamic test-referenced pattern
 *     (e.g. app value "contact-link-abc" matched by test dynamic "contact-link-*")
 */
export function isExercised(
  appValue: string,
  testStaticValues: Set<string>,
  testDynamicPrefixes: string[],
): boolean {
  if (testStaticValues.has(appValue)) return true;
  return matchesAnyPattern(appValue, testDynamicPrefixes);
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(params: {
  stale: TestidOccurrence[];
  unexercised: TestidOccurrence[];
  appDynamics: TestidOccurrence[];
  testDynamics: TestidOccurrence[];
  matchedCount: number;
  timestamp: string;
}): string {
  const { stale, unexercised, appDynamics, testDynamics, matchedCount, timestamp } = params;

  const allDynamics: Array<TestidOccurrence & { source: 'app' | 'test' }> = [
    ...appDynamics.map((d) => ({ ...d, source: 'app' as const })),
    ...testDynamics.map((d) => ({ ...d, source: 'test' as const })),
  ];

  const lines: string[] = [
    '# data-testid Audit Report',
    `Generated: ${timestamp}`,
    '',
    '## Summary',
    `- Matched: ${matchedCount}`,
    `- Stale (broken locators): ${stale.length}`,
    `- Unexercised (in app, not in tests): ${unexercised.length}`,
    `- Dynamic (manual review required): ${allDynamics.length}`,
    '',
  ];

  lines.push('## Stale testids (action required)');
  if (stale.length === 0) {
    lines.push('_None — all test-referenced testids are present in the application source._');
  } else {
    lines.push('| testid | Test file | Line |');
    lines.push('|--------|-----------|------|');
    for (const s of stale) {
      lines.push(`| \`${s.value}\` | ${s.file} | ${s.line} |`);
    }
  }
  lines.push('');

  lines.push('## Unexercised testids (review required)');
  if (unexercised.length === 0) {
    lines.push('_None — all static application testids are referenced by at least one test._');
  } else {
    lines.push('| testid | App file | Line |');
    lines.push('|--------|----------|------|');
    for (const u of unexercised) {
      lines.push(`| \`${u.value}\` | ${u.file} | ${u.line} |`);
    }
  }
  lines.push('');

  lines.push('## Dynamic testids (manual review)');
  if (allDynamics.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| pattern | File | Line | Source |');
    lines.push('|---------|------|------|--------|');
    for (const d of allDynamics) {
      lines.push(`| \`${d.value}\` | ${d.file} | ${d.line} | ${d.source} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function run(): void {
  const repoRoot = path.resolve(process.cwd());

  const appSrcDir = path.join(repoRoot, 'client', 'src');
  const testDirs = [
    path.join(repoRoot, 'qa', 'e2e', 'pages', 'minicrm'),
    path.join(repoRoot, 'qa', 'e2e', 'behaviors', 'minicrm'),
    path.join(repoRoot, 'qa', 'e2e', 'tests', 'apps'),
  ];

  const { statics: appStatics, dynamics: appDynamics } = collectAppTestids(appSrcDir);
  const { statics: testStatics, dynamics: testDynamics } = collectTestTestids(testDirs);

  const appStaticValues = new Set(appStatics.map((s) => s.value));
  const appDynamicPrefixes = appDynamics.map((d) => d.value);

  const testStaticValues = new Set(testStatics.map((s) => s.value));
  const testDynamicPrefixes = testDynamics.map((d) => d.value);

  // Stale: test-referenced static testids not present in app source (static or dynamic).
  const stale = testStatics.filter(
    (t) => !isMatchedByApp(t.value, appStaticValues, appDynamicPrefixes),
  );

  // Unexercised: app static testids not referenced in test code (static or dynamic).
  const unexercised = appStatics.filter(
    (a) => !isExercised(a.value, testStaticValues, testDynamicPrefixes),
  );

  // Matched count: test statics that ARE matched.
  const matchedCount = testStatics.length - stale.length;

  const timestamp = new Date().toISOString();

  const reportContent = generateReport({
    stale,
    unexercised,
    appDynamics,
    testDynamics,
    matchedCount,
    timestamp,
  });

  const reportPath = path.join(repoRoot, 'qa', 'scripts', 'audit-testids-report.md');
  fs.writeFileSync(reportPath, reportContent, 'utf-8');

  // Print summary to stdout.
  const summaryLines = [
    '',
    '=== data-testid Audit Summary ===',
    `Matched:                       ${matchedCount}`,
    `Stale (broken locators):       ${stale.length}`,
    `Unexercised (app, not tested): ${unexercised.length}`,
    `Dynamic (manual review):       ${appDynamics.length + testDynamics.length}`,
    '',
    `Full report written to: ${path.relative(repoRoot, reportPath)}`,
    '',
  ];

  if (stale.length > 0) {
    summaryLines.push('STALE testids found (action required):');
    for (const s of stale) {
      summaryLines.push(`  [STALE] "${s.value}" at ${s.file}:${s.line}`);
    }
    summaryLines.push('');
  }

  console.log(summaryLines.join('\n'));

  if (stale.length > 0) {
    process.exit(1);
  }
}

const scriptPath = process.argv[1] ?? '';
if (scriptPath.endsWith('audit-testids.ts') || scriptPath.endsWith('audit-testids.js')) {
  run();
}
