/**
 * Tests for AttachmentsSection component. (MINCRM-167, MINCRM-169)
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import AttachmentsSection from './AttachmentsSection.js';
import type { Attachment } from '@/api/attachments.js';

const CONTACT_ID = '00000000-0000-0000-0000-000000000101';

const ATTACHMENT_1: Attachment = {
  id: '00000000-0000-0000-0000-000000000a01',
  record_type: 'contact',
  record_id: CONTACT_ID,
  filename: 'proposal.pdf',
  file_size: 1024 * 512, // 512 KB
  mime_type: 'application/pdf',
  uploader_id: '00000000-0000-0000-0000-000000000001',
  uploader_name: 'Test Admin',
  uploaded_at: '2025-06-01T10:00:00.000Z',
};

const ATTACHMENT_2: Attachment = {
  id: '00000000-0000-0000-0000-000000000a02',
  record_type: 'contact',
  record_id: CONTACT_ID,
  filename: 'contract.docx',
  file_size: 2048,
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  uploader_id: '00000000-0000-0000-0000-000000000001',
  uploader_name: 'Test Admin',
  uploaded_at: '2025-06-02T10:00:00.000Z',
};

/** Sets up a storage-configured response and an optional attachment list. */
function withStorageConfigured(attachments: Attachment[] = []) {
  server.use(
    http.get('/api/settings/storage', () =>
      HttpResponse.json({
        configured: true,
        config: {
          endpoint: 'http://localhost:9000',
          bucket: 'test',
          accessKeyId: 'key',
          secretAccessKey: '********',
        },
      }),
    ),
    http.get('/api/attachments', () => HttpResponse.json({ attachments })),
  );
}

function withStorageNotConfigured() {
  server.use(
    http.get('/api/settings/storage', () => HttpResponse.json({ configured: false, config: null })),
  );
}

describe('AttachmentsSection — storage not configured', () => {
  it('shows the not-configured message', async () => {
    withStorageNotConfigured();
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('attachments-not-configured')).toBeInTheDocument();
    });
  });

  it('does not show the upload zone when storage is not configured', async () => {
    withStorageNotConfigured();
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('attachments-section')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('attachments-upload-zone')).not.toBeInTheDocument();
  });
});

describe('AttachmentsSection — storage configured', () => {
  it('shows the upload zone', async () => {
    withStorageConfigured();
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('attachments-upload-zone')).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no attachments', async () => {
    withStorageConfigured([]);
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('attachments-empty')).toBeInTheDocument();
    });
  });

  it('renders attachment rows', async () => {
    withStorageConfigured([ATTACHMENT_1, ATTACHMENT_2]);
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`attachment-row-${ATTACHMENT_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`attachment-row-${ATTACHMENT_2.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`attachment-filename-${ATTACHMENT_1.id}`)).toHaveTextContent(
      'proposal.pdf',
    );
  });

  it('renders a download link for each attachment', async () => {
    withStorageConfigured([ATTACHMENT_1]);
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      const link = screen.getByTestId(`attachment-download-${ATTACHMENT_1.id}`);
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('download', ATTACHMENT_1.filename);
    });
  });

  it('renders a delete button for each attachment', async () => {
    withStorageConfigured([ATTACHMENT_1]);
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`attachment-delete-${ATTACHMENT_1.id}`)).toBeInTheDocument();
    });
  });
});

describe('AttachmentsSection — delete confirmation dialog', () => {
  it('opens the confirmation dialog when delete is clicked', async () => {
    withStorageConfigured([ATTACHMENT_1]);
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`attachment-delete-${ATTACHMENT_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`attachment-delete-${ATTACHMENT_1.id}`));
    expect(screen.getByTestId('attachment-delete-dialog')).toBeInTheDocument();
  });

  it('closes the dialog on cancel', async () => {
    withStorageConfigured([ATTACHMENT_1]);
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      fireEvent.click(screen.getByTestId(`attachment-delete-${ATTACHMENT_1.id}`));
    });

    fireEvent.click(screen.getByTestId('attachment-delete-cancel'));
    expect(screen.queryByTestId('attachment-delete-dialog')).not.toBeInTheDocument();
  });

  it('removes the row and closes the dialog after confirmed delete', async () => {
    withStorageConfigured([ATTACHMENT_1]);
    server.use(
      http.delete(
        `/api/attachments/${ATTACHMENT_1.id}`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      fireEvent.click(screen.getByTestId(`attachment-delete-${ATTACHMENT_1.id}`));
    });

    // After confirming, the list will re-fetch. Set up the empty list response
    server.use(http.get('/api/attachments', () => HttpResponse.json({ attachments: [] })));

    fireEvent.click(screen.getByTestId('attachment-delete-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('attachment-delete-dialog')).not.toBeInTheDocument();
    });
  });
});

describe('AttachmentsSection — upload validation', () => {
  it('shows an error for oversized files before upload', async () => {
    withStorageConfigured([]);
    renderWithProviders(<AttachmentsSection recordType="contact" recordId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('attachments-upload-zone')).toBeInTheDocument();
    });

    // Simulate dropping an oversized file (26 MB)
    const oversizedFile = new File([new ArrayBuffer(26 * 1024 * 1024)], 'big.pdf', {
      type: 'application/pdf',
    });

    const dropZone = screen.getByTestId('attachments-upload-zone');
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [oversizedFile] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('attachments-upload-error')).toBeInTheDocument();
    });
  });
});
