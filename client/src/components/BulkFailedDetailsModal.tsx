/**
 * BulkFailedDetailsModal — shows a table of per-record failures from a partial-success
 * bulk operation so admins can see which IDs failed and why.
 * (MINCRM-562)
 */

import { useTranslation } from 'react-i18next';
import type { BulkFailure } from '@/api/bulk.js';

interface BulkFailedDetailsModalProps {
  isOpen: boolean;
  failures: BulkFailure[];
  onClose: () => void;
}

export default function BulkFailedDetailsModal({
  isOpen,
  failures,
  onClose,
}: BulkFailedDetailsModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="bulk-failed-details-modal"
      onClick={onClose}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="bulk-failed-details-title"
        className="relative w-full max-w-lg mx-4 p-0"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="bulk-failed-details-title" className="text-base font-semibold text-gray-900 mb-4">
            {t('bulk.failedDetailsTitle')}
          </h2>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {t('bulk.failedDetailsId')}
                </th>
                <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide ps-4">
                  {t('bulk.failedDetailsReason')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {failures.map((failure, i) => (
                <tr key={failure.id} data-testid={`bulk-failed-details-row-${i}`}>
                  <td className="py-2 font-mono text-xs text-gray-700 break-all">{failure.id}</td>
                  <td className="py-2 ps-4 text-gray-600">{failure.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6">
            <button
              type="button"
              data-testid="bulk-failed-details-close"
              onClick={onClose}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {t('common.dismiss')}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
