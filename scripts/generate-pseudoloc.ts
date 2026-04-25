/**
 * generate-pseudoloc.ts
 *
 * Reads client/src/locales/en.json and writes client/src/locales/pseudo.json
 * with every string value pseudo-localised.
 *
 * Regenerate pseudo.json after changing en.json by running:
 *   npm run pseudoloc
 *
 * Do NOT edit pseudo.json directly — changes will be overwritten.
 *
 * Transform rules:
 *   - Wrap the string in [ and ]
 *   - Replace Latin vowels/consonants with diacritic equivalents
 *     (case-preserving): a→ä  e→ë  i→ï  o→ö  u→ü  s→ŝ  c→ĉ  n→ñ
 *     Uppercase: A→Ä  E→Ë  I→Ï  O→Ö  U→Ü  S→Ŝ  C→Ĉ  N→Ñ
 *   - Pad with ~ characters so total string length is ≥130% of the original
 *   - Leave i18next interpolation tokens ({{variable}}) unchanged
 *
 * Example: "Save Changes" → "[Ŝävë Ĉhäñĝëŝ~~~]"
 *
 * MINCRM-241
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Character substitution map (lower-case key → diacritic)
// ---------------------------------------------------------------------------

const LOWER_MAP: Record<string, string> = {
  a: 'ä',
  e: 'ë',
  i: 'ï',
  o: 'ö',
  u: 'ü',
  s: 'ŝ',
  c: 'ĉ',
  n: 'ñ',
};

const UPPER_MAP: Record<string, string> = {
  A: 'Ä',
  E: 'Ë',
  I: 'Ï',
  O: 'Ö',
  U: 'Ü',
  S: 'Ŝ',
  C: 'Ĉ',
  N: 'Ñ',
};

// ---------------------------------------------------------------------------
// Token-aware transform
// ---------------------------------------------------------------------------

/**
 * Split a string into alternating segments of literal text and i18next tokens.
 * Tokens like {{name}} are returned unchanged; literal segments are transformed.
 */
function transformString(value: string): string {
  const originalLength = value.length;

  // Split on i18next interpolation tokens, keeping them in the result array.
  const TOKEN_RE = /(\{\{[^}]+\}\})/g;
  const parts = value.split(TOKEN_RE);

  const transformed = parts
    .map((part) => {
      // Keep interpolation tokens as-is.
      if (/^\{\{[^}]+\}\}$/.test(part)) return part;
      // Apply character substitution to literal text.
      return part
        .split('')
        .map((ch) => UPPER_MAP[ch] ?? LOWER_MAP[ch] ?? ch)
        .join('');
    })
    .join('');

  // Pad with ~ characters until the inner content length reaches 130% of original.
  const targetLength = Math.ceil(originalLength * 1.3);
  // +2 for the [ and ] wrapper characters already consumed by the brackets.
  const paddingNeeded = Math.max(0, targetLength - transformed.length);
  const padding = '~'.repeat(paddingNeeded);

  return `[${transformed}${padding}]`;
}

// ---------------------------------------------------------------------------
// Recursive JSON object transform
// ---------------------------------------------------------------------------

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

function transformValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') return transformString(value);
  if (Array.isArray(value)) return value.map(transformValue);
  if (typeof value === 'object' && value !== null) {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = transformValue(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const EN_PATH = resolve(__dirname, '../client/src/locales/en.json');
const OUT_PATH = resolve(__dirname, '../client/src/locales/pseudo.json');

const enJson = JSON.parse(readFileSync(EN_PATH, 'utf-8')) as JsonObject;
const pseudoJson = transformValue(enJson);

writeFileSync(OUT_PATH, JSON.stringify(pseudoJson, null, 2) + '\n', 'utf-8');
console.log(`pseudo.json written to ${OUT_PATH}`);
