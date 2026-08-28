/**
 * Glob-to-RegExp translation shared by TIA's path matchers.
 *
 * One implementation because two would drift: the baseline resolver, the impact
 * manifest, and the scope resolver all ask the same question of a path, and a
 * fix applied to one copy but not the others is invisible until a selection
 * silently narrows.
 */

/** Escapes a literal for RegExp use, deliberately leaving `*` for the translator below. */
function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translates a glob to an anchored RegExp.
 *
 * Splits on wildcard tokens FIRST and maps each to its own regex, so no
 * substitution can re-scan syntax an earlier one emitted. Chaining whole-string
 * replaces instead corrupts `.*` into `.[^/]*`, because the single-star pass
 * matches the star the double-star pass just wrote.
 *
 * `a/**\/b` matches zero or more intervening directories, a trailing `**`
 * matches the whole subtree, and a bare `*` stays within one path segment.
 */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .split(/(\*\*\/|\*\*|\*)/)
    .map((token) => {
      if (token === '**/') return '(?:.*/)?';
      if (token === '**') return '.*';
      if (token === '*') return '[^/]*';
      return escapeRegExpLiteral(token);
    })
    .join('');
  return new RegExp(`^${pattern}$`);
}
