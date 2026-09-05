/**
 * Connected Accounts panel — per-user mailbox connections on the profile page.
 *
 * Hidden entirely when the email_sync flag is off. Disabled-not-hidden is the convention
 * for admin panels, where an administrator needs to see what exists in order to enable it;
 * this is an end-user surface, where a permanently dead card is only confusing.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import type {
  ConnectedAccountResponse,
  ConnectedAccountStatus,
} from '@shared/schemas/connectedAccountSchema.js';
import {
  SYNC_FAILED_DETAIL,
  TEST_REQUEST_FAILED,
  UNTESTABLE_PROVIDER,
} from '@shared/schemas/connectedAccountSchema.js';

import {
  CONNECTED_ACCOUNTS_QUERY_KEY,
  createImapAccount,
  deleteConnectedAccount,
  getConnectedAccounts,
  oauthStartUrl,
  testConnectedAccount,
} from '@/api/connectedAccounts.js';
import { Capability } from '@shared/schemas/capabilitySchema.js';

import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { usePermissions } from '@/hooks/usePermissions.js';

/** Default IMAPS port, which is what almost every provider expects. */
const DEFAULT_IMAP_PORT = 993;

const STATUS_VARIANT: Record<ConnectedAccountStatus, 'success' | 'error' | 'neutral'> = {
  active: 'success',
  error: 'error',
  disconnected: 'neutral',
};

/** Test answers no row will ever carry, so a healthy row does not supersede them. */
const SURVIVES_HEALTHY_ROW: readonly string[] = [UNTESTABLE_PROVIDER, TEST_REQUEST_FAILED];

