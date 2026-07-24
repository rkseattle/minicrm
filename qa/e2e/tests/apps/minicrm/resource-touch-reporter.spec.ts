/**
 * Unit tests for MiniCRM's lookupResourceTouch / ResourceTouchReporter,
 * verifying the real RESOURCE_REGISTRY is consulted correctly (matching
 * rules: file-wide vs testTitleContains-scoped, unioning across multiple
 * matches, null for untracked tests).
 *
 * MINCRM-661
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  lookupResourceTouch,
  ResourceTouchReporter,
} from '@apps/minicrm/resource-touch-reporter.js';
import { BaseResourceTouchReporter } from '@framework/reporting/resource-touch-reporter.js';

test.describe('lookupResourceTouch — file-wide entries', () => {
  test('matches any test title in a file-wide entry (e.g. navigation.spec.ts)', () => {
    const result = lookupResourceTouch(
      'qa/e2e/tests/apps/minicrm/functional/navigation/navigation.spec.ts',
      'any test title at all',
    );
    expect(result).not.toBeNull();
    expect(result?.reads).toContain('settings.nav_layout');
    expect(result?.writes).toContain('settings.nav_layout');
  });

  test('returns null for a file with no registry entry', () => {
    const result = lookupResourceTouch(
      'qa/e2e/tests/apps/minicrm/functional/contacts/contacts.spec.ts',
      'any test',
    );
    expect(result).toBeNull();
  });
});

test.describe('lookupResourceTouch — testTitleContains-scoped entries', () => {
  test('matches only the specific test title (deal-health-check.spec.ts F7-DH4)', () => {
    const result = lookupResourceTouch(
      'qa/e2e/tests/apps/minicrm/functional/deals/deal-health-check.spec.ts',
      'F7-DH4: some ownership enforcement test @functional @serial',
    );
    expect(result).not.toBeNull();
    expect(result?.reads).toContain('settings.visibility_policy');
  });

  test('does not match a different test title in the same file', () => {
    const result = lookupResourceTouch(
      'qa/e2e/tests/apps/minicrm/functional/deals/deal-health-check.spec.ts',
      'F7-DH1: unrelated plain functional test',
    );
    expect(result).toBeNull();
  });
});

test.describe('lookupResourceTouch — the ai-usage-dashboard cost-rates correction', () => {
  test('F-AI-UD-6 resolves to settings.ai_cost_rates, not settings.ai_configuration_enabled', () => {
    const result = lookupResourceTouch(
      'qa/e2e/tests/apps/minicrm/functional/ai/ai-usage-dashboard.spec.ts',
      'F-AI-UD-6: PATCH /admin/ai/cost-rates persists both rates @functional @serial',
    );
    expect(result).not.toBeNull();
    expect(result?.reads).toEqual(['settings.ai_cost_rates']);
    expect(result?.writes).toEqual(['settings.ai_cost_rates']);
  });
});

test.describe('lookupResourceTouch — unioning across multiple matching entries', () => {
  test('feature-flags.spec.ts unions all of its declared flag keys', () => {
    const result = lookupResourceTouch(
      'qa/e2e/tests/apps/minicrm/functional/feature-flags/feature-flags.spec.ts',
      'any test title',
    );
    expect(result).not.toBeNull();
    expect(result?.reads).toEqual(
      expect.arrayContaining(['feature_flags.notes', 'feature_flags.tags', 'custom_roles']),
    );
  });
});

test.describe('ResourceTouchReporter', () => {
  test('is a concrete subclass of BaseResourceTouchReporter', () => {
    const reporter = new ResourceTouchReporter();
    expect(reporter).toBeInstanceOf(BaseResourceTouchReporter);
  });

  test('does not throw when constructed and run through the Reporter lifecycle', () => {
    const reporter = new ResourceTouchReporter();
    expect(() => reporter.onBegin({} as never)).not.toThrow();
  });
});
