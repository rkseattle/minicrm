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
import { PagedListLayout } from '@/components/PagedListLayout.js';
import AccountForm from '@/components/AccountForm.js';
import { Button } from '@/components/ui/Button.js';
import { ExportMenu } from '@/components/ui/ExportMenu.js';
import { OwnerToggle } from '@/components/ui/OwnerToggle.js';
import type { OwnerFilter } from '@/components/ui/OwnerToggle.js';
import { Input } from '@/components/ui/Input.js';
import { Pagination } from '@/components/ui/Pagination.js';
import {
  listAccounts,
  createAccount,
  exportAccountsCsv,
  exportAccountsPdf,
} from '@/api/accounts.js';
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
import { usePermissions } from '@/hooks/usePermissions.js';
import { useDebounce } from '@/hooks/useDebounce.js';
import { usePagination } from '@/hooks/usePagination.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { useExportAction } from '@/hooks/useExportAction.js';
import { explainDuplicate } from '@/api/duplicateExplanation.js';
import AccountHealthBadge from '@/components/AccountHealthBadge.js';

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
  const { canWrite } = usePermissions();
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { isExporting, run: runExport } = useExportAction();
  const { isExporting: isExportingPdf, run: runExportPdf } = useExportAction();
  const newAccountButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const forceNextSubmit = useRef(false);
  const [duplicateAccount, setDuplicateAccount] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [duplicateSubmittedName, setDuplicateSubmittedName] = useState<string | null>(null);
  const [duplicateExplanation, setDuplicateExplanation] = useState<string | null>(null);
  const [duplicateExplanationError, setDuplicateExplanationError] = useState<string | null>(null);
  const { enabled: duplicateExplanationEnabled } = useFeatureFlag('ai_duplicate_explanation');
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerParam = searchParams.get('owner');
  const ownerFilter: OwnerFilter =
    ownerParam === 'me' ? 'me' : ownerParam === 'my_team' ? 'my_team' : 'all';
  const [searchInput, setSearchInput] = useState('');
  const [industryInput, setIndustryInput] = useState('');
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountType | ''>('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [atRiskOrDormantOnly, setAtRiskOrDormantOnly] = useState(false);
  const { enabled: relationshipHealthEnabled } = useFeatureFlag('ai_relationship_health_score');
  const { page, limit, setPage, handleLimitChange } = usePagination();

  /**
   * Updates the ?owner query param and resets to page 1.
   *
   * @param value - New owner filter value
   */
  function setOwnerFilter(value: OwnerFilter): void {
    setPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'me' || value === 'my_team') {
          next.set('owner', value);
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

  const ownerApiParam = ownerFilter === 'all' ? undefined : ownerFilter;

  const healthStatusFilter = atRiskOrDormantOnly ? (['at_risk', 'dormant'] as const) : undefined;

  const accountsQueryKey = [
    ...ACCOUNTS_QUERY_KEY,
    {
      owner: ownerApiParam,
      search: debouncedSearch || undefined,
      industry: debouncedIndustry || undefined,
      account_type: accountTypeFilter || undefined,
      sort: 'name' as const,
      dir: sortDir === 'ascending' ? 'asc' : 'desc',
      tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      health_status: healthStatusFilter,
      page,
      limit,
    },
  ] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: accountsQueryKey,
    queryFn: () =>
      listAccounts({
        owner: ownerApiParam,
        search: debouncedSearch || undefined,
        industry: debouncedIndustry || undefined,
        account_type: accountTypeFilter || undefined,
        sort: 'name',
        dir: sortDir === 'ascending' ? 'asc' : 'desc',
        tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        health_status: healthStatusFilter ? [...healthStatusFilter] : undefined,
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
    mutationFn: ({ values, force }: { values: AccountFormValues; force: boolean }) =>
      createAccount(
        {
          name: values.name,
          industry: values.industry || undefined,
          website: values.website || undefined,
          employee_range: values.employee_range || undefined,
          revenue_range: values.revenue_range || undefined,
          account_type: values.account_type || undefined,
          parent_account_id: values.parent_account_id || undefined,
          contact_ids: values.contact_ids.length > 0 ? values.contact_ids : undefined,
        },
        force,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
      shouldRestoreFocusRef.current = true;
      setShowForm(false);
      setCreateError(null);
      setDuplicateAccount(null);
      forceNextSubmit.current = false;
    },
    onError: (
      error: {
        response?: {
          status?: number;
          data?: { error?: { message?: string }; duplicate?: { id: string; name: string } };
        };
      },
      variables,
    ) => {
      if (error.response?.status === 409 && error.response.data?.duplicate) {
        setDuplicateAccount(error.response.data.duplicate);
        setDuplicateSubmittedName(variables.values.name);
        setCreateError(null);
        setDuplicateExplanation(null);
        setDuplicateExplanationError(null);
      } else {
        setCreateError(resolveApiError(error, t));
      }
    },
  });

  const duplicateExplanationMutation = useMutation({
    mutationFn: () => {
      if (!duplicateAccount || !duplicateSubmittedName) {
        return Promise.reject(new Error('Missing duplicate context'));
      }
      return explainDuplicate('account', duplicateAccount.id, {
        fields: { name: duplicateSubmittedName },
      });
    },
    onSuccess: (result) => {
      setDuplicateExplanation(result.explanation);
      setDuplicateExplanationError(null);
    },
    onError: (error: Parameters<typeof resolveApiError>[0]) => {
      setDuplicateExplanationError(resolveApiError(error, t));
    },
  });

  // Server handles sorting and pagination — use data as-is
  const accounts: AccountResponse[] = data?.data ?? [];

  const hasActiveFilters =
    !!debouncedSearch ||
    !!debouncedIndustry ||
    ownerFilter !== 'all' ||
    !!accountTypeFilter ||
    selectedTagIds.length > 0;

  // ── Bulk selection state ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkReassign, setShowBulkReassign] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  const selectedTagKey = selectedTagIds.join(',');
  // Clear selection when filters or page change; call through a named fn to satisfy react-hooks/set-state-in-effect
  useEffect(() => {
    function reset() {
      setSelectedIds(new Set());
    }
    reset();
  }, [
    debouncedSearch,
    debouncedIndustry,
    ownerFilter,
    accountTypeFilter,
    page,
    limit,
    selectedTagKey,
  ]);

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
            <ExportMenu
              label={t('common.export')}
              testId="accounts-export-menu-button"
              items={[
                {
                  key: 'csv',
                  testId: 'accounts-export-csv-button',
                  label: isExporting ? t('accounts.exporting') : t('accounts.exportCsv'),
                  disabled: isExporting,
                  onClick: () =>
                    runExport(() =>
                      exportAccountsCsv({
                        search: debouncedSearch || undefined,
                        industry: debouncedIndustry || undefined,
                        all: isAdmin && ownerFilter === 'all' ? true : undefined,
                      }),
                    ),
                },
                {
                  key: 'pdf',
                  testId: 'accounts-export-pdf-button',
                  label: isExportingPdf ? t('accounts.exporting') : t('accounts.exportPdf'),
                  disabled: isExportingPdf,
                  onClick: () =>
                    runExportPdf(() =>
                      exportAccountsPdf({
                        search: debouncedSearch || undefined,
                        industry: debouncedIndustry || undefined,
                        all: isAdmin && ownerFilter === 'all' ? true : undefined,
                      }),
                    ),
                },
                {
                  key: 'all',
                  testId: 'accounts-export-all-button',
                  label: isExporting ? t('accounts.exporting') : t('accounts.exportAll'),
                  disabled: isExporting,
                  hidden: !isAdmin,
                  onClick: () => runExport(() => exportAccountsCsv({ all: true })),
                },
              ]}
            />
            {canWrite && !showForm && (
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
            {duplicateAccount && (
              <div
                role="alert"
                data-testid="duplicate-account-warning"
                className="mb-4 rounded-md bg-yellow-50 border border-yellow-300 px-4 py-3 text-sm text-yellow-800"
              >
                <p className="font-semibold mb-1">{t('accounts.duplicateWarningTitle')}</p>
                <p data-testid="duplicate-account-warning-message" className="mb-3">
                  {t('accounts.duplicateWarningMessage', { name: duplicateAccount.name })}
                </p>
                <div className="flex items-center gap-3">
                  <Link
                    to={`/accounts/${duplicateAccount.id}`}
                    data-testid="duplicate-account-go-to-existing"
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-yellow-400 bg-white text-yellow-800 text-xs font-medium hover:bg-yellow-50 transition-colors"
                  >
                    {t('accounts.duplicateGoToExisting')}
                  </Link>
                  <button
                    type="button"
                    data-testid="duplicate-account-create-anyway"
                    className="inline-flex items-center px-3 py-1.5 rounded-md bg-yellow-600 text-white text-xs font-medium hover:bg-yellow-700 transition-colors"
                    onClick={() => {
                      forceNextSubmit.current = true;
                      formRef.current?.requestSubmit();
                    }}
                    disabled={createMutation.isPending}
                  >
                    {t('accounts.duplicateCreateAnyway')}
                  </button>
                  {duplicateExplanationEnabled && !duplicateExplanation && (
                    <button
                      type="button"
                      data-testid="duplicate-account-explain-button"
                      className="inline-flex items-center px-3 py-1.5 rounded-md border border-yellow-400 bg-white text-yellow-800 text-xs font-medium hover:bg-yellow-50 transition-colors"
                      onClick={() => duplicateExplanationMutation.mutate()}
                      disabled={duplicateExplanationMutation.isPending}
                    >
                      {duplicateExplanationMutation.isPending
                        ? t('duplicateExplanation.explaining')
                        : t('duplicateExplanation.explainButton')}
                    </button>
                  )}
                </div>
                {duplicateExplanationError && (
                  <p
                    role="alert"
                    className="mt-3 text-xs text-red-700"
                    data-testid="duplicate-account-explanation-error"
                  >
                    {duplicateExplanationError}
                  </p>
                )}
                {duplicateExplanation && (
                  <p
                    className="mt-3 text-sm text-yellow-900"
                    data-testid="duplicate-account-explanation-text"
                  >
                    {duplicateExplanation}
                  </p>
                )}
              </div>
            )}

            <AccountForm
              formRef={formRef}
              triggerRef={newAccountButtonRef}
              onSubmit={(values) => {
                setCreateError(null);
                setDuplicateAccount(null);
                const force = forceNextSubmit.current;
                forceNextSubmit.current = false;
                createMutation.mutate({ values, force });
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

        {/* Bulk error message */}
        {bulkError && (
          <p role="alert" className="mb-2 text-sm text-red-600" data-testid="bulk-error-message">
            {bulkError}
          </p>
        )}

        {/* Bulk action bar */}
        {canWrite && selectedIds.size > 0 && (
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
          <PagedListLayout
            toolbar={
              <div className="flex flex-wrap items-center gap-3">
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
                {/* Account type filter */}
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
                {/* Relationship health filter */}
                {relationshipHealthEnabled && (
                  <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap">
                    <input
                      type="checkbox"
                      data-testid="accounts-health-filter"
                      checked={atRiskOrDormantOnly}
                      onChange={(e) => {
                        setAtRiskOrDormantOnly(e.target.checked);
                        setPage(1);
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    {t('relationshipHealth.listFilterLabel')}
                  </label>
                )}
                {/* Tag filter */}
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
            }
            isEmpty={accounts.length === 0}
            emptyState={
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
            }
            pagination={
              data && (
                <Pagination
                  page={data.page}
                  limit={data.limit}
                  total={data.total}
                  onPageChange={setPage}
                  onLimitChange={handleLimitChange}
                />
              )
            }
          >
            {isDesktop ? (
              /* Desktop table */
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr className="border-b border-gray-200">
                    {/* Same gate as the action bar: no selection a viewer cannot act on. */}
                    {canWrite && (
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
                    )}
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
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
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
                    {relationshipHealthEnabled && (
                      <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {t('relationshipHealth.columnHeader')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {accounts.map((account) => (
                    <tr
                      key={account.id}
                      data-selected={selectedIds.has(account.id) || undefined}
                      className={`group hover:bg-gray-50 transition-colors${selectedIds.has(account.id) ? ' bg-primary-50' : ''}`}
                    >
                      {/* Row checkbox */}
                      {canWrite && (
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
                      )}
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
                      {relationshipHealthEnabled && (
                        <td className="px-4 py-3" data-testid={`account-health-${account.id}`}>
                          {account.health_score ? (
                            <AccountHealthBadge
                              accountId={account.id}
                              state={account.health_score.state}
                              singleThreadedRisk={account.health_score.single_threaded_risk}
                              contributingFactors={[]}
                            />
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              /* Mobile card view */
              <>
                {canWrite && (
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
                )}
                <ul className="divide-y divide-gray-100">
                  {accounts.map((account) => (
                    <li
                      key={account.id}
                      className={`px-4 py-3 flex items-start gap-3${selectedIds.has(account.id) ? ' bg-primary-50' : ''}`}
                      data-testid={`account-card-${account.id}`}
                    >
                      {canWrite && (
                        <input
                          type="checkbox"
                          data-testid={`bulk-select-${account.id}`}
                          checked={selectedIds.has(account.id)}
                          onChange={() => toggleRow(account.id)}
                          aria-label={account.name}
                          className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                      )}
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
                        {relationshipHealthEnabled && account.health_score && (
                          <div className="mt-1" data-testid={`account-card-health-${account.id}`}>
                            <AccountHealthBadge
                              accountId={account.id}
                              state={account.health_score.state}
                              singleThreadedRisk={account.health_score.single_threaded_risk}
                              contributingFactors={[]}
                            />
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </PagedListLayout>
        )}
      </main>
    </div>
  );
}
