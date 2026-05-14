/**
 * GdprPrivacySection component.
 * Displays GDPR & Privacy controls on contact and lead detail pages.
 * Visible to admin users only. (MINCRM-364)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import GdprEraseModal from '@/components/GdprEraseModal.js';
import {
  getGdprStatus,
  eraseContactGdpr,
  eraseLeadGdpr,
  downloadContactGdprExport,
  downloadLeadGdprExport,
  gdprStatusQueryKey,
} from '@/api/gdpr.js';
import { resolveApiError } from '@/utils/apiError.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';

interface GdprPrivacySectionProps {
  /** 'contact' or 'lead' */
  recordType: 'contact' | 'lead';
  /** UUID of the contact or lead */
  recordId: string;
  /** Called after a successful erasure so the parent can refresh its data */
  onErased: () => void;
}

/**
 * Admin-only section for GDPR right-to-erasure and data export on detail pages.
 */
export default function GdprPrivacySection({
  recordType,
  recordId,
  onErased,
}: GdprPrivacySectionProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [isEraseModalOpen, setIsEraseModalOpen] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const statusQueryKey = gdprStatusQueryKey(recordType, recordId);

  const { data: gdprStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: statusQueryKey,
    queryFn: () => getGdprStatus(recordType, recordId),
  });

  const eraseMutation = useMutation({
    mutationFn: (notes?: string) =>
      recordType === 'contact' ? eraseContactGdpr(recordId, notes) : eraseLeadGdpr(recordId, notes),
    onSuccess: () => {
      setIsEraseModalOpen(false);
      setEraseError(null);
      void queryClient.invalidateQueries({ queryKey: statusQueryKey });
      void queryClient.invalidateQueries({
        queryKey: [recordType === 'contact' ? 'contacts' : 'leads', recordId],
      });
      onErased();
    },
    onError: (err: unknown) => {
      setEraseError(resolveApiError(err, t));
    },
  });

  async function handleDownload(): Promise<void> {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      if (recordType === 'contact') {
        await downloadContactGdprExport(recordId);
      } else {
        await downloadLeadGdprExport(recordId);
      }
    } catch (err) {
      setDownloadError(resolveApiError(err, t));
    } finally {
      setIsDownloading(false);
    }
  }

  const isAlreadyErased = gdprStatus?.completed_at != null;

  return (
    <section
      className="mt-6"
      aria-labelledby="gdpr-section-heading"
      data-testid="gdpr-privacy-section"
    >
      <h2
        id="gdpr-section-heading"
        className="text-sm font-semibold text-gray-900 mb-3"
        data-testid="gdpr-privacy-heading"
      >
        {t('gdpr.sectionTitle')}
      </h2>

      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        {isStatusLoading ? (
          <p className="text-sm text-gray-500" data-testid="gdpr-status-loading">
            {t('gdpr.statusLoading')}
          </p>
        ) : isAlreadyErased ? (
          /* Erasure already completed — show informational banner */
          <div
            className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800"
            data-testid="gdpr-erased-banner"
          >
            <p className="font-semibold">{t('gdpr.alreadyErasedTitle')}</p>
            <p className="mt-1">
              {t('gdpr.alreadyErasedDescription', {
                date: formatLocalDate(gdprStatus!.completed_at!, i18n.language),
              })}
            </p>
          </div>
        ) : (
          /* Erasure available */
          <div>
            <p className="text-sm text-gray-600 mb-3">{t('gdpr.eraseDescription')}</p>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setEraseError(null);
                setIsEraseModalOpen(true);
              }}
              data-testid="gdpr-erase-button"
            >
              {t('gdpr.eraseButton')}
            </Button>
            {eraseError && (
              <p className="mt-2 text-sm text-red-600" data-testid="gdpr-erase-error">
                {eraseError}
              </p>
            )}
          </div>
        )}

        {/* Data export — always available regardless of erasure status */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-600 mb-3">{t('gdpr.exportDescription')}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleDownload()}
            disabled={isDownloading}
            data-testid="gdpr-export-button"
          >
            {isDownloading ? t('gdpr.exporting') : t('gdpr.exportButton')}
          </Button>
          {downloadError && (
            <p className="mt-2 text-sm text-red-600" data-testid="gdpr-download-error">
              {downloadError}
            </p>
          )}
        </div>
      </div>

      {isEraseModalOpen && (
        <GdprEraseModal
          isOpen={isEraseModalOpen}
          recordType={recordType}
          isErasing={eraseMutation.isPending}
          onConfirm={(notes) => eraseMutation.mutate(notes)}
          onCancel={() => setIsEraseModalOpen(false)}
        />
      )}
    </section>
  );
}
