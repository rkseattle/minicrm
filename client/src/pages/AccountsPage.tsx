/**
 * AccountsPage component.
 * Lists all account records with an owner column and owner filter.
 * Provides an inline form for creating new accounts.
 * Each row links to the AccountDetailPage.
 */

import { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import AccountForm from '@/components/AccountForm.js';
import { Button } from '@/components/ui/Button.js';
import { OwnerToggle } from '@/components/ui/OwnerToggle.js';
import type { OwnerFilter } from '@/components/ui/OwnerToggle.js';
import { Input } from '@/components/ui/Input.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { listAccounts, createAccount } from '@/api/accounts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import type { AccountFormValues } from '@/components/AccountForm.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';
import { useDebounce } from '@/hooks/useDebounce.js';
import { PAGINATION_DEFAULT_LIMIT } from '@shared/schemas/paginationSchema.js';

/** React Query cache key for the accounts list */
export const ACCOUNTS_QUERY_KEY = ['accounts'] as const;

/**
 * Accounts list page with owner filter and inline create form.
 */
export default function AccountsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newAccountButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerFilter: OwnerFilter = searchParams.get('owner') === 'me' ? 'me' : 'all';
  const [searchInput, setSearchInput] = useState('');
  const [industryInput, setIndustryInput] = useState('');
  const [page, setPage] = useState(1);

  /**
   * Updates the ?owner query param and resets to page 1. (MINCRM-55)
   *
   * @param value - New owner filter value
   */
  function setOwnerFilter(value: OwnerFilter): void {
    setPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'me') {
          next.set('owner', 'me');
        } else {
          next.delete('owner');
        }
        return next;
      },
      { replace: true },
    );
  }

  type SortDir = 'ascending' | 'descending';
  const [sortDir, setSortDir] = useState<SortDir>('ascending');

  /** Toggles the name sort direction and resets to page 1. */
  function handleSortName(): void {
    setSortDir((d) => (d === 'ascending' ? 'descending' : 'ascending'));
    setPage(1);
  }

  // Restore focus to the "New Account" button after the form closes (button re-mounts on next render)
  useEffect(() => {
    if (!showForm && shouldRestoreFocusRef.current) {
      newAccountButtonRef.current?.focus();
      shouldRestoreFocusRef.current = false;
    }
  }, [showForm]);

  const debouncedSearch = useDebounce(searchInput);
  const debouncedIndustry = useDebounce(industryInput);

  const accountsQueryKey = [
    ...ACCOUNTS_QUERY_KEY,
    {
      owner: ownerFilter === 'me' ? 'me' : undefined,
      search: debouncedSearch || undefined,
      industry: debouncedIndustry || undefined,
      sort: 'name' as const,
      dir: sortDir === 'ascending' ? 'asc' : 'desc',
      page,
    },
  ] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: accountsQueryKey,
    queryFn: () =>
      listAccounts({
        owner: ownerFilter === 'me' ? 'me' : undefined,
        search: debouncedSearch || undefined,
        industry: debouncedIndustry || undefined,
        sort: 'name',
        dir: sortDir === 'ascending' ? 'asc' : 'desc',
        page,
        limit: PAGINATION_DEFAULT_LIMIT,
      }),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const createMutation = useMutation({
    mutationFn: (values: AccountFormValues) =>
      createAccount({
        name: values.name,
        industry: values.industry || undefined,
        website: values.website || undefined,
        employee_range: values.employee_range || undefined,
        revenue_range: values.revenue_range || undefined,
        contact_ids: values.contact_ids.length > 0 ? values.contact_ids : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
      shouldRestoreFocusRef.current = true;
      setShowForm(false);
      setCreateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCreateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  // Server handles sorting and pagination — use data as-is
  const accounts: AccountResponse[] = data?.data ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('accounts.pageTitle')}</h1>
          {!showForm && (
            <Button
              ref={newAccountButtonRef}
              type="button"
              data-testid="new-account-button"
              onClick={() => setShowForm(true)}
            >
              {t('accounts.newAccount')}
            </Button>
          )}
        </div>

        {/* Inline create form — owner field intentionally omitted; defaults to creating user */}
        {showForm && (
          <section className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('accounts.newAccount')}</h2>
            <AccountForm
              triggerRef={newAccountButtonRef}
              onSubmit={(values) => {
                setCreateError(null);
                createMutation.mutate(values);
              }}
              onCancel={() => {
                shouldRestoreFocusRef.current = true;
                setShowForm(false);
                setCreateError(null);
              }}
              isSubmitting={createMutation.isPending}
              submitLabel={t('accounts.save')}
              error={createError ?? undefined}
            />
          </section>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            id="accounts-search"
            data-testid="accounts-search"
            type="search"
            placeholder={t('accounts.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            className="w-56"
          />
          <Input
            id="accounts-industry-filter"
            data-testid="accounts-industry-filter"
            type="search"
            placeholder={t('accounts.industryFilterPlaceholder')}
            value={industryInput}
            onChange={(e) => {
              setIndustryInput(e.target.value);
              setPage(1);
            }}
            className="w-48"
          />
          <OwnerToggle
            value={ownerFilter}
            onChange={setOwnerFilter}
            testIdPrefix="accounts-owner-filter"
          />
        </div>

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
                    <th
                      className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide"
                      aria-sort={sortDir}
                    >
                      <button
                        type="button"
                        onClick={handleSortName}
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        data-testid="accounts-sort-name"
                      >
                        {t('accounts.columnName')}
                        {sortDir === 'ascending' ? ' ↑' : ' ↓'}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnIndustry')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnWebsite')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnEmployeeRange')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnRevenueRange')}
                    </th>
                    <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('accounts.columnOwner')}
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
                      <td
                        className="px-4 py-3 text-gray-500"
                        data-testid={`account-owner-${account.id}`}
                      >
                        {resolveOwnerName(
                          account.owner_id,
                          activeUsers,
                          t('accounts.ownerUnknown'),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data && data.total > data.limit && (
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                onPageChange={setPage}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
