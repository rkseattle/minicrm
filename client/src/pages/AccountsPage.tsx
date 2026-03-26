/**
 * AccountsPage component.
 * Lists all account records and provides an inline form for creating new ones.
 * Each row links to the AccountDetailPage.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import AccountForm from '@/components/AccountForm.js';
import { Button } from '@/components/ui/Button.js';
import { listAccounts, createAccount } from '@/api/accounts.js';
import type { AccountFormValues } from '@/components/AccountForm.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';

/** React Query cache key for the accounts list */
export const ACCOUNTS_QUERY_KEY = ['accounts'] as const;

/**
 * Accounts list page with inline create form.
 */
export default function AccountsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => listAccounts(),
  });

  const createMutation = useMutation({
    mutationFn: (values: AccountFormValues) =>
      createAccount({
        name: values.name,
        industry: values.industry || undefined,
        website: values.website || undefined,
        employee_range: values.employee_range || undefined,
        revenue_range: values.revenue_range || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
      setShowForm(false);
      setCreateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCreateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const accounts: AccountResponse[] = data?.accounts ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('accounts.pageTitle')}</h1>
          {!showForm && (
            <Button
              type="button"
              data-testid="new-account-button"
              onClick={() => setShowForm(true)}
            >
              {t('accounts.newAccount')}
            </Button>
          )}
        </div>

        {/* Inline create form */}
        {showForm && (
          <section className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('accounts.newAccount')}</h2>
            <AccountForm
              onSubmit={(values) => {
                setCreateError(null);
                createMutation.mutate(values);
              }}
              onCancel={() => {
                setShowForm(false);
                setCreateError(null);
              }}
              isSubmitting={createMutation.isPending}
              submitLabel={t('accounts.save')}
              error={createError ?? undefined}
            />
          </section>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <p aria-busy="true" className="text-sm text-gray-400">
              {t('accounts.loading')}
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

        {/* Accounts table */}
        {!isLoading && !isError && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {accounts.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm text-gray-400">{t('accounts.empty')}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnName')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnIndustry')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnWebsite')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnEmployeeRange')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnRevenueRange')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {accounts.map((account) => (
                    <tr key={account.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-indigo-600">
                        <Link
                          to={`/accounts/${account.id}`}
                          data-testid={`account-link-${account.id}`}
                          className="hover:underline"
                        >
                          {account.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{account.industry ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{account.website ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{account.employee_range ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{account.revenue_range ?? '—'}</td>
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
