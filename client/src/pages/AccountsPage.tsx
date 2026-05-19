/**
 * AccountsPage component.
 * Lists all account records with an owner column and owner filter.
 * Provides an inline form for creating new accounts.
 * Each row links to the AccountDetailPage.
 */

import { useState, useRef, useEffect } from 'react';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import NavBar from '@/components/NavBar.js';
import EmptyState from '@/components/EmptyState.js';
import AccountForm from '@/components/AccountForm.js';
import { Button } from '@/components/ui/Button.js';
import { OwnerToggle } from '@/components/ui/OwnerToggle.js';
import type { OwnerFilter } from '@/components/ui/OwnerToggle.js';
import { Input } from '@/components/ui/Input.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { listAccounts, createAccount, exportAccountsCsv } from '@/api/accounts.js';
import { bulkAccounts } from '@/api/bulk.js';
import { listAllTags, ALL_TAGS_QUERY_KEY } from '@/api/tags.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import TagBadge from '@/components/TagBadge.js';
import BulkActionBar from '@/components/BulkActionBar.js';
import BulkReassignModal from '@/components/BulkReassignModal.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import type { ActiveUser } from '@/api/users.js';
import type { AccountFormValues } from '@/components/AccountForm.js';
import type { AccountResponse, AccountType } from '@shared/schemas/accountSchema.js';
import { ACCOUNT_TYPE_VALUES } from '@shared/schemas/accountSchema.js';
import { Select } from '@/components/ui/Select.js';
import { useAuth } from '@/hooks/useAuth.js';
import { useDebounce } from '@/hooks/useDebounce.js';
import { usePagination } from '@/hooks/usePagination.js';

/** React Query cache key for the accounts list */
export const ACCOUNTS_QUERY_KEY = ['accounts'] as const;

/**
 * Accounts list page with owner filter and inline create form.
 */
