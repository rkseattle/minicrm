/**
 * AttachmentsSection component.
 * Renders an upload zone, attachment list, and delete confirmation dialog
 * for a contact, account, or deal detail page. (MINCRM-167, MINCRM-169)
 *
 * If storage is not configured, a message is shown instead of upload controls.
 */

import { useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  getDownloadUrl,
  getStorageConfig,
  attachmentsQueryKey,
  STORAGE_CONFIG_QUERY_KEY,
  type RecordType,
  type Attachment,
} from '@/api/attachments.js';
import { Button } from '@/components/ui/Button.js';

/** Maximum file size in bytes (25 MB) — mirrored from server for pre-flight check. */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Accepted MIME types for the file input filter. */
const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain',
].join(',');

/** Formats a byte count as a human-readable string (e.g. "1.2 MB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Formats an ISO timestamp as a locale date+time string. */
function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export interface AttachmentsSectionProps {
  /** The type of the parent record. */
  recordType: RecordType;
  /** UUID of the parent record. */
  recordId: string;
}

/**
 * Renders the attachments panel for a record detail page.
 *
 * @param recordType - Type of the parent record.
 * @param recordId - UUID of the parent record.
 */
export default function AttachmentsSection({ recordType, recordId }: AttachmentsSectionProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const queryKey = attachmentsQueryKey(recordType, recordId);

  // Check whether storage is configured
  const { data: storageData, isLoading: storageLoading } = useQuery({
    queryKey: STORAGE_CONFIG_QUERY_KEY,
    queryFn: getStorageConfig,
  });

  const storageConfigured = storageData?.configured ?? false;

  // Attachment list
  const {
    data: attachmentsData,
    isLoading: attachmentsLoading,
    isError: attachmentsError,
  } = useQuery({
    queryKey,
    queryFn: () => listAttachments(recordType, recordId),
    enabled: storageConfigured,
  });

  const attachments: Attachment[] = attachmentsData ?? [];

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAttachment(recordType, recordId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      setUploadError(null);
    },
    onError: (err: { response?: { data?: { error?: { code?: string; message?: string } } } }) => {
      const serverCode = err.response?.data?.error?.code;
      if (serverCode === 'STORAGE_CAP_EXCEEDED') {
        setUploadError(t('attachments.errorStorageCap'));
      } else if (serverCode === 'VALIDATION_ERROR') {
        setUploadError(t('attachments.errorFileType'));
      } else {
        setUploadError(t('attachments.errorUpload'));
      }
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAttachment(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      setPendingDeleteId(null);
      setDeleteError(null);
    },
    onError: () => {
      setDeleteError(t('attachments.errorDelete'));
    },
  });

  /** Validates and triggers upload for a File object. */
  const handleFile = useCallback(
    (file: File) => {
      setUploadError(null);
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setUploadError(t('attachments.errorFileTooLarge'));
        return;
      }
      uploadMutation.mutate(file);
    },
    [uploadMutation, t],
  );

  /** Handles file input change. */
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-uploaded if needed
    e.target.value = '';
  }

  /** Handles drag-and-drop. */
  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(): void {
    setIsDragging(false);
  }

  if (storageLoading) {
    return (
      <div
        className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6"
        data-testid="attachments-section"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t('attachments.sectionTitle')}
        </h2>
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div
      className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6"
      data-testid="attachments-section"
    >
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('attachments.sectionTitle')}</h2>

      {/* Storage not configured message */}
      {!storageConfigured && (
        <p className="text-sm text-gray-500" data-testid="attachments-not-configured">
          {t('attachments.notConfigured')}
        </p>
      )}

      {/* Upload zone — only shown when storage is configured */}
      {storageConfigured && (
        <>
          {/* Drag-and-drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label={t('attachments.uploadZoneLabel')}
            data-testid="attachments-upload-zone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
            className={[
              'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4',
              isDragging
                ? 'border-indigo-400 bg-indigo-50'
                : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50',
              uploadMutation.isPending ? 'opacity-50 pointer-events-none' : '',
            ].join(' ')}
          >
            <p className="text-sm text-gray-600">
              {uploadMutation.isPending
                ? t('attachments.uploading')
                : t('attachments.uploadZoneHint')}
            </p>
            <p className="text-xs text-gray-400 mt-1">{t('attachments.uploadZoneTypes')}</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME}
            className="sr-only"
            data-testid="attachments-file-input"
            onChange={handleInputChange}
            aria-hidden="true"
          />

          {uploadError && (
            <p
              role="alert"
              className="text-sm text-red-600 mb-4"
              data-testid="attachments-upload-error"
            >
              {uploadError}
            </p>
          )}

          {/* Attachment list */}
          {attachmentsLoading && (
            <p className="text-sm text-gray-500" data-testid="attachments-loading">
              {t('common.loading')}
            </p>
          )}

          {attachmentsError && (
            <p role="alert" className="text-sm text-red-600" data-testid="attachments-list-error">
              {t('attachments.errorLoad')}
            </p>
          )}

          {!attachmentsLoading && !attachmentsError && attachments.length === 0 && (
            <p className="text-sm text-gray-400" data-testid="attachments-empty">
              {t('attachments.empty')}
            </p>
          )}

          {!attachmentsLoading && !attachmentsError && attachments.length > 0 && (
            <ul className="divide-y divide-gray-100" data-testid="attachments-list">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center justify-between py-3 gap-4"
                  data-testid={`attachment-row-${attachment.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium text-gray-900 truncate"
                      data-testid={`attachment-filename-${attachment.id}`}
                    >
                      {attachment.filename}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatBytes(attachment.file_size)}
                      {attachment.uploader_name ? ` · ${attachment.uploader_name}` : ''}
                      {` · ${formatDateTime(attachment.uploaded_at, i18n.language)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={getDownloadUrl(attachment.id)}
                      download={attachment.filename}
                      data-testid={`attachment-download-${attachment.id}`}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium focus:outline-none focus:underline"
                    >
                      {t('attachments.download')}
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`attachment-delete-${attachment.id}`}
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDeleteId(attachment.id);
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Delete confirmation dialog */}
      {pendingDeleteId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="attachment-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="attachment-delete-dialog"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 id="attachment-delete-title" className="text-base font-semibold text-gray-900 mb-2">
              {t('attachments.deleteConfirmTitle')}
            </h3>
            <p className="text-sm text-gray-600 mb-4">{t('attachments.deleteConfirmMessage')}</p>

            {deleteError && (
              <p
                role="alert"
                className="text-sm text-red-600 mb-4"
                data-testid="attachment-delete-error"
              >
                {deleteError}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                data-testid="attachment-delete-cancel"
                onClick={() => {
                  setPendingDeleteId(null);
                  setDeleteError(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="md"
                data-testid="attachment-delete-confirm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(pendingDeleteId)}
              >
                {deleteMutation.isPending ? t('common.loading') : t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
