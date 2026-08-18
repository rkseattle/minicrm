/**
 * Unit tests for patch-suggester and HealingReporter._writeSuggestions.
 *
 * Covers:
 * 1. Suggestions generated correctly from a report with two heal events from
 *    different methods.
 * 2. Deduplication when the same method heals twice in one run.
 * 3. An empty report produces the "No heal events" output.
 * 4. buildSuggestionsMarkdown formats suggestions into valid markdown.
 * 5. Trend-aware sorting: suggestions sorted by accumulated count descending.
 * 6. Trend-aware instruction: count prefix in instruction when trends present.
 * 7. No count prefix when accumulatedCount is 0 (no trends provided).
 *
 *
 */

import { test, expect } from '@playwright/test';
import { generatePatchSuggestions } from '../../framework/healing/patch-suggester.js';
import { buildSuggestionsMarkdown } from '../../framework/healing/healing-reporter.js';
import type { HealingReport } from '../../framework/healing/healing-reporter.js';
import type { HealTrendEntry } from '../../framework/healing/heal-trends.js';

function makeReport(overrides: Partial<HealingReport> = {}): HealingReport {
  return {
    generatedAt: new Date().toISOString(),
    totalHeals: 0,
    aiHeals: 0,
    staticHeals: 0,
    aiHealCount: 0,
    estimatedTokenCost: 0,
    events: [],
    ...overrides,
  };
}

test.describe('generatePatchSuggestions', () => {
  test('returns empty array for a report with no events', () => {
    const report = makeReport();
    const suggestions = generatePatchSuggestions(report);
    expect(suggestions).toEqual([]);
  });

  test('generates a suggestion for a single heal event without PO context', () => {
    const report = makeReport({
      totalHeals: 1,
      staticHeals: 1,
      events: [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          testName: 'some test',
          originalStrategy: { type: 'testId', value: 'save-button' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
        },
      ],
    });

    const suggestions = generatePatchSuggestions(report);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      pageObject: 'Unknown',
      method: 'unknown',
      winningStrategyType: 'role',
      winningStrategyValue: 'button',
    });
    expect(suggestions[0]!.instruction).toContain('Unknown.unknown');
    expect(suggestions[0]!.instruction).toContain('"type":"role"');
    expect(suggestions[0]!.instruction).toContain('"value":"button"');
    expect(suggestions[0]!.instruction).toContain('position 0');
  });

  test('generates correct suggestions from two heal events from different methods', () => {
    const report = makeReport({
      totalHeals: 2,
      staticHeals: 2,
      events: [
        {
          timestamp: '2026-01-01T00:00:01.000Z',
          testName: 'test A',
          originalStrategy: { type: 'testId', value: 'save-btn' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
          pageObject: 'ContactsPage',
          method: 'saveButton',
        },
        {
          timestamp: '2026-01-01T00:00:02.000Z',
          testName: 'test B',
          originalStrategy: { type: 'testId', value: 'name-input' },
          healedStrategy: { type: 'label', value: 'First Name' },
          wasAiHeal: false,
          pageObject: 'ContactsPage',
          method: 'firstNameInput',
        },
      ],
    });

    const suggestions = generatePatchSuggestions(report);
    expect(suggestions).toHaveLength(2);

    const [s0, s1] = suggestions;
    expect(s0).toMatchObject({
      pageObject: 'ContactsPage',
      method: 'saveButton',
      winningStrategyType: 'role',
      winningStrategyValue: 'button',
    });
    expect(s0!.instruction).toBe(
      `Move {"type":"role","value":"button"} to position 0 in the strategy array for ContactsPage.saveButton`,
    );

    expect(s1).toMatchObject({
      pageObject: 'ContactsPage',
      method: 'firstNameInput',
      winningStrategyType: 'label',
      winningStrategyValue: 'First Name',
    });
    expect(s1!.instruction).toBe(
      `Move {"type":"label","value":"First Name"} to position 0 in the strategy array for ContactsPage.firstNameInput`,
    );
  });

  test('deduplicates when the same method heals twice in one run', () => {
    const report = makeReport({
      totalHeals: 2,
      staticHeals: 2,
      events: [
        {
          timestamp: '2026-01-01T00:00:01.000Z',
          testName: 'test run 1',
          originalStrategy: { type: 'testId', value: 'save-btn' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
          pageObject: 'ContactsPage',
          method: 'saveButton',
        },
        {
          timestamp: '2026-01-01T00:00:02.000Z',
          testName: 'test run 2',
          originalStrategy: { type: 'testId', value: 'save-btn' },
          healedStrategy: { type: 'css', value: '.save' },
          wasAiHeal: false,
          pageObject: 'ContactsPage',
          method: 'saveButton',
        },
      ],
    });

    const suggestions = generatePatchSuggestions(report);
    expect(suggestions).toHaveLength(1);
    // First-recorded (earliest timestamp) winning strategy wins.
    expect(suggestions[0]!.winningStrategyType).toBe('role');
    expect(suggestions[0]!.winningStrategyValue).toBe('button');
  });

  test('dedup key distinguishes same strategy type with different original values on the same method', () => {
    // Two locators on the same method both use testId but with different values.
    // Before the fix (key was type-only) these would collapse to one suggestion.
    const report = makeReport({
      totalHeals: 2,
      staticHeals: 2,
      events: [
        {
          timestamp: '2026-01-01T00:00:01.000Z',
          testName: 'test A',
          originalStrategy: { type: 'testId', value: 'save-btn' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
          pageObject: 'ContactsPage',
          method: 'saveButton',
        },
        {
          timestamp: '2026-01-01T00:00:02.000Z',
          testName: 'test B',
          originalStrategy: { type: 'testId', value: 'confirm-btn' },
          healedStrategy: { type: 'css', value: '.confirm' },
          wasAiHeal: false,
          pageObject: 'ContactsPage',
          method: 'saveButton',
        },
      ],
    });

    const suggestions = generatePatchSuggestions(report);
    // Different original values → two distinct locators → two suggestions.
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]!.winningStrategyType).toBe('role');
    expect(suggestions[1]!.winningStrategyType).toBe('css');
  });

  test('dedup key distinguishes different methods with the same original strategy type', () => {
    const report = makeReport({
      totalHeals: 2,
      staticHeals: 2,
      events: [
        {
          timestamp: '2026-01-01T00:00:01.000Z',
          testName: 'test A',
          originalStrategy: { type: 'testId', value: 'btn' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
          pageObject: 'DealsPage',
          method: 'saveButton',
        },
        {
          timestamp: '2026-01-01T00:00:02.000Z',
          testName: 'test B',
          originalStrategy: { type: 'testId', value: 'btn' },
          healedStrategy: { type: 'css', value: '.btn' },
          wasAiHeal: false,
          pageObject: 'DealsPage',
          method: 'cancelButton',
        },
      ],
    });

    const suggestions = generatePatchSuggestions(report);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]!.method).toBe('saveButton');
    expect(suggestions[1]!.method).toBe('cancelButton');
  });
});