export default function AccountsPage() {
  const { t } = useTranslation();
  const { isDesktop } = useBreakpoint();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const newAccountButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerFilter: OwnerFilter = searchParams.get('owner') === 'me' ? 'me' : 'all';
  const [searchInput, setSearchInput] = useState('');
  const [industryInput, setIndustryInput] = useState('');
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountType | ''>('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const { page, limit, setPage, handleLimitChange } = usePagination();

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
      account_type: accountTypeFilter || undefined,
      sort: 'name' as const,
      dir: sortDir === 'ascending' ? 'asc' : 'desc',
      tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      page,
      limit,
    },
  ] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: accountsQueryKey,
    queryFn: () =>
      listAccounts({
        owner: ownerFilter === 'me' ? 'me' : undefined,
        search: debouncedSearch || undefined,
        industry: debouncedIndustry || undefined,
        account_type: accountTypeFilter || undefined,
        sort: 'name',
        dir: sortDir === 'ascending' ? 'asc' : 'desc',
        tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        page,
        limit,
      }),
  });

  const { data: tagsData } = useQuery({
    queryKey: ALL_TAGS_QUERY_KEY,
    queryFn: listAllTags,
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
      setCreateError(resolveApiError(error, t));
    },
  });

  // Server handles sorting and pagination — use data as-is
  const accounts: AccountResponse[] = data?.data ?? [];

  const hasActiveFilters =
    !!debouncedSearch ||
    !!debouncedIndustry ||
    ownerFilter === 'me' ||
    !!accountTypeFilter ||
    selectedTagIds.length > 0;

  // ── Bulk selection state (MINCRM-188) ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkReassign, setShowBulkReassign] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  const selectedTagKey = selectedTagIds.join(',');
  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedSearch, debouncedIndustry, ownerFilter, accountTypeFilter, page, selectedTagKey]);

  function clearFilters(): void {
    setSearchInput('');
    setIndustryInput('');
    setAccountTypeFilter('');
    setSelectedTagIds([]);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('owner');
        return next;
      },
      { replace: true },
    );
    setPage(1);
  }

  const allVisibleIds = accounts.map((a) => a.id);
  const allVisibleSelected =
    allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id));

  function toggleSelectAll(): void {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleIds));
    }
  }

  function toggleRow(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const [bulkError, setBulkError] = useState<string | null>(null);

  const bulkMutation = useMutation({
    mutationFn: bulkAccounts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
      setSelectedIds(new Set());
      setShowBulkReassign(false);
      setShowBulkDelete(false);
      setBulkError(null);
    },
    onError: () => {
      setBulkError(t('bulk.errorGeneric'));
    },
  });

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <NavBar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden max-w-7xl w-full mx-auto px-4 sm:px-6 pt-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('accounts.pageTitle')}</h1>
          <div className="flex items-center gap-2">
            {/* Export filtered view */}
            <Button
              type="button"
              variant="secondary"
              data-testid="accounts-export-csv-button"
              disabled={isExporting}
              onClick={async () => {
                setIsExporting(true);
                try {
                  await exportAccountsCsv({
                    search: debouncedSearch || undefined,
                    industry: debouncedIndustry || undefined,
                    all: isAdmin && ownerFilter === 'all' ? true : undefined,
                  });
                } finally {
                  setIsExporting(false);
                }
              }}
            >
              {isExporting ? t('accounts.exporting') : t('accounts.exportCsv')}
            </Button>
            {/* Export all — admins only */}
            {isAdmin && (
              <Button
                type="button"
                variant="secondary"
                data-testid="accounts-export-all-button"
                disabled={isExporting}
                onClick={async () => {
                  setIsExporting(true);
                  try {
                    await exportAccountsCsv({ all: true });
                  } finally {
                    setIsExporting(false);
                  }
                }}
              >
                {isExporting ? t('accounts.exporting') : t('accounts.exportAll')}
              </Button>
            )}
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
            className="w-full sm:w-auto"
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
            className="w-full sm:w-auto"
          />
          {/* Account type filter (MINCRM-183) */}
          <Select
            id="accounts-type-filter"
            data-testid="accounts-type-filter"
            value={accountTypeFilter}
            onChange={(e) => {
              setAccountTypeFilter(e.target.value as AccountType | '');
              setPage(1);
            }}
            className="w-full sm:w-auto"
          >
            <option value="">{t('accounts.accountTypeFilterAll')}</option>
            {ACCOUNT_TYPE_VALUES.map((type) => (
              <option key={type} value={type}>
                {t(`accounts.accountType.${type}`)}
              </option>
            ))}
          </Select>
          <OwnerToggle
            value={ownerFilter}
            onChange={setOwnerFilter}
            testIdPrefix="accounts-owner-filter"
          />
          {/* Tag filter (MINCRM-186) */}
          {tagsData && tagsData.tags.length > 0 && (
            <select
              aria-label={t('tags.sectionTitle')}
              data-testid="accounts-tag-filter"
              value=""
              onChange={(e) => {
                const tagId = e.target.value;
                if (tagId && !selectedTagIds.includes(tagId)) {
                  setSelectedTagIds((prev) => [...prev, tagId]);
                  setPage(1);
                }
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">{t('tags.sectionTitle')}</option>
              {tagsData.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          )}
          {/* Active tag filter chips */}
          {selectedTagIds.length > 0 && (
            <div className="flex flex-wrap gap-1" data-testid="accounts-active-tag-filters">
              {selectedTagIds.map((tagId) => {
                const tag = tagsData?.tags.find((tg) => tg.id === tagId);
                if (!tag) return null;
                return (
                  <TagBadge
                    key={tag.id}
                    tag={tag}
                    onRemove={(id) => {
                      setSelectedTagIds((prev) => prev.filter((tg) => tg !== id));
                      setPage(1);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <p aria-busy="true" className="text-sm text-gray-500">
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

        {/* Bulk error message (MINCRM-188) */}
        {bulkError && (
          <p role="alert" className="mb-2 text-sm text-red-600" data-testid="bulk-error-message">
            {bulkError}
          </p>
        )}

        {/* Bulk action bar (MINCRM-188) */}
        {selectedIds.size > 0 && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            actions={[
              {
                key: 'reassign',
                labelKey: 'bulk.reassignButton',
                testId: 'bulk-reassign-button',
                variant: 'secondary',
              },
              {
                key: 'delete',
                labelKey: 'bulk.deleteButton',
                testId: 'bulk-delete-button',
                variant: 'danger',
              },
            ]}
            onAction={(key) => {
              if (key === 'reassign') setShowBulkReassign(true);
              if (key === 'delete') setShowBulkDelete(true);
            }}
            onClearSelection={() => setSelectedIds(new Set())}
          />
        )}

        {/* Bulk reassign modal */}
        <BulkReassignModal
          isOpen={showBulkReassign}
          selectedCount={selectedIds.size}
          users={activeUsers}
          isPending={bulkMutation.isPending}
          onConfirm={(ownerId) => {
            bulkMutation.mutate({
              action: 'reassign',
              ids: Array.from(selectedIds),
              owner_id: ownerId,
            });
          }}
          onCancel={() => setShowBulkReassign(false)}
        />

        {/* Bulk delete confirmation modal */}
        <ConfirmDeleteModal
          isOpen={showBulkDelete}
          message={t('bulk.deleteMessage', { count: selectedIds.size })}
          isDeleting={bulkMutation.isPending}
          onConfirm={() => {
            bulkMutation.mutate({ action: 'delete', ids: Array.from(selectedIds) });
          }}
          onCancel={() => setShowBulkDelete(false)}
        />

        {/* Accounts list */}
        {!isLoading && !isError && (
          <div className="flex-1 flex flex-col min-h-0 bg-white border border-gray-200 rounded-lg overflow-hidden mb-8">
            {accounts.length === 0 ? (
              <EmptyState
                data-testid="accounts-empty-state"
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 w-12"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                  </svg>
                }
                title={
                  hasActiveFilters ? t('accounts.filteredEmptyTitle') : t('accounts.emptyTitle')
                }
                description={
                  hasActiveFilters
                    ? t('common.filteredEmptyDescription')
                    : t('accounts.emptyDescription')
                }
                action={
                  hasActiveFilters
                    ? { label: t('common.clearFilters'), onClick: clearFilters }
                    : { label: t('accounts.emptyAction'), onClick: () => setShowForm(true) }
                }
              />
            ) : (
              <div className="flex-1 overflow-auto min-h-0">
                {isDesktop ? (
                  /* Desktop table */
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-gray-200 bg-gray-50">
                        {/* Bulk select-all checkbox (MINCRM-188) */}
                        <th className="w-10 ps-4 py-3">
                          <input
                            type="checkbox"
                            data-testid="bulk-select-all"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAll}
                            aria-label={t('bulk.selectAll')}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </th>
                        <th
                          className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
                          aria-sort={sortDir}
                        >
                          <button
                            type="button"
                            onClick={handleSortName}
                            className="inline-flex items-center gap-1 hover:text-gray-700"
                            data-testid="accounts-sort-name"
                          >
                            {t('accounts.columnName')}
                            <svg
                              aria-label={
                                sortDir === 'ascending' ? t('common.sortAsc') : t('common.sortDesc')
                              }
                              className={`w-3 h-3 inline-block ms-1 transition-transform ${sortDir === 'ascending' ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </button>
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('accounts.columnType')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('accounts.columnIndustry')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('accounts.columnWebsite')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('accounts.columnEmployeeRange')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('accounts.columnRevenueRange')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('accounts.columnOwner')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('tags.sectionTitle')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {accounts.map((account) => (
                        <tr
                          key={account.id}
                          data-selected={selectedIds.has(account.id) || undefined}
                          className={`group hover:bg-gray-50 transition-colors${selectedIds.has(account.id) ? ' bg-primary-50' : ''}`}
                        >
                          {/* Row checkbox (MINCRM-188) */}
                          <td className="w-10 ps-4 py-3">
                            <input
                              type="checkbox"
                              data-testid={`bulk-select-${account.id}`}
                              checked={selectedIds.has(account.id)}
                              onChange={() => toggleRow(account.id)}
                              aria-label={account.name}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-primary-600">
                            <Link
                              to={`/accounts/${account.id}`}
                              data-testid={`account-link-${account.id}`}
                              className="hover:underline"
                            >
                              {account.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3" data-testid={`account-type-${account.id}`}>
                            {account.account_type ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800 whitespace-nowrap shrink-0">
                                {t(`accounts.accountType.${account.account_type}`)}
                              </span>
                            ) : (
                              <span className="text-gray-500 group-data-[selected]:text-gray-600">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600">
                            {account.industry ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600">
                            {account.website ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600">
                            {account.employee_range ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600">
                            {account.revenue_range ?? '—'}
                          </td>
                          <td
                            className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600"
                            data-testid={`account-owner-${account.id}`}
                          >
                            {resolveOwnerName(
                              account.owner_id,
                              activeUsers,
                              t('accounts.ownerUnknown'),
                            )}
                          </td>
                          <td className="px-4 py-3" data-testid={`account-tags-${account.id}`}>
                            <div className="flex flex-wrap gap-1">
                              {account.tags?.map((tag) => (
                                <TagBadge key={tag.id} tag={tag} />
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  /* Mobile card view */
                  <>
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50">
                      <input
                        type="checkbox"
                        data-testid="bulk-select-all"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        aria-label={t('bulk.selectAll')}
                        className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-xs text-gray-500">
                        {t('bulk.selectedCount', { count: selectedIds.size })}
                      </span>
                    </div>
                    <ul className="divide-y divide-gray-100">
                      {accounts.map((account) => (
                        <li
                          key={account.id}
                          className={`px-4 py-3 flex items-start gap-3${selectedIds.has(account.id) ? ' bg-primary-50' : ''}`}
                          data-testid={`account-card-${account.id}`}
                        >
                          <input
                            type="checkbox"
                            data-testid={`bulk-select-${account.id}`}
                            checked={selectedIds.has(account.id)}
                            onChange={() => toggleRow(account.id)}
                            aria-label={account.name}
                            className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/accounts/${account.id}`}
                              data-testid={`account-card-link-${account.id}`}
                              className="block font-medium text-primary-600 hover:underline mb-1"
                            >
                              {account.name}
                            </Link>
                            {account.industry && (
                              <p className="text-sm text-gray-500">{account.industry}</p>
                            )}
                            {account.website && (
                              <p className="text-sm text-gray-500">{account.website}</p>
                            )}
                            <p
                              className="text-xs text-gray-500 mt-1"
                              data-testid={`account-card-owner-${account.id}`}
                            >
                              {t('accounts.columnOwner')}:{' '}
                              {resolveOwnerName(
                                account.owner_id,
                                activeUsers,
                                t('accounts.ownerUnknown'),
                              )}
                            </p>
                            {account.tags && account.tags.length > 0 && (
                              <div
                                className="flex flex-wrap gap-1 mt-1"
                                data-testid={`account-card-tags-${account.id}`}
                              >
                                {account.tags.map((tag) => (
                                  <TagBadge key={tag.id} tag={tag} />
                                ))}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {data && (
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                onPageChange={setPage}
                onLimitChange={handleLimitChange}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
