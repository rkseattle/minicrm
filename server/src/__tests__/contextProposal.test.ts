/**
 * Unit tests for the context proposal extraction module. (MINCRM-429, MINCRM-430)
 *
 * These tests do not hit the database — pure string parsing.
 */

import { describe, it, expect } from 'vitest';
import { extractContextProposal } from '../ai/contextProposal.js';

describe('extractContextProposal', () => {
  it('returns null and original content when no marker is present', () => {
    const content = 'Found 3 contacts matching your query.';
    const result = extractContextProposal(content);
    expect(result.proposal).toBeNull();
    expect(result.cleanContent).toBe(content);
  });

  it('extracts a valid proposal and strips the marker', () => {
    const content =
      'Showing contacts with no activity in 30+ days.\n' +
      '%%CONTEXT_PROPOSAL%%{"key":"a while","value":"30+ days without activity","reason":"I used this interpretation for your query."}%%';
    const result = extractContextProposal(content);
    expect(result.proposal).toEqual({
      key: 'a while',
      value: '30+ days without activity',
      reason: 'I used this interpretation for your query.',
    });
    expect(result.cleanContent).toBe('Showing contacts with no activity in 30+ days.');
  });

  it('handles a proposal embedded in the middle of the text', () => {
    const content =
      'Here are the results.%%CONTEXT_PROPOSAL%%{"key":"high-value","value":"deals over $50k","reason":"Based on your refinement."}%%\nLet me know if you need more.';
    const result = extractContextProposal(content);
    expect(result.proposal?.key).toBe('high-value');
    expect(result.cleanContent).not.toContain('%%CONTEXT_PROPOSAL%%');
  });

  it('returns null for malformed JSON in the marker', () => {
    const content = 'Some response %%CONTEXT_PROPOSAL%%{not valid json}%%';
    const result = extractContextProposal(content);
    expect(result.proposal).toBeNull();
    expect(result.cleanContent).toBe('Some response');
  });

  it('returns null when marker JSON is missing required fields', () => {
    const content = 'Some response %%CONTEXT_PROPOSAL%%{"key":"a while"}%%';
    const result = extractContextProposal(content);
    expect(result.proposal).toBeNull();
  });

  it('returns null when key or value is an empty string', () => {
    const content = '%%CONTEXT_PROPOSAL%%{"key":"","value":"something","reason":"r"}%%';
    const result = extractContextProposal(content);
    expect(result.proposal).toBeNull();
  });

  it('strips the marker even when proposal JSON is invalid', () => {
    const content = 'Good stuff. %%CONTEXT_PROPOSAL%%{bad}%%';
    const result = extractContextProposal(content);
    expect(result.cleanContent).toBe('Good stuff.');
    expect(result.proposal).toBeNull();
  });
});
