/**
 * ContactDetailPage component.
 * Displays all fields and metadata for a single contact.
 * Supports toggling to an edit form (including owner reassignment) and deleting the contact.
 */

import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import NavBar from '@/components/NavBar.js';
import FieldMergeModal from '@/components/FieldMergeModal.js';
import ContactForm from '@/components/ContactForm.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import SendEmailModal from '@/components/SendEmailModal.js';
import CustomFieldsSection from '@/components/CustomFieldsSection.js';
import { Button } from '@/components/ui/Button.js';
import {
  getContact,
  updateContact,
  deleteContact,
  listContactDeals,
  mergeContacts,
  listContacts,
  listContactAddresses,
  addContactAddress,
  deleteContactAddress,
  setDefaultContactAddress,
} from '@/api/contacts.js';
import { putCustomFieldValues, customFieldValuesQueryKey } from '@/api/customFields.js';
import type { CustomFieldValueInput } from '@shared/schemas/customFieldSchema.js';
import type { ContactAddress, ContactAddressInput } from '@/api/contacts.js';
import { listAccounts, getAccount } from '@/api/accounts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';
import { CONTACTS_QUERY_KEY } from '@/pages/ContactsPage.js';
import { ACCOUNTS_QUERY_KEY } from '@/pages/AccountsPage.js';
import type { ContactFormValues } from '@/components/ContactForm.js';
import type { MergeFieldChoice } from '@/api/contacts.js';
import type { ContactResponse } from '@shared/schemas/contactSchema.js';
import { useAuth } from '@/hooks/useAuth.js';
import { useEntityConflictHandler } from '@/hooks/useEntityConflictHandler.js';
import EntityDetailSidebar from '@/components/EntityDetailSidebar.js';

/**
 * Single contact detail page with view/edit/delete.
 */
/** Field names available for merge comparison */
type MergeableField =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'title'
  | 'department'
  | 'account_id'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state_region'
  | 'postal_code'
  | 'country'
  | 'linkedin_url'
  | 'twitter_x_url'
  | 'other_url';

