/**
 * Makes Vitest's global test helpers (describe, it, expect, beforeAll, etc.)
 * available as TypeScript globals in the server test suite.
 *
 * Required because the server vitest config sets `globals: true` — the test
 * files do not import these helpers explicitly.
 */
/// <reference types="vitest/globals" />