test.describe('buildSuggestionsMarkdown', () => {
  test('returns "No heal events this run." for an empty suggestions array', () => {
    const md = buildSuggestionsMarkdown([]);
    expect(md).toBe('No heal events this run.\n');
  });

  test('formats a single suggestion with a heading and instruction', () => {
    const md = buildSuggestionsMarkdown([
      {
        pageObject: 'ContactsPage',
        method: 'saveButton',
        winningStrategyType: 'role',
        winningStrategyValue: 'button',
        accumulatedCount: 0,
        instruction:
          'Move {"type":"role","value":"button"} to position 0 in the strategy array for ContactsPage.saveButton',
      },
    ]);
    expect(md).toContain('## ContactsPage.saveButton');
    expect(md).toContain('Move {"type":"role","value":"button"} to position 0');
  });

  test('formats multiple suggestions with separate headings', () => {
    const md = buildSuggestionsMarkdown([
      {
        pageObject: 'ContactsPage',
        method: 'saveButton',
        winningStrategyType: 'role',
        winningStrategyValue: 'button',
        accumulatedCount: 0,
        instruction: 'instruction A',
      },
      {
        pageObject: 'DealsPage',
        method: 'cancelButton',
        winningStrategyType: 'css',
        winningStrategyValue: '.cancel',
        accumulatedCount: 0,
        instruction: 'instruction B',
      },
    ]);
    expect(md).toContain('## ContactsPage.saveButton');
    expect(md).toContain('instruction A');
    expect(md).toContain('## DealsPage.cancelButton');
    expect(md).toContain('instruction B');
  });
});

