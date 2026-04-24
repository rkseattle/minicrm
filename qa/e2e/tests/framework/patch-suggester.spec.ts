/**
 * Unit tests for patch-suggester and HealingReporter._writeSuggestions.
 *
 * Covers:
 * 1. Suggestions generated correctly from a report with two heal events from
 *    different methods.
 * 2. Deduplication when the same method heals twice in one run.
 * 3. An empty report produces the "No heal events" output.
 * 4. buildSuggestionsMarkdown formats suggestions into valid markdown.
 *
 * MINCRM-225
 */

import { test, expect } from '@playwright/test';
import { generatePatchSuggestions } from '../../framework/healing/patch-suggester.js';
import { buildSuggestionsMarkdown } from '../../framework/healing/healing-reporter.js';
import type { HealingReport } from '../../framework/healing/healing-reporter.js';

function makeReport(overrides: Partial<HealingReport> = {}): HealingReport {
  return {
    generatedAt: new Date().toISOString(),
    totalHeals: 0,
    aiHeals: 0,
    staticHeals: 0,
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
        instruction: 'instruction A',
      },
      {
        pageObject: 'DealsPage',
        method: 'cancelButton',
        winningStrategyType: 'css',
        winningStrategyValue: '.cancel',
        instruction: 'instruction B',
      },
    ]);
    expect(md).toContain('## ContactsPage.saveButton');
    expect(md).toContain('instruction A');
    expect(md).toContain('## DealsPage.cancelButton');
    expect(md).toContain('instruction B');
  });
});
