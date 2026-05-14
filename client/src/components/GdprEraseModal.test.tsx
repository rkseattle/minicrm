/**
 * Tests for the GdprEraseModal component. (MINCRM-364)
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import GdprEraseModal from './GdprEraseModal.js';

const noop = () => {};

describe('GdprEraseModal', () => {
  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <GdprEraseModal
        isOpen={false}
        recordType="contact"
        isErasing={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.queryByTestId('gdpr-erase-modal')).not.toBeInTheDocument();
  });

  it('renders the modal with title when isOpen is true', () => {
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('gdpr-erase-modal')).toBeInTheDocument();
    expect(screen.getByTestId('gdpr-erase-title')).toBeInTheDocument();
  });

  it('lists PII fields that will be erased', () => {
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const fieldList = screen.getByTestId('gdpr-erase-field-list');
    expect(fieldList).toBeInTheDocument();
    expect(fieldList.querySelectorAll('li').length).toBeGreaterThan(0);
  });

  it('confirm button is disabled until ERASE is typed', () => {
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const confirmBtn = screen.getByTestId('gdpr-erase-confirm-button');
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId('gdpr-erase-confirm-input'), {
      target: { value: 'ERASE' },
    });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('confirm button remains disabled for partial input', () => {
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('gdpr-erase-confirm-input'), {
      target: { value: 'ERAS' },
    });
    expect(screen.getByTestId('gdpr-erase-confirm-button')).toBeDisabled();
  });

  it('calls onConfirm with notes when confirmed', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={false}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('gdpr-erase-notes-input'), {
      target: { value: 'GDPR request #42' },
    });
    fireEvent.change(screen.getByTestId('gdpr-erase-confirm-input'), {
      target: { value: 'ERASE' },
    });
    fireEvent.click(screen.getByTestId('gdpr-erase-confirm-button'));
    expect(onConfirm).toHaveBeenCalledWith('GDPR request #42');
  });

  it('calls onConfirm with undefined when notes field is empty', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={false}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('gdpr-erase-confirm-input'), {
      target: { value: 'ERASE' },
    });
    fireEvent.click(screen.getByTestId('gdpr-erase-confirm-button'));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('gdpr-erase-cancel-button'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables all controls while isErasing is true', () => {
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={true}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('gdpr-erase-confirm-button')).toBeDisabled();
    expect(screen.getByTestId('gdpr-erase-cancel-button')).toBeDisabled();
    expect(screen.getByTestId('gdpr-erase-confirm-input')).toBeDisabled();
    expect(screen.getByTestId('gdpr-erase-notes-input')).toBeDisabled();
  });

  it('shows lead PII fields for lead record type', () => {
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="lead"
        isErasing={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const fieldList = screen.getByTestId('gdpr-erase-field-list');
    const items = Array.from(fieldList.querySelectorAll('li')).map((li) => li.textContent);
    expect(items).toContain('company_name');
    expect(items).toContain('notes');
  });

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <GdprEraseModal
        isOpen={true}
        recordType="contact"
        isErasing={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('gdpr-erase-modal-overlay'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
