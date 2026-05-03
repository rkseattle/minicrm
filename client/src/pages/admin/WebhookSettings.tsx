/**
 * WebhookSettings — Outbound webhook subscription management.
 * Rendered inside the Integrations tab of AdminSettingsPage. (MINCRM-279)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listWebhookSubscriptions,
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveryLogs,
  WEBHOOKS_QUERY_KEY,
  WEBHOOK_DELIVERY_LOGS_QUERY_KEY,
} from '@/api/webhooks.js';
import { Button } from '@/components/ui/Button.js';
import { WEBHOOK_EVENT_TYPES } from '@shared/schemas/webhookSchema.js';
import type {
  WebhookSubscriptionResponse,
  WebhookDeliveryLogResponse,
  WebhookEventType,
} from '@shared/schemas/webhookSchema.js';

// ── Add-webhook form state ─────────────────────────────────────────────────────

const EMPTY_FORM: { url: string; events: WebhookEventType[] } = { url: '', events: [] };

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'active' | 'failed' | 'disabled' }) {
  const { t } = useTranslation();
  const classes = {
    active: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    disabled: 'bg-gray-100 text-gray-700',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${classes[status]}`}
    >
      {t(`settings.webhooks.status${status.charAt(0).toUpperCase() + status.slice(1)}`)}
    </span>
  );
}

interface DeliveryLogsProps {
  subscription: WebhookSubscriptionResponse;
  onClose: () => void;
}

function DeliveryLogsPanel({ subscription, onClose }: DeliveryLogsProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: [...WEBHOOK_DELIVERY_LOGS_QUERY_KEY(subscription.id), page],
    queryFn: () => listWebhookDeliveryLogs(subscription.id, { page, limit: 20 }),
  });

  const logs: WebhookDeliveryLogResponse[] = data?.data ?? [];
  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="webhook-logs-panel"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {t('settings.webhooks.logsTitle')}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5 break-words">{subscription.url}</p>
          </div>
          <Button variant="ghost" onClick={onClose} data-testid="webhook-logs-close-button">
            {t('settings.webhooks.logsCloseButton')}
          </Button>
        </div>

        <div className="overflow-auto flex-1">
          {isLoading ? (
            <p className="px-6 py-4 text-sm text-gray-500">{t('common.loading')}</p>
          ) : logs.length === 0 ? (
            <p className="px-6 py-4 text-sm text-gray-500">{t('settings.webhooks.noLogs')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('settings.webhooks.attemptColumn')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('settings.webhooks.statusCodeColumn')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('settings.webhooks.responseTimeColumn')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('settings.webhooks.deliveredAtColumn')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase">
                    {t('settings.webhooks.errorColumn')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{log.attempt}</td>
                    <td className="px-4 py-3">
                      {log.status_code !== null ? (
                        <span
                          className={
                            log.status_code >= 200 && log.status_code < 300
                              ? 'text-green-700 font-medium'
                              : 'text-red-700 font-medium'
                          }
                        >
                          {log.status_code}
                        </span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {log.response_ms !== null ? `${log.response_ms}ms` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {new Date(log.delivered_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-red-600 break-words max-w-xs">
                      {log.error ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t">
            <Button
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              data-testid="webhook-logs-prev-button"
            >
              {t('common.previous')}
            </Button>
            <span className="text-sm text-gray-500">
              {t('pagination.pageOf', { page, total: totalPages })}
            </span>
            <Button
              variant="ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              data-testid="webhook-logs-next-button"
            >
              {t('common.next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface SecretRevealModalProps {
  secret: string;
  onDone: () => void;
}

function SecretRevealModal({ secret, onDone }: SecretRevealModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(secret);
    setCopied(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="webhook-secret-reveal"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          {t('settings.webhooks.secretTitle')}
        </h3>
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
          {t('settings.webhooks.secretHint')}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={secret}
            className="flex-1 font-mono text-sm border border-gray-300 rounded px-3 py-2 bg-gray-50 min-w-0"
            data-testid="webhook-secret-value"
          />
          <Button variant="secondary" onClick={handleCopy} data-testid="webhook-secret-copy-button">
            {copied ? '✓' : t('settings.webhooks.secretCopyButton')}
          </Button>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={onDone} data-testid="webhook-secret-done-button">
            {t('settings.webhooks.secretDoneButton')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WebhookSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<WebhookSubscriptionResponse | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: WEBHOOKS_QUERY_KEY,
    queryFn: listWebhookSubscriptions,
  });

  const subscriptions = data?.subscriptions ?? [];

  const createMutation = useMutation({
    mutationFn: createWebhookSubscription,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEY });
      setForm(EMPTY_FORM);
      setFormError(null);
      setRevealSecret(result.plaintextSecret);
      setSuccessMsg(t('settings.webhooks.createSuccess'));
    },
    onError: () => {
      setErrorMsg(t('settings.webhooks.createError'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data: d }: { id: string; data: { status: 'active' | 'disabled' } }) =>
      updateWebhookSubscription(id, d),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEY });
      setSuccessMsg(t('settings.webhooks.updateSuccess'));
    },
    onError: () => {
      setErrorMsg(t('settings.webhooks.updateError'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWebhookSubscription,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WEBHOOKS_QUERY_KEY });
      setDeleteConfirm(null);
      setSuccessMsg(t('settings.webhooks.deleteSuccess'));
    },
    onError: () => {
      setErrorMsg(t('settings.webhooks.deleteError'));
    },
  });

  function handleEventToggle(event: WebhookEventType) {
    setForm((prev) => {
      const events = prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event];
      return { ...prev, events };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!form.url.trim()) {
      setFormError(t('settings.webhooks.urlLabel'));
      return;
    }
    if (form.events.length === 0) {
      setFormError(t('settings.webhooks.eventsLabel'));
      return;
    }

    createMutation.mutate({ url: form.url.trim(), events: form.events });
  }

  function handleToggleStatus(sub: WebhookSubscriptionResponse) {
    if (updateMutation.isPending) return;
    const newStatus = sub.status === 'active' ? 'disabled' : 'active';
    updateMutation.mutate({ id: sub.id, data: { status: newStatus } });
  }

  function handleDeleteConfirm() {
    if (deleteConfirm) {
      deleteMutation.mutate(deleteConfirm);
    }
  }

  return (
    <div data-testid="webhook-settings-section">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        {t('settings.webhooks.sectionTitle')}
      </h2>
      <p className="text-sm text-gray-600 mb-4">{t('settings.webhooks.sectionHint')}</p>

      {/* Feedback messages */}
      {successMsg && (
        <p
          className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2"
          data-testid="webhook-success-msg"
        >
          {successMsg}
        </p>
      )}
      {errorMsg && (
        <p
          className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2"
          data-testid="webhook-error-msg"
        >
          {errorMsg}
        </p>
      )}

      {/* Subscription list */}
      {isError ? (
        <p className="text-sm text-red-600" data-testid="webhook-load-error">
          {t('settings.webhooks.loadError')}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : subscriptions.length === 0 ? (
        <p className="text-sm text-gray-500 mb-4" data-testid="webhook-empty-state">
          {t('settings.webhooks.noSubscriptions')}
        </p>
      ) : (
        <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm" data-testid="webhook-subscriptions-table">
            <tbody className="divide-y divide-gray-100">
              {subscriptions.map((sub) => (
                <tr key={sub.id} data-testid={`webhook-row-${sub.id}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 min-w-0">
                    <p className="font-medium text-gray-900 break-words">{sub.url}</p>
                    <p className="text-xs text-gray-500 mt-0.5 break-words">
                      {sub.events.join(', ')}
                    </p>
                    {sub.status === 'failed' && (
                      <p className="text-xs text-red-700 mt-1">
                        {t('settings.webhooks.failedBanner')}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge status={sub.status} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLogsFor(sub)}
                        data-testid={`webhook-logs-button-${sub.id}`}
                      >
                        {t('settings.webhooks.logsButton')}
                      </Button>
                      {sub.status !== 'failed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleStatus(sub)}
                          disabled={updateMutation.isPending}
                          data-testid={`webhook-toggle-button-${sub.id}`}
                        >
                          {sub.status === 'active'
                            ? t('settings.webhooks.disableButton')
                            : t('settings.webhooks.enableButton')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirm(sub.id)}
                        data-testid={`webhook-delete-button-${sub.id}`}
                      >
                        {t('settings.webhooks.deleteButton')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add webhook form */}
      <form onSubmit={handleSubmit} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
        <div className="mb-3">
          <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700 mb-1">
            {t('settings.webhooks.urlLabel')}
          </label>
          <input
            id="webhook-url"
            type="url"
            value={form.url}
            onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
            placeholder={t('settings.webhooks.urlPlaceholder')}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="webhook-url-input"
          />
        </div>

        <div className="mb-3">
          <p className="text-sm font-medium text-gray-700 mb-2">
            {t('settings.webhooks.eventsLabel')}
          </p>
          <div
            className="grid grid-cols-2 sm:grid-cols-3 gap-1"
            data-testid="webhook-events-select"
          >
            {WEBHOOK_EVENT_TYPES.map((event) => (
              <label key={event} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.events.includes(event)}
                  onChange={() => handleEventToggle(event)}
                  data-testid={`webhook-event-${event}`}
                />
                <span className="text-xs text-gray-700">{event}</span>
              </label>
            ))}
          </div>
        </div>

        {formError && <p className="text-sm text-red-600 mb-2">{formError}</p>}

        <Button type="submit" disabled={createMutation.isPending} data-testid="webhook-add-button">
          {createMutation.isPending ? t('common.saving') : t('settings.webhooks.addButton')}
        </Button>
      </form>

      {/* Secret reveal modal */}
      {revealSecret && (
        <SecretRevealModal secret={revealSecret} onDone={() => setRevealSecret(null)} />
      )}

      {/* Delivery logs panel */}
      {logsFor && <DeliveryLogsPanel subscription={logsFor} onClose={() => setLogsFor(null)} />}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="webhook-delete-confirm"
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              {t('settings.webhooks.deleteConfirmTitle')}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {t('settings.webhooks.deleteConfirmMessage')}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setDeleteConfirm(null)}
                data-testid="webhook-delete-cancel-button"
              >
                {t('settings.webhooks.cancelAction')}
              </Button>
              <Button
                onClick={handleDeleteConfirm}
                disabled={deleteMutation.isPending}
                data-testid="webhook-delete-confirm-button"
              >
                {t('settings.webhooks.confirmAction')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
