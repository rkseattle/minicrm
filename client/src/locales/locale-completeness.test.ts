import { describe, it, expect } from 'vitest';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import de from './de.json';
import zhHans from './zh-Hans.json';

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

function flattenKeys(obj: JsonObject, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? flattenKeys(v as JsonObject, key)
      : [key];
  });
}

const enKeys = new Set(flattenKeys(en as JsonObject));

const locales: Array<{ name: string; data: JsonObject }> = [
  { name: 'es', data: es as JsonObject },
  { name: 'fr', data: fr as JsonObject },
  { name: 'de', data: de as JsonObject },
  { name: 'zh-Hans', data: zhHans as JsonObject },
];

describe('locale completeness', () => {
  for (const { name, data } of locales) {
    const localeKeys = new Set(flattenKeys(data));

    it(`${name}: no keys missing from English`, () => {
      const missing = [...enKeys].filter((k) => !localeKeys.has(k));
      if (missing.length === 0) return;

      const lines = missing.map((k) => `  - ${k}`).join('\n');
      expect.fail(
        `${name}.json is missing ${missing.length} key(s) that exist in en.json.\n` +
          `Add these keys to client/src/locales/${name}.json:\n${lines}`,
      );
    });

    it(`${name}: no orphaned keys absent from English`, () => {
      const orphaned = [...localeKeys].filter((k) => !enKeys.has(k));
      if (orphaned.length === 0) return;

      const lines = orphaned.map((k) => `  - ${k}`).join('\n');
      expect.fail(
        `${name}.json has ${orphaned.length} orphaned key(s) not present in en.json.\n` +
          `These keys may be stale renames — remove them from client/src/locales/${name}.json or add them to en.json:\n${lines}`,
      );
    });
  }
});
