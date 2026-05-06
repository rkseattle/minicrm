/**
 * ContactsPage component.
 * Lists all contact records with an owner column and owner filter.
 * Provides an inline form for creating new contacts.
 * Each row links to the ContactDetailPage.
 */

import { useRef, useState, useEffect } from 'react';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import ContactForm from '@/components/ContactForm.js';
import { Button } from '@/components/ui/Button.js';
import { OwnerToggle } from '@/components/ui/OwnerToggle.js';
import type { OwnerFilter } from '@/components/ui/OwnerToggle.js';
import { Input } from '@/components/ui/Input.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { listContacts, createContact, exportContactsCsv } from '@/api/contacts.js';
import { bulkContacts } from '@/api/bulk.js';
import { listAllTags, ALL_TAGS_QUERY_KEY } from '@/api/tags.js';
import TagBadge from '@/components/TagBadge.js';
import BulkActionBar from '@/components/BulkActionBar.js';
import BulkReassignModal from '@/components/BulkReassignModal.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import type { DuplicateContactInfo } from '@/api/contacts.js';
import { listAccounts } from '@/api/accounts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import { ACCOUNTS_QUERY_KEY } from '@/pages/AccountsPage.js';
import type { ContactFormValues } from '@/components/ContactForm.js';
import type { ContactResponse } from '@shared/schemas/contactSchema.js';
import { useAuth } from '@/hooks/useAuth.js';
import { useDebounce } from '@/hooks/useDebounce.js';
import { usePagination } from '@/hooks/usePagination.js';

/** React Query cache key for the contacts list */
export const CONTACTS_QUERY_KEY = ['contacts'] as const;

/**
 * Contacts list page with owner filter and inline create form.
 */
