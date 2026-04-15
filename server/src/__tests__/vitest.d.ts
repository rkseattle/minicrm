/**
 * Exposes Vitest's global test helpers (describe, it, expect, beforeAll, etc.)
 * as TypeScript globals for the server test suite.
 *
 * Required because the server vitest config sets `globals: true`. Most test
 * files rely on these as implicit globals; files that also do
 * `import { vi } from 'vitest'` are fine — the explicit import shadows the
 * global for that identifier without conflict.
 */
/// <reference types="vitest/globals" />
