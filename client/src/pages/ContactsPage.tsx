/**
 * ContactsPage component.
 * Lists all contact records with an owner column and owner filter.
 * Provides an inline form for creating new contacts.
 * Each row links to the ContactDetailPage.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import ContactForm from '@/components/ContactForm.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import { Input } from '@/components/ui/Input.js';
import { listContacts, createContact } from '@/api/contacts.js';
import { listAccounts } from '@/api/accounts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import { ACCOUNTS_QUERY_KEY } from '@/pages/AccountsPage.js';
import type { ContactFormValues } from '@/components/ContactForm.js';
import type { ContactResponse } from '@shared/schemas/contactSchema.js';
import { useDebounce } from '@/hooks/useDebounce.js';

/** React Query cache key for the contacts list */
export const CONTACTS_QUERY_KEY = ['contacts'] as const;

/** Owner filter value — 'all' means no filter, 'me' means current user only */
type OwnerFilter = 'all' | 'me';

/**
 * Contacts list page with owner filter and inline create form.
 */
export default function ContactsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [accountSearchInput, setAccountSearchInput] = useState('');

  const debouncedSearch = useDebounce(searchInput);
  const debouncedAccountSearch = useDebounce(accountSearchInput);

  const contactsQueryKey = [
    ...CONTACTS_QUERY_KEY,
    {
      owner: ownerFilter === 'me' ? 'me' : undefined,
      search: debouncedSearch || undefined,
      accountSearch: debouncedAccountSearch || undefined,
    },
  ] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: contactsQueryKey,
    queryFn: () =>
      listContacts({
        owner: ownerFilter === 'me' ? 'me' : undefined,
        search: debouncedSearch || undefined,
        accountSearch: debouncedAccountSearch || undefined,
      }),
  });

  const { data: accountsData } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => listAccounts(),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const accountOptions = (accountsData?.accounts ?? []).map((a) => ({ id: a.id, name: a.name }));
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const createMutation = useMutation({
    mutationFn: (values: ContactFormValues) =>
      createContact({
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        phone: values.phone || undefined,
        title: values.title || undefined,
        department: values.department || undefined,
        account_id: values.account_id || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      setShowForm(false);
      setCreateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCreateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const contacts: ContactResponse[] = data?.contacts ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('contacts.pageTitle')}</h1>
          {!showForm && (
            <Button
              type="button"
              data-testid="new-contact-button"
              onClick={() => setShowForm(true)}
            >
              {t('contacts.newContact')}
            </Button>
          )}
        </div>

        {/* Inline create form — owner field intentionally omitted; defaults to creating user */}
        {showForm && (
          <section className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('contacts.newContact')}</h2>
            <ContactForm
              accounts={accountOptions}
              onSubmit={(values) => {
                setCreateError(null);
                createMutation.mutate(values);
              }}
              onCancel={() => {
                setShowForm(false);
                setCreateError(null);
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
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-56"
          />
          <Input
            id="contacts-account-search"
            data-testid="contacts-account-search"
            type="search"
            placeholder={t('contacts.accountSearchPlaceholder')}
            value={accountSearchInput}
            onChange={(e) => setAccountSearchInput(e.target.value)}
            className="w-56"
          />
          <Select
            id="contacts-owner-filter"
            data-testid="contacts-owner-filter"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value as OwnerFilter)}
            className="w-48"
          >
            <option value="all">{t('contacts.ownerFilterAll')}</option>
            <option value="me">{t('contacts.ownerFilterMe')}</option>
          </Select>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <p aria-busy="true" className="text-sm text-gray-400">
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

        {/* Contacts table */}
        {!isLoading && !isError && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {contacts.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm text-gray-400">{t('contacts.empty')}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('contacts.columnName')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('contacts.columnEmail')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('contacts.columnPhone')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('contacts.columnTitle')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('contacts.columnDepartment')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('contacts.columnOwner')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contacts.map((contact) => (
                    <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-indigo-600">
                        <Link
                          to={`/contacts/${contact.id}`}
                          data-testid={`contact-link-${contact.id}`}
                          className="hover:underline"
                        >
                          {contact.first_name} {contact.last_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{contact.email}</td>
                      <td className="px-4 py-3 text-gray-500">{contact.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{contact.title ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{contact.department ?? '—'}</td>
                      <td
                        className="px-4 py-3 text-gray-500"
                        data-testid={`contact-owner-${contact.id}`}
                      >
                        {resolveOwnerName(
                          contact.owner_id,
                          activeUsers,
                          t('contacts.ownerUnknown'),
                        )}
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
