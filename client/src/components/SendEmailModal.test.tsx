/**
 * Tests for SendEmailModal (MINCRM-275).
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import SendEmailModal from './SendEmailModal.js';

const CONTACT_ID = '00000000-0000-0000-0000-000000000c01';
const CONTACT_EMAIL = 'jane@example.com';
const CONTACT_NAME = 'Jane Smith';

const noop = () => {};

describe('SendEmailModal', () => {
  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={false}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    expect(screen.queryByTestId('send-email-modal')).not.toBeInTheDocument();
  });

  it('renders To, Subject, and Body fields when open', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    expect(screen.getByTestId('send-email-modal')).toBeInTheDocument();
    expect(screen.getByTestId('send-email-to')).toHaveValue(CONTACT_EMAIL);
    expect(screen.getByTestId('send-email-subject')).toBeInTheDocument();
    expect(screen.getByTestId('send-email-body')).toBeInTheDocument();
  });

  it('To field is read-only', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    expect(screen.getByTestId('send-email-to')).toHaveAttribute('readonly');
  });

  it('Send button is disabled when subject and body are empty', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    expect(screen.getByTestId('send-email-submit')).toBeDisabled();
  });

  it('Send button is enabled when subject and body are filled', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), {
      target: { value: 'Hello' },
    });
    fireEvent.change(screen.getByTestId('send-email-body'), {
      target: { value: 'Body text' },
    });
    expect(screen.getByTestId('send-email-submit')).not.toBeDisabled();
  });

  it('shows "Email logged (SMTP not configured)" success message when delivered is false', async () => {
    const onSent = vi.fn();
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={onSent}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), {
      target: { value: 'Test subject' },
    });
    fireEvent.change(screen.getByTestId('send-email-body'), {
      target: { value: 'Test body' },
    });
    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('send-email-success')).toBeInTheDocument();
    });
    expect(screen.getByTestId('send-email-success')).toHaveTextContent(
      'Email logged (SMTP not configured)',
    );
    expect(onSent).toHaveBeenCalledOnce();
  });

  it('shows "Email sent to [name]" success message when delivered is true', async () => {
    server.use(
      http.post('/api/v1/contacts/:id/send-email', () => {
        return HttpResponse.json({
          delivered: true,
          activityId: '00000000-0000-0000-0000-000000000e02',
        });
      }),
    );

    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), {
      target: { value: 'Hi' },
    });
    fireEvent.change(screen.getByTestId('send-email-body'), {
      target: { value: 'Hey there' },
    });
    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('send-email-success')).toBeInTheDocument();
    });
    expect(screen.getByTestId('send-email-success')).toHaveTextContent(
      `Email sent to ${CONTACT_NAME}`,
    );
  });

  it('shows an error message when the API returns an error', async () => {
    server.use(
      http.post('/api/v1/contacts/:id/send-email', () => {
        return HttpResponse.json(
          { error: { code: 'SMTP_ERROR', message: 'SMTP connection refused' } },
          { status: 500 },
        );
      }),
    );

    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), {
      target: { value: 'Test subject' },
    });
    fireEvent.change(screen.getByTestId('send-email-body'), {
      target: { value: 'Test body' },
    });
    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('send-email-error')).toBeInTheDocument();
    });
    // Must show the i18n translation, not the raw English server message (MINCRM-354)
    expect(screen.getByTestId('send-email-error')).not.toHaveTextContent('SMTP connection refused');
    expect(screen.getByTestId('send-email-error')).toHaveTextContent(
      'Failed to send email. Please check your SMTP settings.',
    );
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={onClose}
        onSent={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('send-email-cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={onClose}
        onSent={noop}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('send-email-modal'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={onClose}
        onSent={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('send-email-modal'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