export default function ContactDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueInput[]>([]);
  const editFormRef = useRef<HTMLFormElement>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isSendEmailOpen, setIsSendEmailOpen] = useState(false);

  // Merge state (MINCRM-187)
  const [isMerging, setIsMerging] = useState(false);
  const [mergeSearchQuery, setMergeSearchQuery] = useState('');
  const [mergeLoserContact, setMergeLoserContact] = useState<string | null>(null);
  const [mergeLoserData, setMergeLoserData] = useState<ContactResponse | null>(null);
  const [mergeFieldChoices, setMergeFieldChoices] = useState<
    Partial<Record<MergeableField, MergeFieldChoice>>
  >({});
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSearchResults, setMergeSearchResults] = useState<ContactResponse[]>([]);

  // Address management state
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [newAddressFields, setNewAddressFields] = useState<ContactAddressInput>({});
  const [addressError, setAddressError] = useState<string | null>(null);

  const contactQueryKey = ['contacts', id] as const;

  // Three-way merge conflict state (MINCRM-351, MINCRM-406)
  const { conflictBase, conflictTheirs, conflictPendingValues, handleConflict, clearConflict } =
    useEntityConflictHandler<ContactFormValues>({
      entityCacheKey: 'contact',
      entityQueryKey: contactQueryKey,
    });

  const { data, isLoading, isError } = useQuery({
    queryKey: contactQueryKey,
    queryFn: () => getContact(id!),
    enabled: Boolean(id),
  });

  const { data: accountsData } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => listAccounts(),
  });

  const linkedAccountId = data?.contact?.account_id ?? null;
  const { data: linkedAccountData, isLoading: linkedAccountLoading } = useQuery({
    queryKey: ['accounts', linkedAccountId],
    queryFn: () => getAccount(linkedAccountId!),
    enabled: Boolean(linkedAccountId),
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

  const addressesQueryKey = ['contacts', id, 'addresses'] as const;
  const { data: addressesData } = useQuery({
    queryKey: addressesQueryKey,
    queryFn: () => listContactAddresses(id!),
    enabled: Boolean(id),
  });

  const contactAddresses: ContactAddress[] = addressesData?.addresses ?? [];

  const accounts = accountsData?.data ?? [];
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const linkedAccount = linkedAccountData?.account ?? null;
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];
  const linkedDeals = contactDealsData?.deals ?? [];

  const updateMutation = useMutation({
    mutationFn: ({ values, version }: { values: ContactFormValues; version?: number }) =>
      updateContact(id!, {
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        phone: values.phone || undefined,
        title: values.title || undefined,
        department: values.department || undefined,
        account_id: values.account_id || null,
        owner_id: values.owner_id || undefined,
        linkedin_url: values.linkedin_url || undefined,
        twitter_x_url: values.twitter_x_url || undefined,
        other_url: values.other_url || undefined,
        // Prefer explicit version (from conflict resolution); fall back to cache for normal edits (MINCRM-349)
        version:
          version ??
          queryClient.getQueryData<{ contact: { version: number } }>(contactQueryKey)?.contact
            .version ??
          1,
      }),
    onSuccess: async (data) => {
      // Cancel any in-flight refetch (e.g. from the 409 onError invalidation) before seeding
      // the cache so a stale refetch cannot overwrite the authoritative PATCH version (MINCRM-385)
      await queryClient.cancelQueries({ queryKey: contactQueryKey });
      queryClient.setQueryData(contactQueryKey, data);
      // Save custom field values after core record is saved (MINCRM-276)
      if (customFieldValues.length > 0) {
        try {
          await putCustomFieldValues('contact', id!, customFieldValues);
          void queryClient.invalidateQueries({
            queryKey: customFieldValuesQueryKey('contact', id!),
          });
        } catch (err: unknown) {
          const apiErr = err as { response?: { data?: { error?: { message?: string } } } };
          setUpdateError(apiErr.response?.data?.error?.message ?? t('errors.generic'));
          return;
        }
      }
      queryClient.invalidateQueries({ queryKey: contactQueryKey });
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      setIsEditing(false);
      setUpdateError(null);
      clearConflict();
    },
    onError: (error: unknown, variables) => {
      if (handleConflict(error, variables)) return;
      setUpdateError(resolveApiError(error as Parameters<typeof resolveApiError>[0], t));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteContact(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      navigate('/contacts', { replace: true });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setDeleteError(resolveApiError(error, t));
    },
  });

  // Merge: search for loser contact as query changes (MINCRM-187)
  useEffect(() => {
    const trimmed = mergeSearchQuery.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    listContacts({ search: trimmed, limit: 10 })
      .then((result) => {
        if (!cancelled) {
          // Exclude the current contact from results
          setMergeSearchResults(result.data.filter((c) => c.id !== id));
        }
      })
      .catch(() => {
        if (!cancelled) setMergeSearchResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mergeSearchQuery, id]);

  const addAddressMutation = useMutation({
    mutationFn: (input: ContactAddressInput) => addContactAddress(id!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: addressesQueryKey });
      setIsAddingAddress(false);
      setNewAddressFields({});
      setAddressError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setAddressError(resolveApiError(error, t));
    },
  });

  const deleteAddressMutation = useMutation({
    mutationFn: (addressId: string) => deleteContactAddress(id!, addressId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: addressesQueryKey });
    },
  });

  const setDefaultAddressMutation = useMutation({
    mutationFn: (addressId: string) => setDefaultContactAddress(id!, addressId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: addressesQueryKey });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: () =>
      mergeContacts({
        winnerId: id!,
        loserId: mergeLoserContact!,
        fieldChoices: mergeFieldChoices,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactQueryKey });
      queryClient.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY });
      setIsMerging(false);
      setMergeLoserContact(null);
      setMergeLoserData(null);
      setMergeFieldChoices({});
      setMergeSearchQuery('');
      setMergeError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setMergeError(resolveApiError(error, t));
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
          <p aria-busy="true" className="text-sm text-gray-500">
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
            className="mt-4 inline-block text-sm text-primary-600 hover:underline"
          >
            {t('contacts.backToContacts')}
          </Link>
        </main>
      </div>
    );
  }

  const contact = data.contact;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Back link — MINCRM-113, MINCRM-115 */}
        <Link
          to="/contacts"
          data-testid="back-to-contacts"
          aria-label={t('common.backToContacts')}
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline mb-6"
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
                  onClick={() => {
                    setIsEditing(true);
                    setIsAddingAddress(false);
                    setNewAddressFields({});
                    setAddressError(null);
                  }}
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
            <ContactForm
              initialValues={contact}
              accounts={accountOptions}
              users={activeUsers}
              onSubmit={(values) => {
                setUpdateError(null);
                updateMutation.mutate({ values });
              }}
              isSubmitting={updateMutation.isPending}
              formRef={editFormRef}
              hideActions
            />

            {/* Addresses management — only available in edit mode */}
            <div
              className="mt-6 border border-gray-200 rounded-lg overflow-hidden"
              data-testid="contact-addresses-section"
            >
              <div className="px-4 py-3 flex items-center justify-between bg-gray-50 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {t('contacts.addressesSection')}
                </p>
                {!isAddingAddress && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="add-address-button"
                    onClick={() => {
                      setIsAddingAddress(true);
                      setNewAddressFields({});
                      setAddressError(null);
                    }}
                    disabled={
                      addAddressMutation.isPending ||
                      deleteAddressMutation.isPending ||
                      setDefaultAddressMutation.isPending
                    }
                  >
                    {t('contacts.addAddress')}
                  </Button>
                )}
              </div>

              {contactAddresses.length === 0 && !isAddingAddress && (
                <p className="px-4 py-4 text-sm text-gray-500" data-testid="no-addresses-message">
                  {t('contacts.noAddresses')}
                </p>
              )}
              {contactAddresses.map((addr) => (
                <div
                  key={addr.id}
                  className="px-4 py-4 border-b border-gray-100 last:border-b-0"
                  data-testid={`address-row-${addr.id}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-sm text-gray-900 space-y-0.5">
                      {addr.label && (
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          {addr.label}
                        </p>
                      )}
                      {addr.address_line1 && <p>{addr.address_line1}</p>}
                      {addr.address_line2 && <p>{addr.address_line2}</p>}
                      {(addr.city || addr.state_region || addr.postal_code) && (
                        <p>
                          {[addr.city, addr.state_region, addr.postal_code]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                      {addr.country && <p>{addr.country}</p>}
                      {addr.is_default && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800 mt-1"
                          data-testid={`address-default-badge-${addr.id}`}
                        >
                          {t('contacts.addressDefault')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!addr.is_default && (
                        <button
                          type="button"
                          data-testid={`set-default-address-${addr.id}`}
                          className="text-xs text-primary-600 hover:underline"
                          onClick={() => setDefaultAddressMutation.mutate(addr.id)}
                          disabled={
                            setDefaultAddressMutation.isPending || deleteAddressMutation.isPending
                          }
                        >
                          {t('contacts.setDefault')}
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid={`remove-address-${addr.id}`}
                        className="text-xs text-red-500 hover:underline"
                        onClick={() => deleteAddressMutation.mutate(addr.id)}
                        disabled={
                          deleteAddressMutation.isPending || setDefaultAddressMutation.isPending
                        }
                      >
                        {t('contacts.removeAddress')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {isAddingAddress && (
                <div className="px-4 py-4 border-t border-gray-100" data-testid="add-address-form">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <input
                      type="text"
                      data-testid="new-address-label"
                      placeholder={t('contacts.addressLabelPlaceholder')}
                      className="col-span-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={newAddressFields.label ?? ''}
                      onChange={(e) =>
                        setNewAddressFields((prev) => ({
                          ...prev,
                          label: e.target.value || undefined,
                        }))
                      }
                    />
                    <input
                      type="text"
                      data-testid="new-address-line1"
                      placeholder={t('contacts.addressLine1Placeholder')}
                      className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={newAddressFields.address_line1 ?? ''}
                      onChange={(e) =>
                        setNewAddressFields((prev) => ({
                          ...prev,
                          address_line1: e.target.value || undefined,
                        }))
                      }
                    />
                    <input
                      type="text"
                      data-testid="new-address-line2"
                      placeholder={t('contacts.addressLine2Placeholder')}
                      className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={newAddressFields.address_line2 ?? ''}
                      onChange={(e) =>
                        setNewAddressFields((prev) => ({
                          ...prev,
                          address_line2: e.target.value || undefined,
                        }))
                      }
                    />
                    <input
                      type="text"
                      data-testid="new-address-city"
                      placeholder={t('contacts.cityPlaceholder')}
                      className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={newAddressFields.city ?? ''}
                      onChange={(e) =>
                        setNewAddressFields((prev) => ({
                          ...prev,
                          city: e.target.value || undefined,
                        }))
                      }
                    />
                    <input
                      type="text"
                      data-testid="new-address-state-region"
                      placeholder={t('contacts.stateRegionPlaceholder')}
                      className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={newAddressFields.state_region ?? ''}
                      onChange={(e) =>
                        setNewAddressFields((prev) => ({
                          ...prev,
                          state_region: e.target.value || undefined,
                        }))
                      }
                    />
                    <input
                      type="text"
                      data-testid="new-address-postal-code"
                      placeholder={t('contacts.postalCodePlaceholder')}
                      className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={newAddressFields.postal_code ?? ''}
                      onChange={(e) =>
                        setNewAddressFields((prev) => ({
                          ...prev,
                          postal_code: e.target.value || undefined,
                        }))
                      }
                    />
                    <input
                      type="text"
                      data-testid="new-address-country"
                      placeholder={t('contacts.countryPlaceholder')}
                      className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={newAddressFields.country ?? ''}
                      onChange={(e) =>
                        setNewAddressFields((prev) => ({
                          ...prev,
                          country: e.target.value || undefined,
                        }))
                      }
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="new-address-is-default"
                        data-testid="new-address-is-default"
                        checked={newAddressFields.is_default ?? false}
                        onChange={(e) =>
                          setNewAddressFields((prev) => ({
                            ...prev,
                            is_default: e.target.checked,
                          }))
                        }
                      />
                      <label htmlFor="new-address-is-default" className="text-sm text-gray-700">
                        {t('contacts.setAsDefault')}
                      </label>
                    </div>
                  </div>
                  {addressError && (
                    <p role="alert" className="text-xs text-red-600 mb-2">
                      {addressError}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      data-testid="save-address-button"
                      onClick={() => addAddressMutation.mutate(newAddressFields)}
                      disabled={addAddressMutation.isPending}
                    >
                      {addAddressMutation.isPending
                        ? t('contacts.savingAddress')
                        : t('contacts.saveAddress')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="cancel-address-button"
                      onClick={() => {
                        setIsAddingAddress(false);
                        setNewAddressFields({});
                        setAddressError(null);
                      }}
                      disabled={addAddressMutation.isPending}
                    >
                      {t('contacts.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Custom field values — edit mode (MINCRM-276) */}
            {id && (
              <CustomFieldsSection
                entityType="contact"
                recordId={id}
                isEditing={true}
                onValuesChange={setCustomFieldValues}
              />
            )}

            <FieldMergeModal
              isOpen={Boolean(conflictPendingValues && conflictBase && conflictTheirs)}
              onClose={() => {
                clearConflict();
                setIsEditing(false);
              }}
              entityType="contact"
              base={conflictBase ?? {}}
              theirs={conflictTheirs ?? {}}
              mine={(conflictPendingValues as unknown as Record<string, unknown>) ?? {}}
              fieldLabels={{
                first_name: t('contacts.firstNameLabel'),
                last_name: t('contacts.lastNameLabel'),
                email: t('contacts.emailLabel'),
                phone: t('contacts.phoneLabel'),
                title: t('contacts.titleLabel'),
                department: t('contacts.departmentLabel'),
                owner_id: t('contacts.ownerLabel'),
                linkedin_url: t('contacts.linkedinUrlLabel'),
                twitter_x_url: t('contacts.twitterXUrlLabel'),
                other_url: t('contacts.otherUrlLabel'),
              }}
              onResolve={(resolved) => {
                // Use the version from theirs (the 409 body) — authoritative, no cache race (MINCRM-351)
                updateMutation.mutate({
                  values: {
                    ...(conflictPendingValues as ContactFormValues),
                    ...(resolved as Partial<ContactFormValues>),
                  },
                  version: conflictTheirs?.version as number | undefined,
                });
                clearConflict();
              }}
            />

            {updateError && (
              <p role="alert" className="mt-4 text-sm text-red-600" data-testid="update-error">
                {updateError}
              </p>
            )}

            <div className="mt-6 flex items-center gap-3">
              <Button
                type="button"
                data-testid="contact-form-submit"
                disabled={updateMutation.isPending}
                onClick={() => editFormRef.current?.requestSubmit()}
              >
                {updateMutation.isPending ? t('contacts.saving') : t('contacts.saveChanges')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                data-testid="contact-form-cancel"
                disabled={updateMutation.isPending}
                onClick={() => {
                  setIsEditing(false);
                  setUpdateError(null);
                  clearConflict();
                  setIsAddingAddress(false);
                  setNewAddressFields({});
                  setAddressError(null);
                }}
              >
                {t('contacts.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {/* Email row with optional Send Email action (MINCRM-275) */}
            <div className="px-6 py-4 flex flex-col md:flex-row md:items-start md:gap-4">
              <span className="w-full md:w-36 md:shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 md:mb-0 md:pt-0.5">
                {t('contacts.emailLabel')}
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                <span className="text-sm text-gray-900 break-all" data-testid="detail-email">
                  {contact.email}
                </span>
                {contact.email && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="send-email-button"
                    onClick={() => setIsSendEmailOpen(true)}
                  >
                    {t('contacts.sendEmail.buttonLabel')}
                  </Button>
                )}
              </div>
            </div>
            <DetailRow
              label={t('contacts.phoneLabel')}
              value={contact.phone ?? '—'}
              testId="detail-phone"
              nowrap
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
              {linkedAccountLoading ? (
                <span className="text-sm text-gray-500" data-testid="detail-account">
                  …
                </span>
              ) : linkedAccount ? (
                <Link
                  to={`/accounts/${linkedAccount.id}`}
                  data-testid="detail-account"
                  className="text-sm text-primary-600 hover:underline"
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

        {/* Custom field values — read mode (MINCRM-276) */}
        {!isEditing && id && (
          <CustomFieldsSection entityType="contact" recordId={id} isEditing={false} />
        )}

        {/* Address section — shown when at least one field is populated (MINCRM-182) */}
        {!isEditing &&
          (contact.address_line1 ||
            contact.address_line2 ||
            contact.city ||
            contact.state_region ||
            contact.postal_code ||
            contact.country) && (
            <div
              className="mt-6 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100"
              data-testid="contact-address-section"
            >
              <div className="px-6 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {t('contacts.addressSection')}
                </p>
              </div>
              {contact.address_line1 && (
                <DetailRow
                  label={t('contacts.addressLine1Label')}
                  value={contact.address_line1}
                  testId="detail-address-line1"
                />
              )}
              {contact.address_line2 && (
                <DetailRow
                  label={t('contacts.addressLine2Label')}
                  value={contact.address_line2}
                  testId="detail-address-line2"
                />
              )}
              {contact.city && (
                <DetailRow
                  label={t('contacts.cityLabel')}
                  value={contact.city}
                  testId="detail-city"
                />
              )}
              {contact.state_region && (
                <DetailRow
                  label={t('contacts.stateRegionLabel')}
                  value={contact.state_region}
                  testId="detail-state-region"
                />
              )}
              {contact.postal_code && (
                <DetailRow
                  label={t('contacts.postalCodeLabel')}
                  value={contact.postal_code}
                  testId="detail-postal-code"
                  nowrap
                />
              )}
              {contact.country && (
                <DetailRow
                  label={t('contacts.countryLabel')}
                  value={contact.country}
                  testId="detail-country"
                />
              )}
            </div>
          )}

        {/* Social profile links — shown when at least one URL is set (MINCRM-190) */}
        {!isEditing && (contact.linkedin_url || contact.twitter_x_url || contact.other_url) && (
          <div
            className="mt-6 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100"
            data-testid="contact-social-section"
          >
            <div className="px-6 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {t('contacts.socialSection')}
              </p>
            </div>
            {contact.linkedin_url && (
              <div className="px-6 py-4 flex items-center gap-3" data-testid="detail-linkedin-url">
                {/* LinkedIn icon */}
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 shrink-0 text-blue-700"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
                <a
                  href={contact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary-600 hover:underline truncate"
                  data-testid="detail-linkedin-link"
                >
                  {t('contacts.linkedinUrlLabel')}
                </a>
              </div>
            )}
            {contact.twitter_x_url && (
              <div className="px-6 py-4 flex items-center gap-3" data-testid="detail-twitter-x-url">
                {/* X/Twitter icon */}
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 shrink-0 text-gray-900"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <a
                  href={contact.twitter_x_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary-600 hover:underline truncate"
                  data-testid="detail-twitter-x-link"
                >
                  {t('contacts.twitterXUrlLabel')}
                </a>
              </div>
            )}
            {contact.other_url && (
              <div className="px-6 py-4 flex items-center gap-3" data-testid="detail-other-url">
                {/* Generic link icon */}
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 shrink-0 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
                <a
                  href={contact.other_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary-600 hover:underline truncate"
                  data-testid="detail-other-link"
                >
                  {t('contacts.otherUrlLabel')}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Addresses — read-only view (edit in edit mode) */}
        {!isEditing && contactAddresses.length > 0 && (
          <div
            className="mt-6 bg-white border border-gray-200 rounded-lg overflow-hidden"
            data-testid="contact-addresses-section"
          >
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {t('contacts.addressesSection')}
              </p>
            </div>
            {contactAddresses.map((addr) => (
              <div
                key={addr.id}
                className="px-6 py-4 border-b border-gray-100 last:border-b-0"
                data-testid={`address-row-${addr.id}`}
              >
                <div className="text-sm text-gray-900 space-y-0.5">
                  {addr.label && (
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      {addr.label}
                    </p>
                  )}
                  {addr.address_line1 && <p>{addr.address_line1}</p>}
                  {addr.address_line2 && <p>{addr.address_line2}</p>}
                  {(addr.city || addr.state_region || addr.postal_code) && (
                    <p>
                      {[addr.city, addr.state_region, addr.postal_code].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {addr.country && <p>{addr.country}</p>}
                  {addr.is_default && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800 mt-1"
                      data-testid={`address-default-badge-${addr.id}`}
                    >
                      {t('contacts.addressDefault')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Merge contact UI (MINCRM-187) */}
        {!isEditing && (user?.role === 'admin' || user?.id === contact.owner_id) && (
          <div className="mt-6">
            {!isMerging ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="merge-contact-button"
                onClick={() => setIsMerging(true)}
              >
                {t('contacts.mergeWithAnother')}
              </Button>
            ) : (
              <div
                className="bg-white border border-gray-200 rounded-lg p-6"
                data-testid="merge-contact-panel"
              >
                <h2 className="text-sm font-semibold text-gray-900 mb-4">
                  {t('contacts.mergeHeading')}
                </h2>

                {!mergeLoserContact ? (
                  <div>
                    <label
                      htmlFor="merge-search"
                      className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1"
                    >
                      {t('contacts.mergeSearchLabel')}
                    </label>
                    <input
                      id="merge-search"
                      data-testid="merge-search-input"
                      type="search"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      placeholder={t('contacts.mergeSearchPlaceholder')}
                      value={mergeSearchQuery}
                      onChange={(e) => setMergeSearchQuery(e.target.value)}
                    />
                    {mergeSearchQuery.trim().length >= 2 && mergeSearchResults.length > 0 && (
                      <ul
                        data-testid="merge-search-results"
                        className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100"
                      >
                        {mergeSearchResults.map((result) => (
                          <li key={result.id}>
                            <button
                              type="button"
                              data-testid={`merge-select-${result.id}`}
                              className="w-full text-start px-4 py-3 text-sm hover:bg-gray-50"
                              onClick={() => {
                                setMergeLoserContact(result.id);
                                setMergeLoserData(result);
                                setMergeSearchResults([]);
                                setMergeSearchQuery('');
                              }}
                            >
                              <span className="font-medium text-gray-900">
                                {result.first_name} {result.last_name}
                              </span>
                              <span className="text-gray-500 ms-2">{result.email}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-700 mb-4">
                      {t('contacts.mergeCompareIntro', {
                        winner: `${contact.first_name} ${contact.last_name}`,
                        loser: mergeLoserData
                          ? `${mergeLoserData.first_name} ${mergeLoserData.last_name}`
                          : '',
                      })}
                    </p>
                    {/* Side-by-side field comparison */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="px-4 py-2 text-start text-xs font-semibold text-gray-500 uppercase">
                              {t('contacts.mergeFieldColumn')}
                            </th>
                            <th className="px-4 py-2 text-start text-xs font-semibold text-gray-500 uppercase">
                              {t('contacts.mergeWinnerColumn', {
                                name: `${contact.first_name} ${contact.last_name}`,
                              })}
                            </th>
                            <th className="px-4 py-2 text-start text-xs font-semibold text-gray-500 uppercase">
                              {t('contacts.mergeLoserColumn', {
                                name: `${mergeLoserData?.first_name ?? ''} ${mergeLoserData?.last_name ?? ''}`.trim(),
                              })}
                            </th>
                            <th className="px-4 py-2 text-start text-xs font-semibold text-gray-500 uppercase">
                              {t('contacts.mergeKeepColumn')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(
                            [
                              'first_name',
                              'last_name',
                              'email',
                              'phone',
                              'title',
                              'department',
                            ] as MergeableField[]
                          ).map((field) => {
                            const winnerVal = (contact as Record<string, unknown>)[field] as
                              | string
                              | null;
                            const loserVal = mergeLoserData
                              ? ((mergeLoserData as Record<string, unknown>)[field] as
                                  | string
                                  | null)
                              : null;
                            const isDifferent = winnerVal !== loserVal;
                            return (
                              <tr
                                key={field}
                                data-testid={`merge-field-row-${field}`}
                                className={isDifferent ? 'bg-yellow-50' : ''}
                              >
                                <td className="px-4 py-2 font-medium text-gray-700">
                                  {t(`contacts.${field}Label` as never, field)}
                                </td>
                                <td className="px-4 py-2 text-gray-900">{winnerVal ?? '—'}</td>
                                <td className="px-4 py-2 text-gray-900">{loserVal ?? '—'}</td>
                                <td className="px-4 py-2">
                                  {isDifferent ? (
                                    <select
                                      data-testid={`merge-choice-${field}`}
                                      className="border border-gray-300 rounded text-sm px-2 py-1"
                                      value={mergeFieldChoices[field] ?? 'winner'}
                                      onChange={(e) =>
                                        setMergeFieldChoices((prev) => ({
                                          ...prev,
                                          [field]: e.target.value as MergeFieldChoice,
                                        }))
                                      }
                                    >
                                      <option value="winner">
                                        {t('contacts.mergeKeepWinner')}
                                      </option>
                                      <option value="loser">{t('contacts.mergeKeepLoser')}</option>
                                    </select>
                                  ) : (
                                    <span className="text-xs text-gray-500">
                                      {t('contacts.mergeSameValue')}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {mergeError && (
                      <p
                        role="alert"
                        className="mt-3 text-sm text-red-600"
                        data-testid="merge-error"
                      >
                        {mergeError}
                      </p>
                    )}

                    <div className="mt-4 flex items-center gap-3">
                      <Button
                        type="button"
                        variant="danger"
                        data-testid="merge-confirm-button"
                        disabled={mergeMutation.isPending}
                        onClick={() => {
                          setMergeError(null);
                          mergeMutation.mutate();
                        }}
                      >
                        {mergeMutation.isPending
                          ? t('contacts.mergePending')
                          : t('contacts.mergeConfirm')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        data-testid="merge-cancel-button"
                        onClick={() => {
                          setMergeLoserContact(null);
                          setMergeLoserData(null);
                          setMergeFieldChoices({});
                          setMergeError(null);
                        }}
                      >
                        {t('contacts.mergeBack')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        data-testid="merge-close-button"
                        onClick={() => {
                          setIsMerging(false);
                          setMergeLoserContact(null);
                          setMergeLoserData(null);
                          setMergeFieldChoices({});
                          setMergeError(null);
                          setMergeSearchQuery('');
                        }}
                      >
                        {t('contacts.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {id && (
          <EntityDetailSidebar
            entityType="contact"
            entityId={id}
            entityQueryKey={CONTACTS_QUERY_KEY}
            isEditing={isEditing}
            showGdpr={user?.role === 'admin'}
            onGdprErased={() => {
              void queryClient.invalidateQueries({ queryKey: ['contacts', id] });
            }}
          >
            {/* Linked deals */}
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
                  <p className="px-6 py-4 text-sm text-gray-500" data-testid="linked-deals-empty">
                    {t('contacts.linkedDealsEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="linked-deals-list">
                    {linkedDeals.map((deal) => (
                      <li key={deal.id} className="px-6 py-3 flex items-center gap-3">
                        <Link
                          to={`/deals/${deal.id}`}
                          data-testid={`linked-deal-${deal.id}`}
                          className="text-sm font-medium text-primary-600 hover:underline"
                        >
                          {deal.name}
                        </Link>
                        <span className="text-sm text-gray-500">
                          {getStageDisplayName(deal.stage, t)}
                        </span>
                        {/* Probability badge — consistent with DealCard display (MINCRM-179) */}
                        <span
                          data-testid={`linked-deal-probability-${deal.id}`}
                          className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap shrink-0 ${
                            deal.probability_is_overridden
                              ? 'bg-primary-100 text-primary-700 font-medium'
                              : 'bg-gray-100 text-gray-500 italic'
                          }`}
                          title={
                            deal.probability_is_overridden
                              ? t('deals.probabilityOverridden')
                              : t('deals.probabilityDefault')
                          }
                        >
                          {t('deals.probabilityPct', { pct: deal.effective_probability })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </EntityDetailSidebar>
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

      {/* Send Email modal — MINCRM-275 */}
      {contact.email && (
        <SendEmailModal
          isOpen={isSendEmailOpen}
          contactId={contact.id}
          contactEmail={contact.email}
          contactName={`${contact.first_name} ${contact.last_name}`}
          onClose={() => setIsSendEmailOpen(false)}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ['activities'] });
          }}
        />
      )}
    </div>
  );
}

/** Renders a labelled read-only row in the detail card, stacked on mobile. */
function DetailRow({
  label,
  value,
  testId,
  nowrap = false,
}: {
  label: string;
  value: string;
  testId: string;
  nowrap?: boolean;
}) {
  return (
    <div className="px-6 py-4 flex flex-col md:flex-row md:items-start md:gap-4">
      <span className="w-full md:w-36 md:shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 md:mb-0 md:pt-0.5">
        {label}
      </span>
      <span
        className={`text-sm text-gray-900${nowrap ? ' whitespace-nowrap' : ''}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}
