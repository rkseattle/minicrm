/**
 * Tests for FieldMergeModal — three-way merge UI for optimistic locking conflict resolution.
 * (MINCRM-351)
 */

import { screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import FieldMergeModal from './FieldMergeModal.js';

const noop = () => {};

const FIELD_LABELS = {
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  notes: 'Notes',
};

const BASE = {
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.com',
  notes: 'original note',
};

describe('FieldMergeModal', () => {
  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={false}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={BASE}
        mine={BASE}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    expect(screen.queryByTestId('field-merge-modal')).not.toBeInTheDocument();
  });

  it('renders the modal when isOpen is true', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={BASE}
        mine={BASE}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    expect(screen.getByTestId('field-merge-modal')).toBeInTheDocument();
    expect(screen.getByTestId('field-merge-modal-title')).toBeInTheDocument();
  });

  it('does not show unchanged fields (base === theirs === mine)', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={BASE}
        mine={BASE}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    // All fields are identical — no rows should appear
    expect(screen.queryByTestId('field-merge-row-first_name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('field-merge-row-email')).not.toBeInTheDocument();
    // Shows the "no changes" empty state instead
    expect(screen.queryByTestId('field-merge-table')).not.toBeInTheDocument();
  });

  it('shows auto-resolved row when only I changed a field (only-mine)', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={BASE} // theirs === base
        mine={{ ...BASE, first_name: 'Alicia' }} // only mine changed
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    const row = screen.getByTestId('field-merge-row-first_name');
    expect(row).toBeInTheDocument();
    // Auto indicator should be present (no radio buttons)
    expect(within(row).getByTestId('field-merge-auto-first_name')).toBeInTheDocument();
    expect(
      within(row).queryByTestId('field-merge-radio-first_name-theirs'),
    ).not.toBeInTheDocument();
  });

  it('shows auto-resolved row when only they changed a field (only-theirs)', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, last_name: 'Jones' }} // only theirs changed
        mine={BASE} // mine === base
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    const row = screen.getByTestId('field-merge-row-last_name');
    expect(within(row).getByTestId('field-merge-auto-last_name')).toBeInTheDocument();
    expect(within(row).queryByTestId('field-merge-radio-last_name-mine')).not.toBeInTheDocument();
  });

  it('shows auto-resolved row when both changed to the same value (same-change)', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, email: 'new@example.com' }}
        mine={{ ...BASE, email: 'new@example.com' }} // same as theirs
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    const row = screen.getByTestId('field-merge-row-email');
    expect(within(row).getByTestId('field-merge-auto-email')).toBeInTheDocument();
    expect(within(row).queryByTestId('field-merge-radio-email-theirs')).not.toBeInTheDocument();
  });

  it('shows radio buttons for true conflict fields, defaulting to Theirs', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, notes: 'their note' }} // they changed
        mine={{ ...BASE, notes: 'my note' }} // I also changed differently
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    const row = screen.getByTestId('field-merge-row-notes');
    const theirsRadio = within(row).getByTestId('field-merge-radio-notes-theirs');
    const mineRadio = within(row).getByTestId('field-merge-radio-notes-mine');
    // Default selection must be Theirs to protect the other user's work
    expect(theirsRadio).toBeChecked();
    expect(mineRadio).not.toBeChecked();
    // No auto indicator on a conflict row
    expect(within(row).queryByTestId('field-merge-auto-notes')).not.toBeInTheDocument();
  });

  it('allows user to switch conflict selection to Mine', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, notes: 'their note' }}
        mine={{ ...BASE, notes: 'my note' }}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    const mineRadio = screen.getByTestId('field-merge-radio-notes-mine');
    fireEvent.click(mineRadio);
    expect(mineRadio).toBeChecked();
    expect(screen.getByTestId('field-merge-radio-notes-theirs')).not.toBeChecked();
  });

  it('calls onResolve with correct merged values when Save resolved is clicked', () => {
    const onResolve = vi.fn();
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, first_name: 'TheirName', notes: 'their note' }}
        mine={{ ...BASE, first_name: 'MyName', notes: 'my note' }}
        fieldLabels={FIELD_LABELS}
        onResolve={onResolve}
      />,
    );
    // Both first_name and notes are true conflicts; defaults to Theirs.
    // Switch notes to Mine.
    fireEvent.click(screen.getByTestId('field-merge-radio-notes-mine'));

    fireEvent.click(screen.getByTestId('field-merge-save-button'));

    expect(onResolve).toHaveBeenCalledOnce();
    const resolved = onResolve.mock.calls[0][0] as Record<string, unknown>;
    // first_name defaulted to Theirs
    expect(resolved.first_name).toBe('TheirName');
    // notes was switched to Mine
    expect(resolved.notes).toBe('my note');
  });

  it('resolves only-mine fields to mine value in the merged output', () => {
    const onResolve = vi.fn();
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={BASE}
        mine={{ ...BASE, last_name: 'MyNewName' }}
        fieldLabels={FIELD_LABELS}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByTestId('field-merge-save-button'));
    const resolved = onResolve.mock.calls[0][0] as Record<string, unknown>;
    expect(resolved.last_name).toBe('MyNewName');
  });

  it('resolves only-theirs fields to their value in the merged output', () => {
    const onResolve = vi.fn();
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, email: 'their@example.com' }}
        mine={BASE}
        fieldLabels={FIELD_LABELS}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByTestId('field-merge-save-button'));
    const resolved = onResolve.mock.calls[0][0] as Record<string, unknown>;
    expect(resolved.email).toBe('their@example.com');
  });

  it('calls onClose when Discard my changes is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={onClose}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, notes: 'their note' }}
        mine={{ ...BASE, notes: 'my note' }}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('field-merge-discard-button'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={onClose}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, notes: 'their note' }}
        mine={{ ...BASE, notes: 'my note' }}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('field-merge-modal-overlay'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders inline character diffs in string field cells for true conflicts', () => {
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={{ ...BASE, notes: 'hello world' }}
        theirs={{ ...BASE, notes: 'hello there' }}
        mine={{ ...BASE, notes: 'hello earth' }}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    // The diff package produces ins/del elements; we just check the row renders content
    const row = screen.getByTestId('field-merge-row-notes');
    expect(row).toBeInTheDocument();
    // Both conflict radio buttons should be present
    expect(within(row).getByTestId('field-merge-radio-notes-theirs')).toBeInTheDocument();
    expect(within(row).getByTestId('field-merge-radio-notes-mine')).toBeInTheDocument();
  });

  it('resolves all conflict fields to mine values when every choice is switched to Mine', () => {
    const onResolve = vi.fn();
    renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, first_name: 'TheirFirst', last_name: 'TheirLast' }}
        mine={{ ...BASE, first_name: 'MyFirst', last_name: 'MyLast' }}
        fieldLabels={FIELD_LABELS}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByTestId('field-merge-radio-first_name-mine'));
    fireEvent.click(screen.getByTestId('field-merge-radio-last_name-mine'));
    fireEvent.click(screen.getByTestId('field-merge-save-button'));
    expect(onResolve).toHaveBeenCalledOnce();
    const resolved = onResolve.mock.calls[0][0] as Record<string, unknown>;
    expect(resolved.first_name).toBe('MyFirst');
    expect(resolved.last_name).toBe('MyLast');
  });

  it('resets conflict choices to Theirs when reopened with new data', () => {
    const { rerender } = renderWithProviders(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, notes: 'their note' }}
        mine={{ ...BASE, notes: 'my note' }}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    // Switch to Mine
    fireEvent.click(screen.getByTestId('field-merge-radio-notes-mine'));
    expect(screen.getByTestId('field-merge-radio-notes-mine')).toBeChecked();

    // Close and reopen
    rerender(
      <FieldMergeModal
        isOpen={false}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, notes: 'their note' }}
        mine={{ ...BASE, notes: 'my note' }}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    rerender(
      <FieldMergeModal
        isOpen={true}
        onClose={noop}
        entityType="contact"
        base={BASE}
        theirs={{ ...BASE, notes: 'their note' }}
        mine={{ ...BASE, notes: 'my note' }}
        fieldLabels={FIELD_LABELS}
        onResolve={noop}
      />,
    );
    // Should default back to Theirs
    expect(screen.getByTestId('field-merge-radio-notes-theirs')).toBeChecked();
  });
});