export default function ConnectedAccountsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { enabled: emailSyncEnabled } = useFeatureFlag('email_sync');
  const { can } = usePermissions();
  // Without this a viewer sees the whole panel and every control fails: the OAuth links
  // bounce back with INSUFFICIENT_CAPABILITY and the IMAP form reports a credentials
  // problem, which is a lie — the credentials were fine.
  const canManage = can(Capability.ConnectedAccountsManage);

  const [searchParams, setSearchParams] = useSearchParams();
  // The OAuth legs are full page navigations, so their only channel back is the URL.
  const connectResult = searchParams.get('connect');

  const [showImapForm, setShowImapForm] = useState(false);
  const [confirmingDisconnectId, setConfirmingDisconnectId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [imapForm, setImapForm] = useState({
    email_address: '',
    host: '',
    port: String(DEFAULT_IMAP_PORT),
    username: '',
    password: '',
    secure: true,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: CONNECTED_ACCOUNTS_QUERY_KEY,
    queryFn: getConnectedAccounts,
    enabled: emailSyncEnabled && canManage,
  });

  const connectMutation = useMutation({
    mutationFn: createImapAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONNECTED_ACCOUNTS_QUERY_KEY });
      setShowImapForm(false);
      setFormError(null);
      setImapForm({
        email_address: '',
        host: '',
        port: String(DEFAULT_IMAP_PORT),
        username: '',
        password: '',
        secure: true,
      });
    },
    onError: () => setFormError(t('connectedAccounts.connectError')),
  });

  const [testResult, setTestResult] = useState<{ id: string; error: string } | null>(null);

  const testMutation = useMutation({
    mutationFn: testConnectedAccount,
    // Cleared first so a second attempt cannot leave the previous answer on screen while
    // it runs, or after it fails before any response arrives.
    onMutate: () => setTestResult(null),
    // A provider with no test of its own writes nothing to the row, so the answer exists
    // only in this response — without reading it the button does nothing visible at all.
    onSuccess: (result, accountId) => {
      setTestResult(
        result.success ? null : { id: accountId, error: result.error ?? SYNC_FAILED_DETAIL },
      );
    },
    // The request to MiniCRM failed, so the provider was never asked — saying it was
    // unreachable would point the user at the wrong system.
    onError: (_err, accountId) => setTestResult({ id: accountId, error: TEST_REQUEST_FAILED }),
    // The row's status is what the server just recorded, so re-read rather than guess.
    onSettled: () => queryClient.invalidateQueries({ queryKey: CONNECTED_ACCOUNTS_QUERY_KEY }),
  });

  /**
   * Turns a server-recorded code into a sentence in the viewer's language.
   *
   * The fallback matters: codes are written by the server, and a build may have no key for
   * one it has never seen — that must degrade to a generic reason, not a raw token.
   */
  function resultMessage(code: string | null, fallback: string = SYNC_FAILED_DETAIL): string {
    return t(`connectedAccounts.results.${code ?? fallback}`, {
      defaultValue: t(`connectedAccounts.results.${fallback}`),
    });
  }

  /**
   * The reason to show for one mailbox, or null when there is nothing to say.
   *
   * A just-pressed Test wins over the stored column: it is the fresher answer, and for a
   * provider that writes no row it is the only one.
   */
  function reasonFor(account: ConnectedAccountResponse): string | null {
    // One element, not two: a second one rendering on the complement of this condition is
    // how a superseded answer reappears under a healthy badge.
    //
    // Two answers survive a healthy row, because for them the row was never going to say
    // anything: the server writes nothing for a provider it cannot test, and a request
    // that failed never reached the server at all. Every other test answer is superseded
    // by what the row reports.
    if (account.status === 'error') {
      // The row's own reason is the newer fact whenever it has one; a test answer only
      // fills in for a row that has not been written since.
      if (account.status_detail !== null) return account.status_detail;
      if (testResult?.id === account.id) return testResult.error;
      return null;
    }
    if (testResult?.id === account.id && SURVIVES_HEALTHY_ROW.includes(testResult.error)) {
      return testResult.error;
    }
    return null;
  }

  const disconnectMutation = useMutation({
    mutationFn: deleteConnectedAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONNECTED_ACCOUNTS_QUERY_KEY });
      setConfirmingDisconnectId(null);
    },
  });

  if (!emailSyncEnabled || !canManage) return null;

  const accounts: ConnectedAccountResponse[] = data?.accounts ?? [];

  return (
    <div
      className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
      data-testid="connected-accounts-section"
    >
      <h2
        className="text-lg font-semibold text-gray-900 mb-1"
        data-testid="connected-accounts-title"
      >
        {t('connectedAccounts.sectionTitle')}
      </h2>
      <p className="text-xs text-gray-500 mb-4">{t('connectedAccounts.sectionHint')}</p>

      {connectResult && (
        <p
          role={connectResult === 'connected' ? 'status' : 'alert'}
          className={`mb-4 text-sm break-words ${
            connectResult === 'connected' ? 'text-green-700' : 'text-red-600'
          }`}
          data-testid="connected-accounts-connect-result"
        >
          {resultMessage(connectResult, 'OAUTH_FAILED')}{' '}
          <button
            type="button"
            className="underline"
            data-testid="connected-accounts-dismiss-result"
            onClick={() => {
              // Cleared from the URL so a refresh does not re-announce a stale outcome.
              searchParams.delete('connect');
              setSearchParams(searchParams, { replace: true });
            }}
          >
            {t('common.dismiss')}
          </button>
        </p>
      )}

      {isLoading && (
        <p className="text-sm text-gray-500" data-testid="connected-accounts-loading">
          {t('connectedAccounts.loading')}
        </p>
      )}

      {isError && (
        <p
          role="alert"
          className="text-sm text-red-600"
          data-testid="connected-accounts-load-error"
        >
          {t('connectedAccounts.loadError')}
        </p>
      )}

      {!isLoading && !isError && accounts.length === 0 && (
        <p className="text-sm text-gray-500" data-testid="connected-accounts-empty">
          {t('connectedAccounts.empty')}
        </p>
      )}

      {accounts.length > 0 && (
        <ul className="divide-y divide-gray-100 mb-4">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center gap-3 py-3"
              data-testid={`connected-account-row-${account.id}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 break-words">{account.email_address}</p>
                <p className="text-xs text-gray-500">
                  {t(`connectedAccounts.providers.${account.provider}`)}
                </p>
              </div>

              <div className="flex flex-col items-start gap-1 min-w-0">
                <Badge
                  variant={STATUS_VARIANT[account.status]}
                  data-testid={`connected-account-status-${account.id}`}
                >
                  {t(`connectedAccounts.statuses.${account.status}`)}
                </Badge>
                {reasonFor(account) !== null ? (
                  <p
                    className="text-xs text-red-600 break-words"
                    // status, not alert: this renders from a stored row, so on page load
                    // every errored mailbox would interrupt a screen reader at once.
                    role="status"
                    data-testid={`connected-account-status-detail-${account.id}`}
                  >
                    {resultMessage(reasonFor(account))}
                  </p>
                ) : null}
              </div>

              {confirmingDisconnectId === account.id ? (
                <div
                  className="flex items-center gap-2"
                  data-testid={`connected-account-disconnect-confirm-${account.id}`}
                >
                  <span className="text-xs text-gray-700">
                    {t('connectedAccounts.disconnectConfirmPrompt')}
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    data-testid={`connected-account-disconnect-confirm-button-${account.id}`}
                    disabled={disconnectMutation.isPending}
                    onClick={() => disconnectMutation.mutate(account.id)}
                  >
                    {t('connectedAccounts.disconnectConfirmButton')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid={`connected-account-disconnect-cancel-button-${account.id}`}
                    onClick={() => setConfirmingDisconnectId(null)}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid={`connected-account-test-button-${account.id}`}
                    disabled={testMutation.isPending}
                    onClick={() => testMutation.mutate(account.id)}
                  >
                    {t('connectedAccounts.testButton')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    data-testid={`connected-account-disconnect-button-${account.id}`}
                    onClick={() => setConfirmingDisconnectId(account.id)}
                  >
                    {t('connectedAccounts.disconnectButton')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
        {/* A full navigation, not an XHR: the provider's consent screen must render. */}
        <a
          href={oauthStartUrl('google')}
          className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          data-testid="connected-accounts-connect-google"
        >
          {t('connectedAccounts.connectGoogle')}
        </a>
        <a
          href={oauthStartUrl('microsoft')}
          className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          data-testid="connected-accounts-connect-microsoft"
        >
          {t('connectedAccounts.connectMicrosoft')}
        </a>
        <Button
          type="button"
          variant="secondary"
          size="md"
          data-testid="connected-accounts-show-imap-form"
          onClick={() => setShowImapForm((open) => !open)}
        >
          {t('connectedAccounts.connectImap')}
        </Button>
      </div>

      {showImapForm && (
        <form
          className="mt-4 space-y-3"
          data-testid="connected-accounts-imap-form"
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);
            connectMutation.mutate({
              email_address: imapForm.email_address,
              host: imapForm.host,
              port: Number(imapForm.port),
              username: imapForm.username,
              password: imapForm.password,
              secure: imapForm.secure,
            });
          }}
        >
          <div>
            <label htmlFor="imap-email" className="block text-xs font-medium text-gray-700 mb-1">
              {t('connectedAccounts.emailLabel')}
            </label>
            <input
              id="imap-email"
              type="email"
              required
              data-testid="connected-accounts-imap-email"
              value={imapForm.email_address}
              onChange={(event) =>
                setImapForm((form) => ({ ...form, email_address: event.target.value }))
              }
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-0">
              <label htmlFor="imap-host" className="block text-xs font-medium text-gray-700 mb-1">
                {t('connectedAccounts.hostLabel')}
              </label>
              <input
                id="imap-host"
                type="text"
                required
                data-testid="connected-accounts-imap-host"
                value={imapForm.host}
                onChange={(event) => setImapForm((form) => ({ ...form, host: event.target.value }))}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="w-24">
              <label htmlFor="imap-port" className="block text-xs font-medium text-gray-700 mb-1">
                {t('connectedAccounts.portLabel')}
              </label>
              <input
                id="imap-port"
                type="number"
                required
                data-testid="connected-accounts-imap-port"
                value={imapForm.port}
                onChange={(event) => setImapForm((form) => ({ ...form, port: event.target.value }))}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="imap-username" className="block text-xs font-medium text-gray-700 mb-1">
              {t('connectedAccounts.usernameLabel')}
            </label>
            <input
              id="imap-username"
              type="text"
              required
              data-testid="connected-accounts-imap-username"
              value={imapForm.username}
              onChange={(event) =>
                setImapForm((form) => ({ ...form, username: event.target.value }))
              }
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="imap-password" className="block text-xs font-medium text-gray-700 mb-1">
              {t('connectedAccounts.passwordLabel')}
            </label>
            <input
              id="imap-password"
              type="password"
              required
              data-testid="connected-accounts-imap-password"
              value={imapForm.password}
              onChange={(event) =>
                setImapForm((form) => ({ ...form, password: event.target.value }))
              }
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              data-testid="connected-accounts-imap-secure"
              checked={imapForm.secure}
              onChange={(event) =>
                setImapForm((form) => ({ ...form, secure: event.target.checked }))
              }
            />
            {t('connectedAccounts.secureLabel')}
          </label>

          {formError && (
            <p
              role="alert"
              className="text-sm text-red-600 break-words"
              data-testid="connected-accounts-connect-error"
            >
              {formError}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            data-testid="connected-accounts-imap-submit"
            disabled={connectMutation.isPending}
          >
            {connectMutation.isPending
              ? t('connectedAccounts.connecting')
              : t('connectedAccounts.connectButton')}
          </Button>
        </form>
      )}
    </div>
  );
}
