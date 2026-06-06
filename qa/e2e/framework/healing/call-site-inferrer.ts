/**
 * inferCallSite — stack-trace attribution for heal events.
 *
 * When a HealingLocator is constructed without explicit `pageObject` / `method`
 * options, this module parses the V8 Error stack to find the first call frame
 * whose file path contains one of the caller-supplied `pathSegments`.  The V8
 * "at ClassName.methodName" format is used to extract the class and method
 * names automatically, so page objects get correct attribution without any
 * manual annotation.
 *
 * V8 stack frame formats this parser handles:
 *   at ClassName.methodName (file:///…/path/FooPage.ts:42:18)
 *   at ClassName.methodName (/abs/path/FooPage.ts:42:18)
 *   at async ClassName.methodName (/abs/path/…:42:18)
 *
 * Frames without a dot-separated owner (plain function calls, anonymous
 * lambdas) are skipped — the parser continues to the next frame.
 */

export interface CallSite {
  pageObject: string;
  method: string;
}

/**
 * The V8 "at [async] Owner.method (location)" line pattern.
 * Capture groups:
 *   1 — owner (class name or object)
 *   2 — method name
 *   3 — file location string (path + line + col)
 */
const FRAME_RE = /^\s+at\s+(?:async\s+)?(\S+)\.(\S+)\s+\((.+?)\)/;

/**
 * Parses a V8 Error stack string and returns the first frame whose file
 * location contains any of the given path segments, with a dot-separated
 * owner.method signature.
 *
 * @param stack         The full `Error.stack` string.
 * @param pathSegments  Substrings to match against the frame's file location.
 *                      The first frame matching ANY segment wins.
 * @returns             The inferred call site, or `null` if no frame matches.
 */
export function inferCallSite(stack: string, pathSegments: string[]): CallSite | null {
  const lines = stack.split('\n');

  for (const line of lines) {
    const match = FRAME_RE.exec(line);
    if (match === null) continue;

    const [, owner, methodName, location] = match;

    if (pathSegments.some((seg) => location.includes(seg))) {
      return { pageObject: owner, method: methodName };
    }
  }

  return null;
}
