/**
 * DealsPage component.
 * Lists all deal records with stage, value, close date, linked account, and owner.
 * Provides an inline form for creating new deals.
 * Each row links to the DealDetailPage.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import DealForm from '@/components/DealForm.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import { listDeals, createDeal, DEALS_QUERY_KEY } from '@/api/deals.js';
import { listAccounts } from '@/api/accounts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import type { DealFormValues } from '@/components/DealForm.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';
import { PIPELINE_STAGE_I18N_KEY } from '@/utils/pipelineStageI18nKey.js';
import type { PipelineStage } from '@shared/schemas/dealSchema.js';

/** Owner filter value — 'all' means no filter, 'me' means current user only */
type OwnerFilter = 'all' | 'me';

/**
 * Formats a deal value as a USD currency string using the active locale.
 *
 * @param value - Numeric string from the API (pg returns numeric as string)
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted USD currency string, or '—' when value is absent
 */
function formatDealValue(value: string | null, locale: string): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return isNaN(num)
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(num);
}

/**
 * Deals list page with owner filter and inline create form.
 */
export default function DealsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');

  const dealsQueryKey =
    ownerFilter === 'me' ? ([...DEALS_QUERY_KEY, { owner: 'me' }] as const) : DEALS_QUERY_KEY;

  const { data, isLoading, isError } = useQuery({
    queryKey: dealsQueryKey,
    queryFn: () => listDeals(ownerFilter === 'me' ? 'me' : undefined),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => listAccounts(),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const accounts: AccountResponse[] = accountsData?.accounts ?? [];
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const createMutation = useMutation({
    mutationFn: (values: DealFormValues) =>
      createDeal({
        name: values.name,
        stage: values.stage as DealResponse['stage'],
        value: values.value !== '' ? parseFloat(values.value) : undefined,
        close_date: values.close_date || undefined,
        account_id: values.account_id || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      setShowForm(false);
      setCreateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCreateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const deals: DealResponse[] = data?.deals ?? [];

  /** Resolves an account_id to its display name */
  function resolveAccountName(accountId: string | null): string {
    if (!accountId) return '—';
    return accounts.find((a) => a.id === accountId)?.name ?? '—';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('deals.pageTitle')}</h1>
          {!showForm && (
            <Button type="button" data-testid="new-deal-button" onClick={() => setShowForm(true)}>
              {t('deals.newDeal')}
            </Button>
          )}
        </div>

        {/* Inline create form */}
        {showForm && (
          <section className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('deals.newDeal')}</h2>
            <DealForm
              accounts={accounts}
              accountRequired
              onSubmit={(values) => {
                setCreateError(null);
                createMutation.mutate(values);
              }}
              onCancel={() => {
                setShowForm(false);
                setCreateError(null);
              }}
              isSubmitting={createMutation.isPending}
              submitLabel={t('deals.save')}
              error={createError ?? undefined}
            />
          </section>
        )}

        {/* Owner filter */}
        <div className="mb-4 flex items-center gap-3">
          <Select
            id="deals-owner-filter"
            data-testid="deals-owner-filter"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value as OwnerFilter)}
            className="w-48"
          >
            <option value="all">{t('deals.ownerFilterAll')}</option>
            <option value="me">{t('deals.ownerFilterMe')}</option>
          </Select>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <p aria-busy="true" className="text-sm text-gray-400">
              {t('deals.loading')}
            </p>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div
            role="alert"
            className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
          >
            {t('errors.generic')}
          </div>
        )}

        {/* Deals table */}
        {!isLoading && !isError && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {deals.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm text-gray-400">{t('deals.empty')}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('deals.columnName')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('deals.columnStage')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('deals.columnValue')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('deals.columnCloseDate')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('deals.columnAccount')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('deals.columnOwner')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {deals.map((deal) => (
                    <tr key={deal.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-indigo-600">
                        <Link
                          to={`/deals/${deal.id}`}
                          data-testid={`deal-link-${deal.id}`}
                          className="hover:underline"
                        >
                          {deal.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {t(
                          `pipeline.stages.${PIPELINE_STAGE_I18N_KEY[deal.stage as PipelineStage]}`,
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {formatDealValue(deal.value, i18n.language)}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{deal.close_date ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {resolveAccountName(deal.account_id)}
                      </td>
                      <td className="px-4 py-3 text-gray-500" data-testid={`deal-owner-${deal.id}`}>
                        {resolveOwnerName(deal.owner_id, activeUsers, t('deals.ownerUnknown'))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
