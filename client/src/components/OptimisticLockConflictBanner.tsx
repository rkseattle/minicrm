/**
 * OptimisticLockConflictBanner — shown when a PATCH returns 409 OPTIMISTIC_LOCK_CONFLICT.
 * Informs the user that another writer beat them, preserves their unsaved changes,
 * and offers Re-save and Discard actions. (MINCRM-349)
 */

import { useTranslation } from 'react-i18next';

interface Props {
  onResave: () => void;
  onDiscard: () => void;
}

export default function OptimisticLockConflictBanner({ onResave, onDiscard }: Props) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      data-testid="optimistic-lock-conflict-banner"
      className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
    >
      <p className="mb-2">{t('errors.optimisticLockConflict')}</p>
      <div className="flex gap-3">
        <button
          type="button"
          data-testid="optimistic-lock-resave-button"
          onClick={onResave}
          className="rounded bg-yellow-700 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-800 focus:outline-none focus:ring-2 focus:ring-yellow-600"
        >
          {t('errors.optimisticLockResave')}
        </button>
        <button
          type="button"
          data-testid="optimistic-lock-discard-button"
          onClick={onDiscard}
          className="rounded border border-yellow-600 px-3 py-1 text-xs font-medium text-yellow-800 hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-600"
        >
          {t('errors.optimisticLockDiscard')}
        </button>
      </div>
    </div>
  );
}
