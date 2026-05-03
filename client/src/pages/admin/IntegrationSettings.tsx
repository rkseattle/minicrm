/**
 * IntegrationSettings — File Storage configuration.
 * Extracted from AdminSettingsPage.tsx (MINCRM-259).
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getStorageConfig,
  setStorageConfig,
  clearStorageConfig,
  testStorageConfig,
  STORAGE_CONFIG_QUERY_KEY,
} from '@/api/attachments.js';
import { Button } from '@/components/ui/Button.js';
import WebhookSettings from '@/pages/admin/WebhookSettings.js';

export default function IntegrationSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    data: storageData,
    isLoading: storageLoading,
    isError: storageError,
  } = useQuery({
    queryKey: STORAGE_CONFIG_QUERY_KEY,
    queryFn: getStorageConfig,
  });

  const [storageForm, setStorageForm] = useState({
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
  });

  // Populate form from query data once loaded.
  useEffect(() => {
    if (storageData?.config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageForm((prev) => ({
        endpoint: storageData.config!.endpoint,
        bucket: storageData.config!.bucket,
        accessKeyId: storageData.config!.accessKeyId,
        // Keep a local secret field empty so user must re-enter to change
        secretAccessKey: prev.secretAccessKey,
      }));
    }
  }, [storageData]);

  const [storageTestStatus, setStorageTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>(
    'idle',
  );
  const [storageSaveSuccess, setStorageSaveSuccess] = useState(false);
  const [storageSaveError, setStorageSaveError] = useState(false);

  const storageSaveMutation = useMutation({
    mutationFn: setStorageConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONFIG_QUERY_KEY });
      setStorageSaveSuccess(true);
      setStorageSaveError(false);
      setStorageForm((prev) => ({ ...prev, secretAccessKey: '' }));
    },
    onError: () => {
      setStorageSaveError(true);
      setStorageSaveSuccess(false);
    },
  });

  const storageClearMutation = useMutation({
    mutationFn: clearStorageConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONFIG_QUERY_KEY });
      setStorageForm({ endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' });
      setStorageSaveSuccess(false);
      setStorageSaveError(false);
      setStorageTestStatus('idle');
    },
    onError: () => {
      setStorageSaveError(true);
    },
  });

  const handleStorageTest = useCallback(async (): Promise<void> => {
    setStorageTestStatus('testing');
    try {
      const result = await testStorageConfig(storageForm);
      setStorageTestStatus(result.success ? 'ok' : 'fail');
    } catch {
      setStorageTestStatus('fail');
    }
  }, [storageForm]);

  function handleStorageSave(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setStorageSaveSuccess(false);
    setStorageSaveError(false);
    storageSaveMutation.mutate(storageForm);
  }

  return (
    <>
      <div
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="storage-section"
      >
        <h2
          className="text-lg font-semibold text-gray-900 mb-1"
          data-testid="storage-section-title"
        >
          {t('settings.storage.sectionTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('settings.storage.sectionHint')}</p>

        {storageLoading && (
          <p className="text-sm text-gray-500" data-testid="storage-loading">
            {t('common.loading')}
          </p>
        )}

        {storageError && (
          <p role="alert" className="text-sm text-red-600" data-testid="storage-load-error">
            {t('settings.loadError')}
          </p>
        )}

        {!storageLoading && !storageError && (
          <form onSubmit={handleStorageSave} className="space-y-4">
            <div>
              <label
                htmlFor="storage-endpoint"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.storage.endpointLabel')}
              </label>
              <input
                id="storage-endpoint"
                type="text"
                data-testid="storage-endpoint-input"
                placeholder="https://s3.example.com"
                value={storageForm.endpoint}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, endpoint: e.target.value }))}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="storage-bucket"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.storage.bucketLabel')}
              </label>
              <input
                id="storage-bucket"
                type="text"
                data-testid="storage-bucket-input"
                value={storageForm.bucket}
                onChange={(e) => setStorageForm((prev) => ({ ...prev, bucket: e.target.value }))}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="storage-access-key-id"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.storage.accessKeyIdLabel')}
              </label>
              <input
                id="storage-access-key-id"
                type="text"
                data-testid="storage-access-key-id-input"
                value={storageForm.accessKeyId}
                onChange={(e) =>
                  setStorageForm((prev) => ({ ...prev, accessKeyId: e.target.value }))
                }
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="storage-secret-access-key"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.storage.secretAccessKeyLabel')}
              </label>
              {storageData?.configured && !storageForm.secretAccessKey && (
                <p className="text-xs text-gray-500 mb-1" data-testid="storage-secret-masked">
                  {t('settings.storage.secretMasked')}
                </p>
              )}
              <input
                id="storage-secret-access-key"
                type="password"
                data-testid="storage-secret-access-key-input"
                placeholder={storageData?.configured ? t('settings.storage.secretPlaceholder') : ''}
                value={storageForm.secretAccessKey}
                onChange={(e) =>
                  setStorageForm((prev) => ({ ...prev, secretAccessKey: e.target.value }))
                }
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {storageTestStatus === 'ok' && (
              <p role="status" className="text-sm text-green-700" data-testid="storage-test-ok">
                {t('settings.storage.testSuccess')}
              </p>
            )}
            {storageTestStatus === 'fail' && (
              <p role="alert" className="text-sm text-red-600" data-testid="storage-test-fail">
                {t('settings.storage.testFail')}
              </p>
            )}

            {storageSaveSuccess && (
              <p
                role="status"
                className="text-sm text-green-700"
                data-testid="storage-save-success"
              >
                {t('settings.storage.saveSuccess')}
              </p>
            )}
            {storageSaveError && (
              <p role="alert" className="text-sm text-red-600" data-testid="storage-save-error">
                {t('settings.storage.saveError')}
              </p>
            )}

            <div className="flex flex-wrap gap-3 justify-end">
              {storageData?.configured && (
                <Button
                  type="button"
                  variant="danger"
                  size="md"
                  data-testid="storage-clear-button"
                  disabled={storageClearMutation.isPending || storageSaveMutation.isPending}
                  onClick={() => storageClearMutation.mutate()}
                >
                  {storageClearMutation.isPending
                    ? t('common.loading')
                    : t('settings.storage.clearButton')}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="md"
                data-testid="storage-test-button"
                disabled={
                  storageTestStatus === 'testing' ||
                  storageSaveMutation.isPending ||
                  !storageForm.endpoint ||
                  !storageForm.bucket ||
                  !storageForm.accessKeyId ||
                  !storageForm.secretAccessKey
                }
                onClick={() => void handleStorageTest()}
              >
                {storageTestStatus === 'testing'
                  ? t('common.loading')
                  : t('settings.storage.testButton')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                data-testid="storage-save-button"
                disabled={
                  storageSaveMutation.isPending ||
                  !storageForm.endpoint ||
                  !storageForm.bucket ||
                  !storageForm.accessKeyId ||
                  !storageForm.secretAccessKey
                }
              >
                {storageSaveMutation.isPending
                  ? t('settings.saving')
                  : t('settings.storage.saveButton')}
              </Button>
            </div>
          </form>
        )}
      </div>

      <div
        className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="webhooks-section"
      >
        <WebhookSettings />
      </div>
    </>
  );
}
