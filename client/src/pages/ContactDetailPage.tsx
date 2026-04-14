/**
 * ContactDetailPage component.
 * Displays all fields and metadata for a single contact.
 * Supports toggling to an edit form (including owner reassignment) and deleting the contact.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import ContactForm from '@/components/ContactForm.js';
import ActivityTimeline from '@/components/ActivityTimeline.js';
import AttachmentsSection from '@/components/AttachmentsSection.js';
import ChangeHistory from '@/components/ChangeHistory.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import { Button } from '@/components/ui/Button.js';
import { getContact, updateContact, deleteContact, listContactDeals } from '@/api/contacts.js';
import { listAccounts } from '@/api/accounts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';
import { CONTACTS_QUERY_KEY } from '@/pages/ContactsPage.js';
import { ACCOUNTS_QUERY_KEY } from '@/pages/AccountsPage.js';
import type { ContactFormValues } from '@/components/ContactForm.js';

/**
 * Single contact detail page with view/edit/delete.
 */
export default function ContactDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  const contactQueryKey = ['contacts', id] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: contactQueryKey,
    queryFn: () => getContact(id!),
    enabled: Boolean(id),
  });

  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => listAccounts(),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const { data: contactDealsData } = useQuery({
    queryKey: ['contacts', id, 'deals'],
    queryFn: () => listContactDeals(id!),
    enabled: Boolean(id),
  });

  const accounts = accountsData?.data ?? [];
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];
  const linkedDeals = contactDealsData?.deals ?? [];

  const updateMutation = useMutation({
    mutationFn: (values: ContactFormValues) =>
      updateContact(id!, {
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        phone: values.phone || undefined,
        title: values.title || undefined,
        department: values.department || undefined,
        account_id: values.account_id || null,
        owner_id: values.owner_id || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactQueryKey });
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      setIsEditing(false);
      setUpdateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setUpdateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteContact(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      navigate('/contacts', { replace: true });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setDeleteError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const handleDelete = (): void => {
    setIsConfirmDeleteOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <p aria-busy="true" className="text-sm text-gray-400">
            {t('contacts.loading')}
          </p>
        </main>
      </div>
    );
  }

  if (isError || !data?.contact) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <p role="alert" className="text-sm text-red-600">
            {t('contacts.notFound')}
          </p>
          <Link
            to="/contacts"
            className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
          >
            {t('contacts.backToContacts')}
          </Link>
        </main>
      </div>
    );
  }

  const contact = data.contact;
  const linkedAccount = contact.account_id
    ? accounts.find((a) => a.id === contact.account_id)
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Back link — MINCRM-113, MINCRM-115 */}
        <Link
          to="/contacts"
          data-testid="back-to-contacts"
          aria-label={t('common.backToContacts')}
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-6"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4 rtl:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('common.backToContacts')}
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="contact-name">
            {contact.first_name} {contact.last_name}
          </h1>

          {!isEditing && (
            <div className="flex flex-col items-start sm:items-end gap-2 sm:shrink-0">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="edit-contact-button"
                  onClick={() => setIsEditing(true)}
                >
                  {t('contacts.edit')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  data-testid="delete-contact-button"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? t('contacts.deleting') : t('contacts.delete')}
                </Button>
              </div>
              {deleteError && (
                <p role="alert" className="text-xs text-red-600" data-testid="delete-error">
                  {deleteError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Converted from lead banner (MINCRM-175) */}
        {!isEditing && contact.source_lead_id && (
          <div
            className="mb-4 rounded border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800"
            data-testid="converted-from-lead-banner"
          >
            <Link to={`/leads/${contact.source_lead_id}`} className="font-medium underline">
              {t('contacts.convertedFromLead')}
            </Link>
          </div>
        )}

        {isEditing ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">
              {t('contacts.saveChanges')}
            </h2>
            <ContactForm
              initialValues={contact}
              accounts={accountOptions}
              users={activeUsers}
              onSubmit={(values) => {
                setUpdateError(null);
                updateMutation.mutate(values);
              }}
              onCancel={() => {
                setIsEditing(false);
                setUpdateError(null);
              }}
              isSubmitting={updateMutation.isPending}
              submitLabel={t('contacts.saveChanges')}
              error={updateError ?? undefined}
            />
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            <DetailRow
              label={t('contacts.emailLabel')}
              value={contact.email}
              testId="detail-email"
            />
            <DetailRow
              label={t('contacts.phoneLabel')}
              value={contact.phone ?? '—'}
              testId="detail-phone"
            />
            <DetailRow
              label={t('contacts.titleLabel')}
              value={contact.title ?? '—'}
              testId="detail-title"
            />
            <DetailRow
              label={t('contacts.departmentLabel')}
              value={contact.department ?? '—'}
              testId="detail-department"
            />
            <div className="px-6 py-4 flex flex-col md:flex-row md:items-start md:gap-4">
              <span className="w-full md:w-36 md:shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 md:mb-0 md:pt-0.5">
                {t('contacts.accountLabel')}
              </span>
              {accountsLoading ? (
                <span className="text-sm text-gray-400" data-testid="detail-account">
                  …
                </span>
              ) : linkedAccount ? (
                <Link
                  to={`/accounts/${linkedAccount.id}`}
                  data-testid="detail-account"
                  className="text-sm text-indigo-600 hover:underline"
                >
                  {linkedAccount.name}
                </Link>
              ) : (
                <span className="text-sm text-gray-900" data-testid="detail-account">
                  —
                </span>
              )}
            </div>
            <DetailRow
              label={t('contacts.createdLabel')}
              value={formatLocalDate(contact.created_at, i18n.language)}
              testId="detail-created"
            />
            <DetailRow
              label={t('contacts.ownerLabel')}
              value={resolveOwnerName(contact.owner_id, activeUsers, t('contacts.ownerUnknown'))}
              testId="detail-owner"
            />
          </div>
        )}

        {/* Activity timeline */}
        {!isEditing && <ActivityTimeline contactId={id} />}

        {/* Attachments (MINCRM-167) */}
        {!isEditing && id && <AttachmentsSection recordType="contact" recordId={id} />}

        {/* Change history (MINCRM-171) */}
        {!isEditing && id && <ChangeHistory recordType="contact" recordId={id} />}

        {/* Linked deals */}
        {!isEditing && (
          <section className="mt-8" aria-labelledby="linked-deals-heading">
            <h2
              id="linked-deals-heading"
              className="text-sm font-semibold text-gray-900 mb-3"
              data-testid="linked-deals-heading"
            >
              {t('contacts.linkedDealsHeading')}
            </h2>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {linkedDeals.length === 0 ? (
                <p className="px-6 py-4 text-sm text-gray-400" data-testid="linked-deals-empty">
                  {t('contacts.linkedDealsEmpty')}
                </p>
              ) : (
                <ul className="divide-y divide-gray-100" data-testid="linked-deals-list">
                  {linkedDeals.map((deal) => (
                    <li key={deal.id} className="px-6 py-3 flex items-center gap-3">
                      <Link
                        to={`/deals/${deal.id}`}
                        data-testid={`linked-deal-${deal.id}`}
                        className="text-sm font-medium text-indigo-600 hover:underline"
                      >
                        {deal.name}
                      </Link>
                      <span className="text-sm text-gray-500">
                        {getStageDisplayName(deal.stage, t)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </main>

      {/* Delete confirmation modal — MINCRM-107 */}
      <ConfirmDeleteModal
        isOpen={isConfirmDeleteOpen}
        message={t('contacts.confirmDelete')}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => {
          setDeleteError(null);
          deleteMutation.mutate();
        }}
        onCancel={() => setIsConfirmDeleteOpen(false)}
      />
    </div>
  );
}

/** Renders a labelled read-only row in the detail card, stacked on mobile. */
function DetailRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="px-6 py-4 flex flex-col md:flex-row md:items-start md:gap-4">
      <span className="w-full md:w-36 md:shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 md:mb-0 md:pt-0.5">
        {label}
      </span>
      <span className="text-sm text-gray-900" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
