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
 *   tsx qa/scripts/check-testids.ts            regenerate the tracked report
 *   tsx qa/scripts/check-testids.ts --check    verify it without writing
 *   tsx qa/scripts/check-testids.ts --self-test
 *
 * Exit codes:
 *   0 — no stale testids found (unexercised testids are informational only)
 *   1 — a stale testid, or under --check a report that no longer matches
 */

import fs from 'node:fs';
import os from 'node:os';
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
  /** For an array of object literals: each property name's values across rows. */
  objectKeys?: Map<string, string[]>;
}

/** Declaring file → component → testid prop → the literals its call sites pass. */
type CorpusCallSites = Map<string, Map<string, Map<string, Set<string> | undefined>>>;

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
  componentProps: Map<string, Map<string, string[]>>,
  visit: (node: AstNode, bindings: Map<string, string[]>) => void,
): void {
  if (Array.isArray(node)) {
    for (const child of node) walkScoped(child, bindings, staticMembers, componentProps, visit);
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  let scope = bindings;
  if (isNode(node)) {
    visit(node, bindings);
    const bound = mapCallbackBinding(node, staticMembers);
    if (bound) scope = new Map([...bindings, ...bound]);
    // A component's own body sees the testids ITS call sites pass. Two
    // components in one file both destructure `testId`, so a flat binding
    // would give each the other's ids.
    const declared =
      node.type === 'FunctionDeclaration' && isNode(node.id)
        ? componentProps.get(node.id.name as string)
        : undefined;
    if (declared) scope = new Map([...scope, ...declared]);
  }

  for (const [key, child] of Object.entries(node)) {
    if (key === 'parent') continue;
    walkScoped(child, scope, staticMembers, componentProps, visit);
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

/**
 * A floor under the app scan. Well below today's count, high enough that a
 * scan which found essentially nothing cannot pass as a clean report.
 */
const MINIMUM_EXPECTED_STATICS = 1000;

/** Whether a scan found so little that reporting on it would be dishonest. */
export function isCorpusTooSmall(staticCount: number): boolean {
  return staticCount < MINIMUM_EXPECTED_STATICS;
}

/** Unit-test sources, which render testids that are not part of the app. */
function isUnitTestFile(filePath: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(filePath) || filePath.includes(`${path.sep}__tests__${path.sep}`)
  );
}

// ---------------------------------------------------------------------------
// Application-side collection
// ---------------------------------------------------------------------------

/** Attribute and property names whose value IS a testid. */
const TESTID_VALUE_NAMES = new Set(['data-testid', 'testId']);

/**
 * Props whose value is a stem the receiving component appends to, expanded into the
 * concrete ids that component renders.
 *
 * Only names `harvestPrefixProp` can expand belong here; it refuses any other. Emitting
 * a `prefix-*` dynamic instead would absolve every dead id sharing that stem — the
 * fail-open this audit exists to report.
 *
 * `itemTestidPrefix` is absent for that reason. Every SubPageNav call site supplies a
 * per-item `data-testid`, which takes precedence over the prefix template, so its ids are
 * enumerated from the call site's own `.map()` and the prefix added only the fail-open.
 * A future call site passing ONLY the prefix would render ids this cannot see and its
 * locators would be reported stale — resolving that needs the `items` array enumerated,
 * which no call site makes possible today.
 *
 * `panelTestidPrefix` is absent too — despite the name it feeds `aria-controls`.
 */
const TESTID_PREFIX_NAMES = new Set(['testIdPrefix']);
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
export function collectAppTestids(
  srcDir: string,
  repoRoot: string = process.cwd(),
): {
  statics: TestidOccurrence[];
  dynamics: TestidOccurrence[];
} {
  const statics: TestidOccurrence[] = [];
  const dynamics: TestidOccurrence[] = [];

  // Absolute: the corpus index is keyed by what `resolveImport` returns, always absolute.
  const appFiles = findFiles(srcDir, ['.tsx', '.ts'])
    .filter((f) => !isUnitTestFile(f))
    .map((f) => path.resolve(f));

  // Shared across both passes: every file is walked twice and parsing dominates.
  const astCache = new Map<string, AstNode>();
  const astOf = (filePath: string): AstNode => {
    let ast = astCache.get(filePath);
    if (!ast) {
      ast = parseFile(path.relative(repoRoot, filePath), fs.readFileSync(filePath, 'utf-8'));
      astCache.set(filePath, ast);
    }
    return ast;
  };

  // Survives the whole scan: an imported family is otherwise recollected once per
  // importing file, and the nav families have many.
  const familyCache = new Map<string, Map<string, StaticFamily>>();

  const corpusCallSites = collectCorpusCallSites(appFiles, path.resolve(srcDir), astOf);

  for (const filePath of appFiles) {
    const relPath = path.relative(repoRoot, filePath);
    const ast = astOf(filePath);

    const staticMembers = collectStaticMembers(ast);
    for (const [name, family] of collectImportedFamilies(
      ast,
      filePath,
      path.resolve(srcDir),
      astOf,
      familyCache,
    )) {
      if (!staticMembers.has(name)) staticMembers.set(name, family);
    }

    const addStatic = (value: string, node: AstNode): void => {
      statics.push({ value, file: relPath, line: lineOf(node) });
    };
    const addDynamic = (value: string, node: AstNode): void => {
      dynamics.push({ value, file: relPath, line: lineOf(node) });
    };

    const componentProps = componentPropsWithCorpus(ast, filePath, corpusCallSites);

    walkScoped(ast, new Map(), staticMembers, componentProps, (node, bindings) => {
      if (node.type === 'JSXAttribute') {
        const name = memberName(node);
        if (!name) return;
        if (TESTID_VALUE_NAMES.has(name)) {
          harvestTestidExpression(node.value, bindings, staticMembers, addStatic, addDynamic);
        } else if (TESTID_PREFIX_NAMES.has(name)) {
          harvestPrefixProp(name, node.value, addStatic);
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
): void {
  // Concrete ids only. A prefix whose suffixes are not known cannot be expanded, and
  // emitting `prefix-*` instead would absolve every dead id sharing that stem — so an
  // unrecognized name is refused rather than guessed at.
  if (propName !== 'testIdPrefix') {
    throw new Error(
      `${propName} is in TESTID_PREFIX_NAMES but harvestPrefixProp cannot expand it. ` +
        'Add its suffixes here, or leave the prop out of the set — outside it the ' +
        'attribute is not read at all, which is safe but records nothing.',
    );
  }
  const literal = jsxAttributeLiteral(value);
  if (!literal) return;
  for (const suffix of OWNER_TOGGLE_SUFFIXES) addStatic(`${literal.value}${suffix}`, literal.node);
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
        return;
      }

      const rows = elements.filter((e) => e.type === 'ObjectExpression');
      if (rows.length === elements.length && rows.length > 0) {
        const objectKeys = new Map<string, string[]>();
        for (const row of rows) {
          for (const property of (row.properties as unknown[]).filter(isNode)) {
            const key = memberName(property);
            const value = unwrapTypeExpression(property.value);
            if (!key || value?.type !== 'Literal' || typeof value.value !== 'string') continue;
            objectKeys.set(key, [...(objectKeys.get(key) ?? []), value.value]);
          }
        }
        if (objectKeys.size > 0) families.set(id.name as string, { members: [], objectKeys });
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
 * Each locally-declared component's testid parameter, bound to the literals its
 * own call sites in THIS file pass — `StatCard` derives `${testId}-link`.
 *
 * Keyed by component, not by parameter name: `testId` is the prop name several
 * components share, so two declared in one file would otherwise each inherit the
 * other's ids.
 */
function collectLocalComponentProps(ast: AstNode): Map<string, Map<string, string[] | undefined>> {
  const declared = new Set<string>();
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && isNode(node.id))
      declared.add(node.id.name as string);
  });
  if (declared.size === 0) return new Map();

  // Keyed by prop as well as component: a call site passing `testId` must not feed a
  // parameter destructured from `data-testid`, whose template the app never renders.
  const callSiteValues = new Map<string, Map<string, Set<string> | undefined>>();
  forEachTestidCallSite(
    ast,
    (name) => declared.has(name),
    (name, propName, value) => {
      const byProp = callSiteValues.get(name) ?? new Map<string, Set<string> | undefined>();
      // undefined marks the pair unresolvable, and no later literal restores it.
      const values = byProp.has(propName) ? byProp.get(propName) : new Set<string>();
      if (value === undefined) byProp.set(propName, undefined);
      else if (values) {
        values.add(value);
        byProp.set(propName, values);
      }
      callSiteValues.set(name, byProp);
    },
  );

  const byComponent = new Map<string, Map<string, string[] | undefined>>();
  forEachTestidParam(ast, (componentName, propName, boundAs, defaultValue) => {
    const byProp = callSiteValues.get(componentName);
    if (!byProp?.has(propName)) return;
    const values = byProp.get(propName);
    const bindings = byComponent.get(componentName) ?? new Map<string, string[] | undefined>();
    // undefined rather than absent: a caller this could not read must poison the pair,
    // and "no same-file caller" has to stay distinguishable from "one I cannot resolve".
    bindings.set(boundAs, values && [...values, ...(defaultValue ? [defaultValue] : [])]);
    byComponent.set(componentName, bindings);
  });
  return byComponent;
}

/**
 * Every literal testid value a JSX call site passes, for the elements `isTarget` accepts.
 *
 * Shared by the same-file and cross-file indexes: a spread attribute or a new testid
 * prop name handled on only one of them resolves an id from one kind of call site but
 * not the other, which reads as a missing testid rather than as a bug.
 */
function forEachTestidCallSite(
  ast: AstNode,
  isTarget: (elementName: string) => boolean,
  visit: (elementName: string, propName: string, value: string | undefined) => void,
): void {
  walk(ast, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    const name = isNode(node.name) ? (node.name.name as string) : undefined;
    if (!name || !isTarget(name)) return;
    for (const attribute of (node.attributes as unknown[]).filter(isNode)) {
      // A spread can carry any testid prop and its value is unreadable here, so it
      // poisons them all — binding only what the literal call sites pass would resolve
      // an incomplete set whose missing ids are then reported stale.
      if (attribute.type === 'JSXSpreadAttribute') {
        for (const propName of TESTID_VALUE_NAMES) visit(name, propName, undefined);
        continue;
      }
      if (attribute.type !== 'JSXAttribute') continue;
      const propName = memberName(attribute);
      if (!propName || !TESTID_VALUE_NAMES.has(propName)) continue;
      // A non-literal reaches `visit` as undefined rather than being skipped: a caller
      // that binds only the literals resolves an incomplete set, and the ids it misses
      // are reported stale though the app renders them.
      visit(name, propName, jsxAttributeLiteral(attribute.value)?.value);
    }
  });
}

/**
 * Every testid-valued parameter each declared component destructures, with the name it
 * binds to. Shared by both binders for the reason `forEachTestidCallSite` gives.
 *
 * Only `FunctionDeclaration` components are read; an arrow-function component stays a
 * dynamic, which fails closed rather than open.
 */
function forEachTestidParam(
  ast: AstNode,
  visit: (
    componentName: string,
    propName: string,
    boundAs: string,
    defaultValue: string | undefined,
  ) => void,
): void {
  walk(ast, (node) => {
    if (node.type !== 'FunctionDeclaration' || !isNode(node.id)) return;
    const componentName = node.id.name as string;
    for (const param of (node.params as unknown[]).filter(isNode)) {
      if (param.type !== 'ObjectPattern') continue;
      for (const property of (param.properties as unknown[]).filter(isNode)) {
        const propName = memberName(property);
        if (!propName || !TESTID_VALUE_NAMES.has(propName)) continue;
        visit(
          componentName,
          propName,
          destructuredLocalName(property) ?? propName,
          // A caller omitting the prop renders the default, so it is a real id.
          destructuredDefault(property),
        );
      }
    }
  });
}

/** The literal a destructured property falls back to — `{ id = 'contact-selector' }`. */
function destructuredDefault(property: AstNode): string | undefined {
  const value = property.value as AstNode | undefined;
  if (value?.type !== 'AssignmentPattern') return undefined;
  const right = value.right as AstNode | undefined;
  return right?.type === 'Literal' && typeof right.value === 'string' ? right.value : undefined;
}

/**
 * The name a destructured property binds to — `'data-testid': listTestId` binds
 * `listTestId`, which is what the component body interpolates.
 */
function destructuredLocalName(property: AstNode): string | undefined {
  const value = property.value as AstNode | undefined;
  if (value?.type === 'Identifier') return value.name as string;
  // A default (`id = 'x'`) wraps the binding one level deeper.
  if (value?.type === 'AssignmentPattern' && isNode(value.left) && value.left.type === 'Identifier')
    return value.left.name as string;
  return undefined;
}

/**
 * Every testid literal each component receives, from call sites in ANY file.
 *
 * A component holds no reference to its own call sites, so this cannot follow an import
 * the way `collectImportedFamilies` does — it indexes the whole corpus once, keyed by the
 * file that declares the component. Without it a testid built from a prop bound in
 * another file (`SubPageNav`'s `${listTestId}-select`) degrades to a pattern matching
 * nothing, and its family's dead siblings go unreported.
 *
 * Keyed by declaring file as well as component name: `testId` is a prop name many
 * components share, and two same-named components in different files would otherwise
 * feed each other's suffixes.
 *
 * One edge deep, like `collectImportedFamilies`: a call site importing through a
 * re-export barrel indexes against the barrel, so the declaring component never sees it
 * and its template stays dynamic. No barrel exists in `client/src`.
 */
function collectCorpusCallSites(
  files: string[],
  srcDir: string,
  astOf: (filePath: string) => AstNode,
): CorpusCallSites {
  const byDeclaringFile: CorpusCallSites = new Map();

  for (const filePath of files) {
    const ast = astOf(filePath);

    // Where each locally-visible name was imported from. Only imports are indexed:
    // a same-file call site is already `collectLocalComponentProps`'s job. The caller
    // has already dropped unit-test files, so their call sites never reach here.
    // `import { Twin as First }` renders as First here and is declared as Twin there.
    const importedFrom = new Map<string, { file: string; declaredAs: string }>();
    walk(ast, (node) => {
      if (node.type !== 'ImportDeclaration') return;
      const source = node.source as AstNode | undefined;
      const specifier = typeof source?.value === 'string' ? source.value : undefined;
      if (!specifier) return;
      const resolved = resolveImport(filePath, specifier, srcDir);
      if (!resolved) return;
      for (const spec of (node.specifiers as unknown[]).filter(isNode)) {
        if (spec.type !== 'ImportSpecifier' && spec.type !== 'ImportDefaultSpecifier') continue;
        if (!isNode(spec.local)) continue;
        const local = spec.local.name as string;
        const declaredAs =
          spec.type === 'ImportSpecifier' && isNode(spec.imported)
            ? (spec.imported.name as string)
            : local;
        importedFrom.set(local, { file: resolved, declaredAs });
      }
    });
    if (importedFrom.size === 0) continue;

    forEachTestidCallSite(
      ast,
      (name) => importedFrom.has(name),
      (name, propName, value) => {
        const source = importedFrom.get(name);
        if (!source) return;
        const byComponent =
          byDeclaringFile.get(source.file) ??
          new Map<string, Map<string, Set<string> | undefined>>();
        const byProp =
          byComponent.get(source.declaredAs) ?? new Map<string, Set<string> | undefined>();
        const values = byProp.has(propName) ? byProp.get(propName) : new Set<string>();
        if (value === undefined) byProp.set(propName, undefined);
        else if (values) {
          values.add(value);
          byProp.set(propName, values);
        }
        byComponent.set(source.declaredAs, byProp);
        byDeclaringFile.set(source.file, byComponent);
      },
    );
  }

  return byDeclaringFile;
}

/**
 * The corpus's call-site values for the components one file declares, bound to the names
 * that file's parameter lists destructure them under.
 *
 * Unioned with the same-file bindings rather than overriding them: a component called
 * both from its own file and from another has ids from both, and letting either win
 * silently drops the other's.
 */
function componentPropsWithCorpus(
  ast: AstNode,
  filePath: string,
  corpus: CorpusCallSites,
): Map<string, Map<string, string[]>> {
  const local = collectLocalComponentProps(ast);
  const external = corpus.get(filePath);

  // Poisoned in EITHER direction wins: a pair one index could not read is unresolvable
  // however well the other read it, and binding the readable half resolves a subset —
  // whose missing siblings are then reported stale though the app renders them.
  const merged = new Map(local);
  if (external) {
    forEachTestidParam(ast, (componentName, propName, boundAs, defaultValue) => {
      const byProp = external.get(componentName);
      if (!byProp?.has(propName)) return;
      const values = byProp.get(propName);
      const bindings = merged.get(componentName) ?? new Map<string, string[] | undefined>();
      const existing = bindings.has(boundAs) ? bindings.get(boundAs) : undefined;
      if (!values || (bindings.has(boundAs) && existing === undefined)) {
        bindings.set(boundAs, undefined);
      } else {
        const withDefault = defaultValue ? [defaultValue] : [];
        bindings.set(boundAs, [...new Set([...(existing ?? []), ...values, ...withDefault])]);
      }
      merged.set(componentName, bindings);
    });
  }

  // Drop the poisoned pairs at the boundary: the walk binds names to id lists, and an
  // absent binding is what leaves the template dynamic.
  const resolved = new Map<string, Map<string, string[]>>();
  for (const [componentName, bindings] of merged) {
    const kept = new Map<string, string[]>();
    for (const [boundAs, values] of bindings) if (values) kept.set(boundAs, values);
    if (kept.size > 0) resolved.set(componentName, kept);
  }
  return resolved;
}

/**
 * Constant families a file imports, by relative path or through the scan-root alias.
 *
 * One edge deep, no transitive resolution. The nav families are the reason:
 * `DESTINATION_NAME` lives in `navLinks.ts` and is what every `nav-*` testid
 * interpolates, so without following that edge the whole family stays a
 * permissive prefix that any dead sibling matches.
 */
function collectImportedFamilies(
  ast: AstNode,
  filePath: string,
  srcDir: string,
  astOf: (filePath: string) => AstNode,
  familyCache: Map<string, Map<string, StaticFamily>>,
): Map<string, StaticFamily> {
  const imported = new Map<string, StaticFamily>();

  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') return;
    const source = node.source as AstNode | undefined;
    const specifier = typeof source?.value === 'string' ? source.value : undefined;
    if (!specifier) return;

    // Look up by the exported name, bind under the local one: `import { F as L }`
    // is declared as F over there and interpolated as L here.
    const names = (node.specifiers as unknown[])
      .filter(isNode)
      .filter((s) => s.type === 'ImportSpecifier')
      .map((s) => {
        const exported = isNode(s.imported) ? (s.imported.name as string) : undefined;
        const local = isNode(s.local) ? (s.local.name as string) : exported;
        return exported === undefined ? undefined : { exported, local: local ?? exported };
      })
      .filter((entry): entry is { exported: string; local: string } => entry !== undefined);
    if (names.length === 0) return;

    const resolved = resolveImport(filePath, specifier, srcDir);
    if (!resolved || isUnitTestFile(resolved)) return;

    let families = familyCache.get(resolved);
    if (!families) {
      families = collectStaticMembers(astOf(resolved));
      familyCache.set(resolved, families);
    }
    for (const { exported, local } of names) {
      const family = families.get(exported);
      if (family) imported.set(local, family);
    }
  });

  return imported;
}

/**
 * The alias `client/tsconfig.json` maps onto the directory this scan was handed.
 *
 * Rewritten against the scan root rather than read from tsconfig: `@/*` resolves to
 * `./src/*`, which IS that root, so deriving it costs the guard no dependency on a file
 * no CI filter would trigger it on. `@shared/*` points outside the scanned corpus and
 * stays unresolved, so anything reaching it remains dynamic.
 *
 * A rename in client/tsconfig.json is caught because every `@/` import resolves under
 * client/src, which the testid-audit CI filter matches — not by the tsconfig itself,
 * which only the dockerfiles filter sees.
 */
const SCAN_ROOT_ALIAS = '@/';

/**
 * The file an import specifier names, rewriting the repo's `.js` suffix.
 *
 * Both forms matter: the components this resolves are imported relatively in some files
 * and through the alias in others, and reading only one leaves the other's callers
 * invisible — a family that degrades to a permissive prefix absolving dead siblings.
 */
function resolveImport(fromFile: string, specifier: string, srcDir: string): string | undefined {
  const withoutSuffix = specifier.replace(/\.js$/, '');
  let base: string;
  if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), withoutSuffix);
  } else if (specifier.startsWith(SCAN_ROOT_ALIAS)) {
    base = path.resolve(srcDir, withoutSuffix.slice(SCAN_ROOT_ALIAS.length));
  } else {
    return undefined;
  }
  for (const candidate of [`${base}.ts`, `${base}.tsx`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
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

  // A leading interpolation carries no prefix, and its tail — `-select`, `-link`
  // — is shared by unrelated ids, so matching on it would absolve every dead id
  // ending the same way. Recorded for the report's manual-review list, where it
  // matches nothing. What reaches here is a testid built from a prop whose name is
  // outside TESTID_VALUE_NAMES, so no call-site value is ever bound to it.
  addDynamic(`*${quasis.map(text).join('*')}`, template);
}

/**
 * The keys an index expression can select — `link.to`, where `link` iterates an
 * array of objects, resolves to every `to` value in that array.
 *
 * Without this the audit would have to assume an index reaches every row of the
 * map it indexes, which mints ids for rows nothing selects.
 */
function indexKeys(
  property: unknown,
  staticMembers: Map<string, StaticFamily>,
): string[] | undefined {
  if (!isNode(property) || property.type !== 'MemberExpression') return undefined;
  const propertyName = isNode(property.property) ? (property.property.name as string) : undefined;
  if (!propertyName) return undefined;
  for (const family of staticMembers.values()) {
    const keys = family.objectKeys?.get(propertyName);
    if (keys) return keys;
  }
  return undefined;
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
    // A computed key: `DESTINATION_NAME[link.to]`. Enumerate only the entries
    // the index can actually select. Taking the whole family instead would mint
    // ids for rows nothing reaches — DESTINATION_NAME has an /activities row,
    // NAV_LINKS has no /activities link — and each would absolve a dead locator.
    if (key === undefined) {
      if (expression.computed !== true) return undefined;
      const selectable = indexKeys(expression.property, staticMembers);
      if (!selectable) return undefined;
      const reachable = selectable
        .map((k) => family.byKey?.get(k))
        .filter((value): value is string => value !== undefined);
      return reachable.length > 0 ? reachable : undefined;
    }
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
export function collectTestTestids(
  dirs: string[],
  repoRoot: string = process.cwd(),
): {
  statics: TestidOccurrence[];
  dynamics: TestidOccurrence[];
} {
  const statics: TestidOccurrence[] = [];
  const dynamics: TestidOccurrence[] = [];

  for (const dir of dirs) {
    for (const filePath of findFiles(dir, ['.ts', '.tsx'])) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(repoRoot, filePath);
      const ast = parseFile(relPath, content);

      const staticMembers = collectStaticMembers(ast);
      const constants = collectStringConstants(ast);

      const addStatic = (value: string, node: AstNode): void => {
        statics.push({ value, file: relPath, line: lineOf(node) });
      };
      const addDynamic = (value: string, node: AstNode): void => {
        dynamics.push({ value, file: relPath, line: lineOf(node) });
      };

      walkScoped(ast, new Map(), staticMembers, new Map(), (node, bindings) => {
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
 * Only a leading prefix matches. A pattern recorded for a leading interpolation
 * begins with `*`, which no testid does, so it matches nothing by construction —
 * see harvestTemplateLiteral for why it is recorded rather than resolved.
 */
export function matchesAnyPattern(value: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
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
    '',
    `Generated: ${timestamp}`,
    '',
    '## Summary',
    '',
    `- Matched: ${matchedCount}`,
    `- Stale (broken locators): ${stale.length}`,
    `- Unexercised (in app, not in tests): ${unexercised.length}`,
    `- Dynamic (manual review required): ${allDynamics.length}`,
    '',
  ];

  lines.push('## Stale testids (action required)', '');
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

  lines.push('## Unexercised testids (review required)', '');
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

  lines.push('## Dynamic testids (manual review)', '');
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

export function run(checkOnly = false): void {
  // From this script's own path, not cwd: the same derivation the self-test
  // uses, so running from qa/ cannot scan nothing and call it clean.
  const repoRoot = path.resolve(path.dirname(process.argv[1] ?? ''), '..', '..');

  const appSrcDir = path.join(repoRoot, 'client', 'src');
  const testDirs = [
    path.join(repoRoot, 'qa', 'e2e', 'pages', 'minicrm'),
    path.join(repoRoot, 'qa', 'e2e', 'behaviors', 'minicrm'),
    path.join(repoRoot, 'qa', 'e2e', 'tests', 'apps'),
  ];

  const { statics: appStatics, dynamics: appDynamics } = collectAppTestids(appSrcDir, repoRoot);
  // An empty scan reports Stale: 0 — this guard's silent-failure mode, and how
  // it lost sight of the app before. Refuse rather than certify nothing.
  if (isCorpusTooSmall(appStatics.length)) {
    console.error(
      `Scanned ${appSrcDir} and found only ${appStatics.length} testids; expected at least ` +
        `${MINIMUM_EXPECTED_STATICS}. Refusing to report on a corpus this small.`,
    );
    process.exit(1);
  }
  const { statics: testStatics, dynamics: testDynamics } = collectTestTestids(testDirs, repoRoot);

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
  let reportStatus: string;
  if (checkOnly) {
    reportStatus = compareReport(reportPath, reportContent);
  } else {
    fs.writeFileSync(reportPath, reportContent, 'utf-8');
    reportStatus = `Full report written to: ${path.relative(repoRoot, reportPath)}`;
  }

  // Print summary to stdout.
  const summaryLines = [
    '',
    '=== data-testid Audit Summary ===',
    `Matched:                       ${matchedCount}`,
    `Stale (broken locators):       ${stale.length}`,
    `Unexercised (app, not tested): ${unexercised.length}`,
    `Dynamic (manual review):       ${appDynamics.length + testDynamics.length}`,
    '',
    reportStatus,
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

  if (stale.length > 0 || reportStatus.startsWith(REPORT_DRIFT_PREFIX)) {
    process.exit(1);
  }
}

const REPORT_DRIFT_PREFIX = 'Report is out of date';

/**
 * Compare the part of the report that a broken locator changes.
 *
 * Only the summary counts and the stale list are gated. The unexercised and
 * dynamic tables carry source line numbers, so comparing them would fail every
 * time a line moved anywhere in client/src — a red build reading `Stale: 0`
 * with nothing broken, which is how a check earns its way into being switched
 * off. Prettier pads table separators, so those are normalized too.
 */
function compareReport(reportPath: string, expected: string): string {
  let actual: string;
  try {
    actual = fs.readFileSync(reportPath, 'utf-8');
  } catch {
    return `${REPORT_DRIFT_PREFIX}: ${reportPath} is missing. Run: npm run audit:testids`;
  }

  const gated = (text: string): string[] => {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line.startsWith('## Stale testids'));
    const end = lines.findIndex((line) => line.startsWith('## Unexercised'));
    const staleSection = start === -1 ? [] : lines.slice(start, end === -1 ? undefined : end);
    const counts = lines.filter(
      (line) => line.startsWith('- Matched:') || line.startsWith('- Stale'),
    );
    return [...counts, ...staleSection]
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .map((line) => (/^\|[\s|:-]+\|$/.test(line) ? '|---|' : line))
      .filter((line) => line.length > 0);
  };

  const trackedLines = gated(actual);
  const freshLines = gated(expected);
  if (trackedLines.join('\n') === freshLines.join('\n')) {
    return 'Report matches the tracked file.';
  }

  // Name what drifted: otherwise the only way to find out is to regenerate a
  // 1,700-line file and diff it by hand.
  const differences: string[] = [];
  for (let i = 0; i < Math.max(trackedLines.length, freshLines.length); i++) {
    if (trackedLines[i] === freshLines[i]) continue;
    differences.push(`  tracked: ${trackedLines[i] ?? '(absent)'}`);
    differences.push(`  actual:  ${freshLines[i] ?? '(absent)'}`);
    if (differences.length >= 6) break;
  }
  return [`${REPORT_DRIFT_PREFIX}. Run: npm run audit:testids`, ...differences].join('\n');
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * Every form this extractor must see, and the ones it must refuse to invent.
 *
 * Cases assert finding COUNTS. A guard checked only on exit status passes just
 * as happily against a corpus it never read, which is the failure this audit
 * itself shipped with for four months.
 */
const SELF_TEST_APP_SOURCE = `
const TAB_KEYS = ['alpha', 'beta'];
const VIEWS = ['win-loss', 'activity'] as const;
const LABELS = { primary: 'main', secondary: 'aux' };
const SIZES = ['sm', 'lg'];
const shadowed = ['overview', 'settings'];

import { DESTINATIONS, ROUTES, ALIASED as RENAMED, OPAQUE } from './destinations.js';
import AliasNav from '@/aliased-nav.js';
import { RelativeCard } from './relative-card.js';
import { ALIAS_FAMILY } from '@/alias-family.js';

function MixedProps({ testId, 'data-testid': dt }: { testId?: string; 'data-testid'?: string }) {
  return <div><span data-testid={\`\${testId}-a\`} /><em data-testid={\`\${dt}-b\`} /></div>;
}

function LocalCard({ testId }: { testId: string }) {
  return <div data-testid={\`\${testId}-derived\`} />;
}

function OtherCard({ testId }: { testId: string }) {
  return <div data-testid={\`\${testId}-other\`} />;
}

export function Fixture({
  testId,
  readOnly,
  tab,
  route,
  shadowed,
}: {
  testId: string;
  readOnly: boolean;
  tab: string;
  route: string;
  shadowed: string;
}) {
  const navItems = TAB_KEYS.map((tab) => ({ 'data-testid': \`settings-tab-\${tab}\` }));
  const viewItems = VIEWS.map((view) => ({ 'data-testid': \`reports-tab-\${view}\` }));
  return (
    <div>
      <span data-testid="plain-static" />
      <span data-testid={'braced-static'} />
      <ExportMenu testId="forwarded-prop" />
      <StatCard testId={testId} />
      <OwnerToggle testIdPrefix="owner-filter" />
      {/* Still rendered: the dead-sibling case is only meaningful while a real prefix
          prop exists in the source and no longer absolves its family. */}
      <SubNav itemTestidPrefix="item-prefix" />
      <input
        data-testid={
          readOnly
            ? 'multiline-ternary-readonly'
            : 'multiline-ternary-editable'
        }
      />
      <em data-testid={\`member-\${LABELS.primary}\`} />
      <b data-testid={\`len-\${SIZES.length}\`} />
      <i data-testid={\`\${testId}-suffix-only\`} />
      <u data-testid="resolved-from-const" />
      <s data-testid={\`after-map-\${tab}\`} />
      <h1 data-testid={\`shadowed-\${shadowed}\`} />
      {ROUTES.map((link) => (
        <p data-testid={\`nav-\${DESTINATIONS[link.to]}\`} />
      ))}
      <q data-testid={\`alias-\${RENAMED.primary}\`} />
      {ALIAS_FAMILY.map((m) => (
        <output data-testid={\`aliasfam-\${m}\`} />
      ))}
      <MixedProps testId="mixed-props" />
      <LocalCard testId="local-card" />
      <OtherCard testId="other-card" />
      <AliasNav data-testid="alias-nav-list" />
      <RelativeCard testId="relative-card" />
      <ImportedCard testId="imported-card" />
      <a data-testid={\`opaque-\${OPAQUE[route]}\`} />
      {navItems}
      {viewItems}
    </div>
  );
}
`;

/**
 * A component whose testid prop is renamed on destructuring and reached only through the
 * scan-root alias — the shape `SubPageNav` has, and the one a relative-only resolver
 * silently fails to bind.
 */
const SELF_TEST_ALIAS_COMPONENT = `
export default function AliasNav({ 'data-testid': listTestId }: { 'data-testid'?: string }) {
  return <div data-testid={listTestId ? \`\${listTestId}-select\` : undefined} />;
}
`;

/** The same shape reached relatively, so one fixture cannot pass for the other. */
const SELF_TEST_RELATIVE_COMPONENT = `
export function RelativeCard({ testId }: { testId: string }) {
  return <div data-testid={\`\${testId}-body\`} />;
}
`;

/**
 * Two components sharing a name in different files, each with its own suffix. The index
 * is keyed by declaring file for exactly this: keyed by name alone, each would answer
 * for the other's call sites and mint ids neither file renders.
 */
const SELF_TEST_TWIN_ONE = `
export function Twin({ testId }: { testId: string }) {
  return <div data-testid={\`\${testId}-one\`} />;
}
`;

const SELF_TEST_TWIN_TWO = `
export function Twin({ testId }: { testId: string }) {
  return <div data-testid={\`\${testId}-two\`} />;
}
`;

/**
 * Two shapes the corpus index must not resolve half of: a component whose callers are
 * partly non-literal, and one whose parameter carries a default. Binding only the
 * literals reports the ids it missed as stale though the app renders them.
 */
const SELF_TEST_PARTIAL_COMPONENT = `
export function PartialCard({ testId }: { testId: string }) {
  return <div data-testid={\`\${testId}-body\`} />;
}
`;

const SELF_TEST_DEFAULTED_COMPONENT = `
export function DefaultedCard({ testId = 'defaulted' }: { testId?: string }) {
  return <div data-testid={\`\${testId}-tail\`} />;
}
`;

const SELF_TEST_SPREAD_CALLER = `
export function SpreadCard({ testId }: { testId: string }) {
  return <div data-testid={\`\${testId}-sp\`} />;
}
const forwarded = { testId: 'from-spread' };
export const SpreadUse = () => (
  <div><SpreadCard testId="spread-literal" /><SpreadCard {...forwarded} /></div>
);
`;

const SELF_TEST_SAMEFILE_PARTIAL = `
export function SameFileCard({ testId }: { testId: string }) {
  return <div data-testid={\`\${testId}-sf\`} />;
}
export const SameFileUse = ({ kind }: { kind: string }) => (
  <SameFileCard testId={\`\${kind}-computed\`} />
);
`;

const SELF_TEST_PARTIAL_CALLERS = `
import { PartialCard } from './partial-card.js';
import { DefaultedCard } from './defaulted-card.js';
import { SameFileCard } from './samefile-card.js';
export const Callers = ({ kind }: { kind: string }) => (
  <div>
    <PartialCard testId="literal-one" />
    <PartialCard testId={\`\${kind}-computed\`} />
    <DefaultedCard testId="explicit" />
    <DefaultedCard />
    <SameFileCard testId="cross-literal" />
  </div>
);
`;

/** A unit test's call site: its ids are not the app's, however the corpus reaches them. */
const SELF_TEST_UNIT_TEST_CALL_SITE = `
import AliasNav from '@/aliased-nav.js';
export const T = () => <AliasNav data-testid="unit-only-nav" />;
`;

/** Callers of the twins: each passes a value only its own twin may suffix. */
const SELF_TEST_TWIN_CALLERS = `
import { Twin as First } from './twin-one.js';
import { Twin as Second } from '@/twin-two.js';
export const Callers = () => (
  <div>
    <First testId="ex" />
    <Second testId="wy" />
  </div>
);
`;

/** A constant family reached only through the scan-root alias. */
const SELF_TEST_ALIAS_FAMILY = `
export const ALIAS_FAMILY = ['one', 'two'];
`;

const SELF_TEST_IMPORTED_FAMILY = `
export const DESTINATIONS: Record<string, string> = {
  '/one': 'one',
  '/two': 'two',
  '/unreachable': 'unreachable',
};

export const ROUTES = [{ to: '/one' }, { to: '/two' }];

export const ALIASED: Record<string, string> = { primary: 'aliased-value' };

export const OPAQUE: Record<string, string> = { a: 'opaque-one', b: 'opaque-two' };
`;

const SELF_TEST_PAGE_OBJECT = `
const bannerTestId = 'resolved-from-const';
export const locators = [
  { type: 'testId', value: 'plain-static' },
  { type: 'testId', value: 'forwarded-prop' },
  { type: 'testId', value: 'multiline-ternary-readonly' },
  { type: 'testId', value: 'settings-tab-alpha' },
  { type: 'testId', value: 'reports-tab-win-loss' },
  { type: 'testId', value: 'owner-filter-mine' },
  { type: 'testId', value: 'member-main' },
  { type: 'testId', value: bannerTestId },
  { type: 'testId', value: 'genuinely-absent-testid' },
  { type: 'testId', value: 'item-prefix-dead-sibling' },
];
`;

interface SelfTestCase {
  name: string;
  /** The form this case pins, named so a failure says what regressed. */
  pins: string;
}

function selfTest(): void {
  const failures: string[] = [];
  let mustResolveCount = 0;
  let mustNotInventCount = 0;
  let expectedStaleCount = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-testids-selftest-'));

  try {
    const appDir = path.join(root, 'app');
    const testDir = path.join(root, 'tests');
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'Fixture.tsx'), SELF_TEST_APP_SOURCE);
    fs.writeFileSync(path.join(appDir, 'destinations.ts'), SELF_TEST_IMPORTED_FAMILY);
    fs.writeFileSync(path.join(appDir, 'alias-family.ts'), SELF_TEST_ALIAS_FAMILY);
    fs.writeFileSync(path.join(appDir, 'aliased-nav.tsx'), SELF_TEST_ALIAS_COMPONENT);
    fs.writeFileSync(path.join(appDir, 'relative-card.tsx'), SELF_TEST_RELATIVE_COMPONENT);
    fs.writeFileSync(path.join(appDir, 'twin-one.tsx'), SELF_TEST_TWIN_ONE);
    fs.writeFileSync(path.join(appDir, 'twin-two.tsx'), SELF_TEST_TWIN_TWO);
    fs.writeFileSync(path.join(appDir, 'TwinCallers.tsx'), SELF_TEST_TWIN_CALLERS);
    fs.writeFileSync(path.join(appDir, 'partial-card.tsx'), SELF_TEST_PARTIAL_COMPONENT);
    fs.writeFileSync(path.join(appDir, 'defaulted-card.tsx'), SELF_TEST_DEFAULTED_COMPONENT);
    fs.writeFileSync(path.join(appDir, 'samefile-card.tsx'), SELF_TEST_SAMEFILE_PARTIAL);
    fs.writeFileSync(path.join(appDir, 'spread-card.tsx'), SELF_TEST_SPREAD_CALLER);
    fs.writeFileSync(path.join(appDir, 'PartialCallers.tsx'), SELF_TEST_PARTIAL_CALLERS);
    fs.writeFileSync(path.join(appDir, 'UnitOnly.test.tsx'), SELF_TEST_UNIT_TEST_CALL_SITE);
    // A fixture that must be ignored: its testid exists only in a unit test.
    fs.writeFileSync(
      path.join(appDir, 'Fixture.test.tsx'),
      `export const T = () => <div data-testid="unit-test-only" />;\n`,
    );
    fs.writeFileSync(path.join(testDir, 'FixturePage.ts'), SELF_TEST_PAGE_OBJECT);

    const app = collectAppTestids(appDir);
    const tests = collectTestTestids([testDir]);
    const appStatics = new Set(app.statics.map((s) => s.value));
    const appPatterns = app.dynamics.map((d) => d.value);

    const stale = tests.statics
      .filter((t) => !isMatchedByApp(t.value, appStatics, appPatterns))
      .map((t) => t.value)
      .sort();

    // Every other reference is a form the extractor must resolve; one appearing
    // here is a regression.
    // A locator for a dead member of a prefix family lands in the stale list, which is
    // what makes the script exit 1 on it.
    const expectedStale = ['genuinely-absent-testid', 'item-prefix-dead-sibling'];
    expectedStaleCount = expectedStale.length;
    if (stale.join(',') !== expectedStale.join(',')) {
      failures.push(
        `expected exactly ${expectedStale.length} stale (${expectedStale.join(', ')}), ` +
          `got ${stale.length} (${stale.join(', ') || 'none'})`,
      );
    }

    const mustResolve: SelfTestCase[] = [
      { name: 'plain-static', pins: 'double-quoted attribute' },
      { name: 'braced-static', pins: 'brace-wrapped literal' },
      { name: 'forwarded-prop', pins: 'JSX attribute prop forwarding' },
      { name: 'multiline-ternary-readonly', pins: 'ternary Prettier split' },
      { name: 'multiline-ternary-editable', pins: 'the other ternary branch' },
      { name: 'settings-tab-alpha', pins: 'plain array via .map()' },
      { name: 'reports-tab-win-loss', pins: '`as const` array via .map()' },
      { name: 'owner-filter-mine', pins: 'OwnerToggle prefix expansion' },
      { name: 'member-main', pins: 'member access resolved to one value' },
      { name: 'nav-one', pins: 'computed access into an imported family' },
      { name: 'nav-two', pins: "the imported family's other member" },
      { name: 'alias-aliased-value', pins: 'an aliased import bound to its local name' },
      { name: 'local-card-derived', pins: "a local component's own derived suffix" },
      { name: 'other-card-other', pins: "a second local component's own suffix" },
      { name: 'mixed-props-a', pins: 'the prop a same-file call site actually passed' },
      { name: 'alias-nav-list-select', pins: 'a renamed prop bound through the scan-root alias' },
      { name: 'relative-card-body', pins: 'the same cross-file binding by relative path' },
      { name: 'ex-one', pins: 'a component resolved against the file that declares it' },
      { name: 'wy-two', pins: "its same-named twin's own call site, in another file" },
      { name: 'explicit-tail', pins: 'a defaulted parameter still binds its call sites' },
      { name: 'defaulted-tail', pins: "the parameter's own default, when a caller omits it" },
      { name: 'aliasfam-one', pins: 'a constant family imported through the scan-root alias' },
    ];
    mustResolveCount = mustResolve.length;
    for (const testCase of mustResolve) {
      if (!appStatics.has(testCase.name)) {
        failures.push(`app extractor missed ${testCase.name} (${testCase.pins})`);
      }
    }

    // Values the extractor must NOT invent. Each would silently absolve a dead
    // locator, which is worse than the false positives this audit set out to fix.
    const mustNotInvent = [
      { value: 'member-aux', why: 'a member access must not enumerate its whole object' },
      { value: 'len-sm', why: '`.length` is not a member of the array' },
      { value: 'len-lg', why: '`.length` is not a member of the array' },
      { value: 'unit-test-only', why: 'unit-test JSX is not application source' },
      {
        value: 'after-map-alpha',
        why: 'a .map() parameter binding must not escape its callback',
      },
      {
        value: 'after-map-beta',
        why: 'a .map() parameter binding must not escape its callback',
      },
      {
        value: 'nav-unreachable',
        why: 'a computed index reaches only the keys its own array supplies',
      },
      {
        value: 'opaque-opaque-one',
        why: 'an index with no resolvable key set must not enumerate the family',
      },
      {
        value: 'opaque-opaque-two',
        why: 'an index with no resolvable key set must not enumerate the family',
      },
      {
        value: 'imported-card-derived',
        why: 'a suffix belongs to the component that declares it, not to every testId prop',
      },
      {
        value: 'other-card-derived',
        why: "one component's call sites must not feed another's suffix",
      },
      {
        value: 'local-card-other',
        why: "one component's call sites must not feed another's suffix",
      },
      {
        value: 'shadowed-overview',
        why: 'a bare identifier must not resolve against a same-named const family',
      },
      {
        value: 'unit-only-nav-select',
        why: 'a call site in a unit test must not feed the corpus index',
      },
      {
        value: 'alias-nav-list-body',
        why: "one component's cross-file values must not reach another's suffix",
      },
      {
        value: 'literal-one-body',
        why: 'a family with a non-literal call site must stay dynamic, not half-resolve',
      },
      {
        value: 'spread-literal-sp',
        why: 'a spread call site can carry the prop, so it poisons the pair like any other',
      },
      {
        value: 'cross-literal-sf',
        why: 'a same-file non-literal poisons the pair as surely as a cross-file one',
      },
      {
        value: 'mixed-props-b',
        why: "one testid prop's call-site values must not bind another prop's parameter",
      },
      {
        value: 'wy-one',
        why: 'a same-named component in another file must not answer for these call sites',
      },
      {
        value: 'ex-two',
        why: 'the same crossing, the other way',
      },
    ];
    mustNotInventCount = mustNotInvent.length;
    for (const invented of mustNotInvent) {
      if (appStatics.has(invented.value)) {
        failures.push(`app extractor invented ${invented.value} — ${invented.why}`);
      }
    }

    // A leading-interpolation pattern must not absolve an unrelated id that
    // happens to share its tail.
    if (isMatchedByApp('unrelated-thing-suffix-only', appStatics, appPatterns)) {
      failures.push('a leading-interpolation pattern matched an unrelated value');
    }

    // An enumerated family drops its permissive prefix, so a sibling the app
    // never renders is reported rather than absolved.
    if (isMatchedByApp('nav-three', appStatics, appPatterns)) {
      failures.push('a dead member of an enumerated family was matched');
    }

    // --check must accept prettier's table padding and a new timestamp, and
    // must reject a changed stale list. Gating on the informational tables
    // instead would fail on any line insertion in client/src.
    const reportFile = path.join(root, 'report.md');
    const generated = [
      '# R',
      '',
      'Generated: 2026-01-01T00:00:00.000Z',
      '',
      '## Summary',
      '',
      '- Matched: 5',
      '- Stale (broken locators): 1',
      '',
      '## Stale testids (action required)',
      '',
      '| testid | Test file | Line |',
      '|--------|-----------|------|',
      '| `gone` | a.ts | 1 |',
      '',
      '## Unexercised testids (review required)',
      '',
      '| testid | App file | Line |',
      '|--------|----------|------|',
      '| `x` | b.tsx | 12 |',
      '',
    ].join('\n');

    // Same stale list, prettier padding, later timestamp, and a moved line
    // number in the informational table: all of that must still pass.
    fs.writeFileSync(
      reportFile,
      generated
        .replace('2026-01-01T00:00:00.000Z', '2026-06-06T00:00:00.000Z')
        .replace('|--------|-----------|------|', '| ------ | --------- | ---- |')
        .replace('| `x` | b.tsx | 12 |', '| `x` | b.tsx | 98 |'),
    );
    if (compareReport(reportFile, generated).startsWith(REPORT_DRIFT_PREFIX)) {
      failures.push(
        '--check rejected a report differing only in timestamp, padding, and line numbers',
      );
    }

    fs.writeFileSync(
      reportFile,
      generated.replace('| `gone` | a.ts | 1 |', '| `other` | a.ts | 1 |'),
    );
    if (!compareReport(reportFile, generated).startsWith(REPORT_DRIFT_PREFIX)) {
      failures.push('--check accepted a changed stale list');
    }

    fs.writeFileSync(
      reportFile,
      generated.replace('- Stale (broken locators): 1', '- Stale (broken locators): 0'),
    );
    if (!compareReport(reportFile, generated).startsWith(REPORT_DRIFT_PREFIX)) {
      failures.push('--check accepted a changed stale count');
    }

    // An unexpandable prefix name must be refused, not silently turned into a `prefix-*`
    // dynamic that absolves its family's dead siblings. Driven through a fixture so it
    // fails if the dispatch stops reaching harvestPrefixProp at all.
    const refusalDir = path.join(root, 'refusal');
    fs.mkdirSync(refusalDir, { recursive: true });
    fs.writeFileSync(
      path.join(refusalDir, 'Future.tsx'),
      'export const F = () => <Nav someFuturePrefix="future" />;\n',
    );
    const previousNames = [...TESTID_PREFIX_NAMES];
    TESTID_PREFIX_NAMES.add('someFuturePrefix');
    let refusedUnknownPrefix = false;
    try {
      collectAppTestids(refusalDir, root);
    } catch (err) {
      refusedUnknownPrefix = err instanceof Error && err.message.includes('someFuturePrefix');
    } finally {
      TESTID_PREFIX_NAMES.clear();
      for (const name of previousNames) TESTID_PREFIX_NAMES.add(name);
    }
    if (!refusedUnknownPrefix) {
      failures.push('an unexpandable prefix prop was accepted rather than refused');
    }

    // The floor and the parse refusal are both documented as this guard's
    // protection against certifying an empty scan. Neither is reachable from
    // the collectors, so assert them directly rather than in prose only.
    if (!isCorpusTooSmall(0) || !isCorpusTooSmall(MINIMUM_EXPECTED_STATICS - 1)) {
      failures.push('the corpus floor accepts a scan that found nothing');
    }
    if (isCorpusTooSmall(MINIMUM_EXPECTED_STATICS)) {
      failures.push('the corpus floor rejects a scan at the threshold');
    }

    const unparseableDir = path.join(root, 'unparseable');
    fs.mkdirSync(unparseableDir, { recursive: true });
    fs.writeFileSync(path.join(unparseableDir, 'Broken.tsx'), 'export function ( { <<<');
    let threw = false;
    try {
      collectAppTestids(unparseableDir, root);
    } catch (err) {
      threw = err instanceof Error && err.message.includes('Failed to parse');
    }
    if (!threw) {
      failures.push('a file that cannot be parsed was skipped rather than reported');
    }

    if (!tests.statics.some((t) => t.value === 'resolved-from-const')) {
      failures.push('test extractor did not resolve an identifier-valued reference');
    }

    // The real corpus, because an empty scan is this guard's silent failure.
    // Resolved from this script's own path, not cwd: running from qa/ would
    // otherwise report zero statics and blame the extractor. `import.meta` is
    // unavailable — qa/tsconfig.json builds to CommonJS.
    const repoRoot = path.resolve(path.dirname(process.argv[1] ?? ''), '..', '..');
    const realApp = collectAppTestids(path.join(repoRoot, 'client', 'src'));
    if (realApp.statics.length < MINIMUM_EXPECTED_STATICS) {
      failures.push(
        `real client/src scan returned ${realApp.statics.length} statics; ` +
          `expected ${MINIMUM_EXPECTED_STATICS}+`,
      );
    }

    // The fixture corpus cannot prove this: its files are siblings in one tmpdir, so a
    // resolver broken on the real tree's nesting or alias depth still passes above.
    // Asserted on the mechanism, not on specific ids: pinning the ids would turn this
    // red on an ordinary rename in client/src, blaming the resolver for someone else's
    // edit. SubPageNav's `-select` template is unresolvable without a bound call site,
    // so a resolved static from that file is what proves the binding happened.
    const subPageNavStatics = realApp.statics.filter(
      (s) => s.file.endsWith('SubPageNav.tsx') && s.value.endsWith('-select'),
    );
    if (subPageNavStatics.length === 0) {
      failures.push(
        'no -select static resolved from SubPageNav.tsx; cross-file prop resolution is not binding',
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST PASS: ${mustResolveCount} forms resolved, ${expectedStaleCount} must-flag ` +
      `stale, ${mustNotInventCount} must-not-invent values absent, suffix-only pattern ` +
      `inert, dead family sibling reported, identifier reference resolved, ` +
      '--check ignores line motion and rejects a changed stale list, corpus floor and ' +
      'parse refusal both enforced.',
  );
}

function main(): void {
  // Validated before dispatch: checking after would let `--self-test --bogus`
  // report a pass, the silent success this guard exists to reject.
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--self-test' && arg !== '--check');
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown[0]}`);
    console.error('Usage: tsx qa/scripts/check-testids.ts [--self-test] [--check]');
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  run(process.argv.includes('--check'));
}

const scriptPath = process.argv[1] ?? '';
if (scriptPath.endsWith('check-testids.ts') || scriptPath.endsWith('check-testids.js')) {
  main();
}