// ---------------------------------------------------------------------------
// trend-aware suggestions — count sorting and instruction prefix
// ---------------------------------------------------------------------------

test.describe('generatePatchSuggestions — trend-aware', () => {
  function makeTrendEntry(count: number): HealTrendEntry {
    return {
      pageObject: 'P',
      method: 'm',
      originalStrategyType: 'testId',
      originalStrategyValue: 'x',
      count,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    };
  }

  test('suggestions are sorted by accumulated count descending when trends provided (AC #4)', () => {
    const report = makeReport({
      totalHeals: 2,
      staticHeals: 2,
      events: [
        {
          timestamp: '2026-01-01T00:00:01.000Z',
          testName: 'test A',
          originalStrategy: { type: 'testId', value: 'low-btn' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
          pageObject: 'PageA',
          method: 'lowButton',
        },
        {
          timestamp: '2026-01-01T00:00:02.000Z',
          testName: 'test B',
          originalStrategy: { type: 'testId', value: 'high-btn' },
          healedStrategy: { type: 'css', value: '.btn' },
          wasAiHeal: false,
          pageObject: 'PageB',
          method: 'highButton',
        },
      ],
    });

    const trends: Record<string, HealTrendEntry> = {
      'PageA::lowButton::testId::low-btn': makeTrendEntry(2),
      'PageB::highButton::testId::high-btn': makeTrendEntry(7),
    };

    const suggestions = generatePatchSuggestions(report, trends);
    expect(suggestions).toHaveLength(2);
    // Higher count locator must appear first.
    expect(suggestions[0]!.method).toBe('highButton');
    expect(suggestions[0]!.accumulatedCount).toBe(7);
    expect(suggestions[1]!.method).toBe('lowButton');
    expect(suggestions[1]!.accumulatedCount).toBe(2);
  });

  test('instruction includes count prefix when accumulatedCount > 0 (AC #4)', () => {
    const report = makeReport({
      totalHeals: 1,
      staticHeals: 1,
      events: [
        {
          timestamp: '2026-01-01T00:00:01.000Z',
          testName: 'test',
          originalStrategy: { type: 'testId', value: 'save-btn' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
          pageObject: 'ContactsPage',
          method: 'saveButton',
        },
      ],
    });

    const trends: Record<string, HealTrendEntry> = {
      'ContactsPage::saveButton::testId::save-btn': makeTrendEntry(5),
    };

    const suggestions = generatePatchSuggestions(report, trends);
    expect(suggestions[0]!.instruction).toContain('Healed 5 time(s) across runs.');
    expect(suggestions[0]!.accumulatedCount).toBe(5);
  });

  test('no count prefix in instruction when no trends provided', () => {
    const report = makeReport({
      totalHeals: 1,
      staticHeals: 1,
      events: [
        {
          timestamp: '2026-01-01T00:00:01.000Z',
          testName: 'test',
          originalStrategy: { type: 'testId', value: 'save-btn' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
          pageObject: 'ContactsPage',
          method: 'saveButton',
        },
      ],
    });

    const suggestions = generatePatchSuggestions(report);
    expect(suggestions[0]!.instruction).not.toContain('Healed');
    expect(suggestions[0]!.accumulatedCount).toBe(0);
  });

  test('accumulatedCount is 0 when locator key is absent from trends', () => {
    const report = makeReport({
      totalHeals: 1,
      staticHeals: 1,
      events: [
        {
          timestamp: '2026-01-01T00:00:01.000Z',
          testName: 'test',
          originalStrategy: { type: 'testId', value: 'missing-btn' },
          healedStrategy: { type: 'role', value: 'button' },
          wasAiHeal: false,
          pageObject: 'SomePage',
          method: 'someMethod',
        },
      ],
    });

    // Trends exist but the locator key is absent from them.
    const trends: Record<string, HealTrendEntry> = {
      'OtherPage::otherMethod::testId::other-btn': makeTrendEntry(3),
    };

    const suggestions = generatePatchSuggestions(report, trends);
    expect(suggestions[0]!.accumulatedCount).toBe(0);
    expect(suggestions[0]!.instruction).not.toContain('Healed');
  });
});
