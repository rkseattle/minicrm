/**
 * DataSettings — Import Data, Demo Data, and Audit Log link.
 * Extracted from AdminSettingsPage.tsx (MINCRM-259).
 */

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import CsvImporter from '@/components/CsvImporter.js';
import {
  getDemoStatus,
  seedDemoData,
  resetDemoData,
  removeDemoData,
  DEMO_STATUS_QUERY_KEY,
} from '@/api/demo.js';
import { Button } from '@/components/ui/Button.js';

type DemoAction = 'seed' | 'reset' | 'remove';
type ImportTab = 'accounts' | 'contacts' | 'deals';

export default function DataSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ── Import Data ──────────────────────────────────────────────────────────────

  const [importTab, setImportTab] = useState<ImportTab>('accounts');

  // ── Demo data ────────────────────────────────────────────────────────────────

  const {
    data: demoStatus,
    isLoading: demoStatusLoading,
    isError: demoStatusError,
  } = useQuery({
    queryKey: DEMO_STATUS_QUERY_KEY,
    queryFn: getDemoStatus,
  });

  const [pendingAction, setPendingAction] = useState<DemoAction | null>(null);
  const [demoFeedback, setDemoFeedback] = useState<{
    type: 'success' | 'error';
    key: string;
  } | null>(null);

  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (demoFeedback) {
      feedbackRef.current?.focus();
    }
  }, [demoFeedback]);

  const seedMutation = useMutation({
    mutationFn: seedDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.seedSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.seedError' });
    },
  });

  const resetMutation = useMutation({
    mutationFn: resetDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.resetSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.resetError' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.removeSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.removeError' });
    },
  });

  const isDemoMutating =
    seedMutation.isPending || resetMutation.isPending || removeMutation.isPending;

  function openConfirm(action: DemoAction): void {
    setDemoFeedback(null);
    setPendingAction(action);
  }

  function closeConfirm(): void {
    setPendingAction(null);
  }

  function executeAction(): void {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'seed') seedMutation.mutate();
    else if (action === 'reset') resetMutation.mutate();
    else removeMutation.mutate();
  }

  const demoActive = demoStatus?.active ?? false;

  return (
    <>
      {/* ── Import Data section ───────────────────────────────────────────── */}
      <div
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="import-section"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-1" data-testid="import-section-title">
          {t('settings.import.sectionTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('settings.import.sectionHint')}</p>

        <div
          className="flex overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-6"
          role="tablist"
          aria-label={t('settings.import.sectionTitle')}
        >
          {(['accounts', 'contacts', 'deals'] as ImportTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={importTab === tab}
              aria-controls={`import-panel-${tab}`}
              id={`import-tab-${tab}`}
              data-testid={`import-tab-${tab}`}
              onClick={() => {
                if (importTab !== tab) setImportTab(tab);
              }}
              className={[
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500',
                importTab === tab
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              {t(`settings.import.tab.${tab}`)}
            </button>
          ))}
        </div>

        {(['accounts', 'contacts', 'deals'] as ImportTab[]).map((tab) => (
          <div
            key={tab}
            role="tabpanel"
            id={`import-panel-${tab}`}
            aria-labelledby={`import-tab-${tab}`}
            hidden={importTab !== tab}
            data-testid={`import-panel-${tab}`}
          >
            {tab === 'accounts' && (
              <>
                <p className="text-xs text-gray-500 mb-4">{t('settings.import.accounts.hint')}</p>
                <CsvImporter
                  entity="accounts"
                  entityLabel={t('settings.import.tab.accounts')}
                  options={[
                    {
                      key: 'skip_duplicates',
                      label: t('settings.import.accounts.skipDuplicates'),
                      defaultValue: true,
                    },
                  ]}
                />
              </>
            )}
            {tab === 'contacts' && (
              <>
                <p className="text-xs text-gray-500 mb-4">{t('settings.import.contacts.hint')}</p>
                <CsvImporter entity="contacts" entityLabel={t('settings.import.tab.contacts')} />
              </>
            )}
            {tab === 'deals' && (
              <>
                <p className="text-xs text-gray-500 mb-4">{t('settings.import.deals.hint')}</p>
                <CsvImporter
                  entity="deals"
                  entityLabel={t('settings.import.tab.deals')}
                  options={[
                    {
                      key: 'skip_unresolvable_accounts',
                      label: t('settings.import.deals.skipUnresolvableAccounts'),
                      defaultValue: false,
                    },
                  ]}
                />
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Demo Data section ─────────────────────────────────────────────── */}
      <div
        className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="demo-section"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-1" data-testid="demo-section-title">
          {t('settings.demo.sectionTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('settings.demo.sectionHint')}</p>

        {demoStatusLoading && (
          <p className="text-sm text-gray-500 mb-4" data-testid="demo-status-loading">
            {t('settings.demo.statusLoading')}
          </p>
        )}
        {demoStatusError && (
          <p role="alert" className="text-sm text-red-600 mb-4" data-testid="demo-status-error">
            {t('settings.demo.statusError')}
          </p>
        )}
        {!demoStatusLoading && !demoStatusError && (
          <p className="text-sm mb-4" data-testid="demo-status-badge">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                demoActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {demoActive ? t('settings.demo.statusActive') : t('settings.demo.statusInactive')}
            </span>
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            data-testid="demo-seed-button"
            disabled={isDemoMutating || demoActive}
            onClick={() => openConfirm('seed')}
          >
            {seedMutation.isPending ? t('common.loading') : t('settings.demo.seedButton')}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            data-testid="demo-reset-button"
            disabled={isDemoMutating}
            onClick={() => openConfirm('reset')}
          >
            {resetMutation.isPending ? t('common.loading') : t('settings.demo.resetButton')}
          </Button>

          <Button
            type="button"
            variant="danger"
            size="md"
            data-testid="demo-remove-button"
            disabled={isDemoMutating || !demoActive}
            onClick={() => openConfirm('remove')}
          >
            {removeMutation.isPending ? t('common.loading') : t('settings.demo.removeButton')}
          </Button>
        </div>

        {demoFeedback && (
          <p
            ref={feedbackRef}
            tabIndex={-1}
            role={demoFeedback.type === 'error' ? 'alert' : 'status'}
            className={`mt-4 text-sm ${demoFeedback.type === 'success' ? 'text-green-700' : 'text-red-600'}`}
            data-testid="demo-feedback"
          >
            {t(demoFeedback.key)}
          </p>
        )}
      </div>

      {/* ── Audit Log section (MINCRM-172) ───────────────────────────────── */}
      <div
        className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="audit-log-section"
      >
        <h2
          className="text-lg font-semibold text-gray-900 mb-1"
          data-testid="audit-log-section-title"
        >
          {t('auditLog.heading')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('auditLog.sectionHint')}</p>
        <Link
          to="/admin/audit-log"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
          data-testid="audit-log-link"
        >
          {t('auditLog.navLink')}
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* ── Demo confirmation dialog ────────────────────────────────────────── */}
      {pendingAction && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="demo-confirm-dialog"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3
              id="demo-confirm-title"
              className="text-base font-semibold text-gray-900 mb-2"
              data-testid="demo-confirm-title"
            >
              {t(`settings.demo.${pendingAction}ConfirmTitle`)}
            </h3>
            <p className="text-sm text-gray-600 mb-6" data-testid="demo-confirm-message">
              {t(`settings.demo.${pendingAction}ConfirmMessage`)}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                data-testid="demo-confirm-cancel"
                onClick={closeConfirm}
              >
                {t('settings.demo.cancelAction')}
              </Button>
              <Button
                type="button"
                variant={pendingAction === 'seed' ? 'primary' : 'danger'}
                size="md"
                data-testid="demo-confirm-ok"
                onClick={executeAction}
              >
                {t('settings.demo.confirmAction')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