export default function ContactsPage() {
  const { t } = useTranslation();
  const { isDesktop } = useBreakpoint();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [showForm, setShowForm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newContactButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const [duplicateContact, setDuplicateContact] = useState<DuplicateContactInfo | null>(null);
  /**
   * When true, the next form submit will bypass the duplicate check.
   * Set by "Create anyway" so the form re-submits with its current (live) values.
   */
  const forceNextSubmit = useRef(false);
  /** Ref to the ContactForm's underlying <form> element for programmatic submit. */
  const formRef = useRef<HTMLFormElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerFilter: OwnerFilter = searchParams.get('owner') === 'me' ? 'me' : 'all';
  const [searchInput, setSearchInput] = useState('');
  const [accountSearchInput, setAccountSearchInput] = useState('');
  const { page, limit, setPage, handleLimitChange } = usePagination();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

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

  type SortColumn = 'first_name' | 'email';
  type SortDir = 'ascending' | 'descending';
  const [sortCol, setSortCol] = useState<SortColumn>('first_name');
  const [sortDir, setSortDir] = useState<SortDir>('ascending');

  /**
   * Toggles sort column/direction and resets to page 1.
   *
   * @param col - The column header that was clicked
   */
  function handleSort(col: SortColumn): void {
    if (col === sortCol) {
      setSortDir((d) => (d === 'ascending' ? 'descending' : 'ascending'));
    } else {
      setSortCol(col);
      setSortDir('ascending');
    }
    setPage(1);
  }

  // Restore focus to the "New Contact" button after the form closes (button re-mounts on next render)
  useEffect(() => {
    if (!showForm && shouldRestoreFocusRef.current) {
      newContactButtonRef.current?.focus();
      shouldRestoreFocusRef.current = false;
    }
  }, [showForm]);

  const debouncedSearch = useDebounce(searchInput);
  const debouncedAccountSearch = useDebounce(accountSearchInput);

  const contactsQueryKey = [
    ...CONTACTS_QUERY_KEY,
    {
      owner: ownerFilter === 'me' ? 'me' : undefined,
      search: debouncedSearch || undefined,
      accountSearch: debouncedAccountSearch || undefined,
      sort: sortCol,
      dir: sortDir === 'ascending' ? 'asc' : 'desc',
      page,
      limit,
      tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    },
  ] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: contactsQueryKey,
    queryFn: () =>
      listContacts({
        owner: ownerFilter === 'me' ? 'me' : undefined,
        search: debouncedSearch || undefined,
        accountSearch: debouncedAccountSearch || undefined,
        sort: sortCol,
        dir: sortDir === 'ascending' ? 'asc' : 'desc',
        page,
        limit,
        tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      }),
  });

  const { data: tagsData } = useQuery({
    queryKey: ALL_TAGS_QUERY_KEY,
    queryFn: listAllTags,
    staleTime: 60_000,
  });

  const { data: accountsData } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => listAccounts(),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const accountOptions = (accountsData?.data ?? []).map((a) => ({ id: a.id, name: a.name }));
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  /** Converts ContactFormValues to the API shape */
  function toCreateInput(values: ContactFormValues) {
    return {
      first_name: values.first_name,
      last_name: values.last_name,
      email: values.email,
      phone: values.phone || undefined,
      title: values.title || undefined,
      department: values.department || undefined,
      account_id: values.account_id || null,
    };
  }

  const createMutation = useMutation({
    mutationFn: ({ values, force }: { values: ContactFormValues; force: boolean }) =>
      createContact(toCreateInput(values), force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      shouldRestoreFocusRef.current = true;
      setShowForm(false);
      setCreateError(null);
      setDuplicateContact(null);
      forceNextSubmit.current = false;
    },
    onError: (error: {
      response?: {
        status?: number;
        data?: {
          error?: { message?: string };
          duplicate?: DuplicateContactInfo;
        };
      };
    }) => {
      if (error.response?.status === 409 && error.response.data?.duplicate) {
        setDuplicateContact(error.response.data.duplicate);
        setCreateError(null);
      } else {
        setCreateError(error.response?.data?.error?.message ?? t('errors.generic'));
      }
    },
  });

  // Server handles sorting and pagination — use data as-is
  const contacts: ContactResponse[] = data?.data ?? [];

  // ── Bulk selection state (MINCRM-188) ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkReassign, setShowBulkReassign] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  const selectedTagKey = selectedTagIds.join(',');
  // Clear selection whenever filters or page change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedSearch, debouncedAccountSearch, ownerFilter, page, selectedTagKey]);

  const allVisibleIds = contacts.map((c) => c.id);
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
    mutationFn: bulkContacts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
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
          <h1 className="text-2xl font-bold text-gray-900">{t('contacts.pageTitle')}</h1>
          <div className="flex items-center gap-2">
            {/* Export filtered view */}
            <Button
              type="button"
              variant="secondary"
              data-testid="contacts-export-csv-button"
              disabled={isExporting}
              onClick={async () => {
                setIsExporting(true);
                try {
                  await exportContactsCsv({
                    search: debouncedSearch || undefined,
                    accountSearch: debouncedAccountSearch || undefined,
                    all: isAdmin && ownerFilter === 'all' ? true : undefined,
                  });
                } finally {
                  setIsExporting(false);
                }
              }}
            >
              {isExporting ? t('contacts.exporting') : t('contacts.exportCsv')}
            </Button>
            {/* Export all — admins only */}
            {isAdmin && (
              <Button
                type="button"
                variant="secondary"
                data-testid="contacts-export-all-button"
                disabled={isExporting}
                onClick={async () => {
                  setIsExporting(true);
                  try {
                    await exportContactsCsv({ all: true });
                  } finally {
                    setIsExporting(false);
                  }
                }}
              >
                {isExporting ? t('contacts.exporting') : t('contacts.exportAll')}
              </Button>
            )}
            {!showForm && (
              <Button
                ref={newContactButtonRef}
                type="button"
                data-testid="new-contact-button"
                onClick={() => setShowForm(true)}
              >
                {t('contacts.newContact')}
              </Button>
            )}
          </div>
        </div>

        {/* Inline create form — owner field intentionally omitted; defaults to creating user */}
        {showForm && (
          <section className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('contacts.newContact')}</h2>

            {/* Duplicate warning — shown after a 409 response */}
            {duplicateContact && (
              <div
                role="alert"
                data-testid="duplicate-contact-warning"
                className="mb-4 rounded-md bg-yellow-50 border border-yellow-300 px-4 py-3 text-sm text-yellow-800"
              >
                <p className="font-semibold mb-1">{t('contacts.duplicateWarningTitle')}</p>
                <p data-testid="duplicate-warning-message" className="mb-3">
                  {t('contacts.duplicateWarningMessage', {
                    name: `${duplicateContact.first_name} ${duplicateContact.last_name}`,
                  })}
                </p>
                <div className="flex items-center gap-3">
                  <Link
                    to={`/contacts/${duplicateContact.id}`}
                    data-testid="duplicate-go-to-existing"
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-yellow-400 bg-white text-yellow-800 text-xs font-medium hover:bg-yellow-50 transition-colors"
                  >
                    {t('contacts.duplicateGoToExisting')}
                  </Link>
                  <button
                    type="button"
                    data-testid="duplicate-create-anyway"
                    className="inline-flex items-center px-3 py-1.5 rounded-md bg-yellow-600 text-white text-xs font-medium hover:bg-yellow-700 transition-colors"
                    onClick={() => {
                      // Set the flag so the next form submit carries force=true,
                      // then programmatically submit the form to use its live values.
                      forceNextSubmit.current = true;
                      formRef.current?.requestSubmit();
                    }}
                    disabled={createMutation.isPending}
                  >
                    {t('contacts.duplicateCreateAnyway')}
                  </button>
                </div>
              </div>
            )}

            <ContactForm
              formRef={formRef}
              triggerRef={newContactButtonRef}
              accounts={accountOptions}
              emailWarning={duplicateContact !== null}
              onSubmit={(values) => {
                setCreateError(null);
                setDuplicateContact(null);
                const force = forceNextSubmit.current;
                forceNextSubmit.current = false;
                createMutation.mutate({ values, force });
              }}
              onCancel={() => {
                shouldRestoreFocusRef.current = true;
                setShowForm(false);
                setCreateError(null);
                setDuplicateContact(null);
                forceNextSubmit.current = false;
              }}
              isSubmitting={createMutation.isPending}
              submitLabel={t('contacts.save')}
              error={createError ?? undefined}
            />
          </section>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            id="contacts-search"
            data-testid="contacts-search"
            type="search"
            placeholder={t('contacts.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-auto"
          />
          <Input
            id="contacts-account-search"
            data-testid="contacts-account-search"
            type="search"
            placeholder={t('contacts.accountSearchPlaceholder')}
            value={accountSearchInput}
            onChange={(e) => {
              setAccountSearchInput(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-auto"
          />
          <OwnerToggle
            value={ownerFilter}
            onChange={setOwnerFilter}
            testIdPrefix="contacts-owner-filter"
          />
          {/* Tag filter (MINCRM-186) */}
          {tagsData && tagsData.tags.length > 0 && (
            <select
              aria-label={t('tags.sectionTitle')}
              data-testid="contacts-tag-filter"
              value=""
              onChange={(e) => {
                const tagId = e.target.value;
                if (tagId && !selectedTagIds.includes(tagId)) {
                  setSelectedTagIds((prev) => [...prev, tagId]);
                  setPage(1);
                }
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
            <div className="flex flex-wrap gap-1" data-testid="contacts-active-tag-filters">
              {selectedTagIds.map((tagId) => {
                const tag = tagsData?.tags.find((t) => t.id === tagId);
                if (!tag) return null;
                return (
                  <TagBadge
                    key={tag.id}
                    tag={tag}
                    onRemove={(id) => {
                      setSelectedTagIds((prev) => prev.filter((t) => t !== id));
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
          <div
            data-testid="contacts-loading"
            className="bg-white border border-gray-200 rounded-lg p-12 text-center"
          >
            <p aria-busy="true" className="text-sm text-gray-500">
              {t('contacts.loading')}
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

        {/* Contacts list */}
        {!isLoading && !isError && (
          <div className="flex-1 flex flex-col min-h-0 bg-white border border-gray-200 rounded-lg overflow-hidden mb-8">
            {contacts.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm text-gray-500" data-testid="contacts-empty-state">
                  {t('contacts.empty')}
                </p>
              </div>
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
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </th>
                        <th
                          className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
                          aria-sort={sortCol === 'first_name' ? sortDir : 'none'}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort('first_name')}
                            className="inline-flex items-center gap-1 hover:text-gray-700"
                            data-testid="contacts-sort-name"
                          >
                            {t('contacts.columnName')}
                            {sortCol === 'first_name' && (
                              <svg
                                aria-label={
                                  sortDir === 'ascending'
                                    ? t('common.sortAsc')
                                    : t('common.sortDesc')
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
                            )}
                          </button>
                        </th>
                        <th
                          className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
                          aria-sort={sortCol === 'email' ? sortDir : 'none'}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort('email')}
                            className="inline-flex items-center gap-1 hover:text-gray-700"
                            data-testid="contacts-sort-email"
                          >
                            {t('contacts.columnEmail')}
                            {sortCol === 'email' && (
                              <svg
                                aria-label={
                                  sortDir === 'ascending'
                                    ? t('common.sortAsc')
                                    : t('common.sortDesc')
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
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('contacts.columnPhone')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('contacts.columnTitle')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('contacts.columnDepartment')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('contacts.columnOwner')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {t('tags.sectionTitle')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {contacts.map((contact) => (
                        <tr
                          key={contact.id}
                          data-selected={selectedIds.has(contact.id) || undefined}
                          className={`group hover:bg-gray-50 transition-colors${selectedIds.has(contact.id) ? ' bg-indigo-50' : ''}`}
                        >
                          {/* Row checkbox (MINCRM-188) */}
                          <td className="w-10 ps-4 py-3">
                            <input
                              type="checkbox"
                              data-testid={`bulk-select-${contact.id}`}
                              checked={selectedIds.has(contact.id)}
                              onChange={() => toggleRow(contact.id)}
                              aria-label={`${contact.first_name} ${contact.last_name}`}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-indigo-600">
                            <Link
                              to={`/contacts/${contact.id}`}
                              data-testid={`contact-link-${contact.id}`}
                              className="hover:underline"
                            >
                              {contact.first_name} {contact.last_name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600">
                            <span className="block truncate max-w-[200px]" title={contact.email}>
                              {contact.email}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap group-data-[selected]:text-gray-600">
                            {contact.phone ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600">
                            {contact.title ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600">
                            {contact.department ?? '—'}
                          </td>
                          <td
                            className="px-4 py-3 text-gray-500 group-data-[selected]:text-gray-600"
                            data-testid={`contact-owner-${contact.id}`}
                          >
                            {resolveOwnerName(
                              contact.owner_id,
                              activeUsers,
                              t('contacts.ownerUnknown'),
                            )}
                          </td>
                          <td className="px-4 py-3" data-testid={`contact-tags-${contact.id}`}>
                            <div className="flex flex-wrap gap-1">
                              {contact.tags?.map((tag) => (
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
                        className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-gray-500">
                        {t('bulk.selectedCount', { count: selectedIds.size })}
                      </span>
                    </div>
                    <ul className="divide-y divide-gray-100">
                      {contacts.map((contact) => (
                        <li
                          key={contact.id}
                          data-selected={selectedIds.has(contact.id) || undefined}
                          className={`group px-4 py-3 flex items-start gap-3${selectedIds.has(contact.id) ? ' bg-indigo-50' : ''}`}
                          data-testid={`contact-card-${contact.id}`}
                        >
                          <input
                            type="checkbox"
                            data-testid={`bulk-select-${contact.id}`}
                            checked={selectedIds.has(contact.id)}
                            onChange={() => toggleRow(contact.id)}
                            aria-label={`${contact.first_name} ${contact.last_name}`}
                            className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/contacts/${contact.id}`}
                              data-testid={`contact-card-link-${contact.id}`}
                              className="block font-medium text-indigo-600 hover:underline mb-1"
                            >
                              {contact.first_name} {contact.last_name}
                            </Link>
                            <p className="text-sm text-gray-500 group-data-[selected]:text-gray-600">
                              {contact.email}
                            </p>
                            {contact.title && (
                              <p className="text-sm text-gray-500 group-data-[selected]:text-gray-600">
                                {contact.title}
                              </p>
                            )}
                            <p
                              className="text-xs text-gray-500 mt-1 group-data-[selected]:text-gray-600"
                              data-testid={`contact-card-owner-${contact.id}`}
                            >
                              {t('contacts.columnOwner')}:{' '}
                              {resolveOwnerName(
                                contact.owner_id,
                                activeUsers,
                                t('contacts.ownerUnknown'),
                              )}
                            </p>
                            {contact.tags && contact.tags.length > 0 && (
                              <div
                                className="flex flex-wrap gap-1 mt-1"
                                data-testid={`contact-card-tags-${contact.id}`}
                              >
                                {contact.tags.map((tag) => (
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
