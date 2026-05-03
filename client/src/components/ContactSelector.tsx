/**
 * ContactSelector component.
 * Searchable multi-select for linking contacts to an account.
 * Displays selected contacts as removable chips; shows a search input to
 * find and add additional contacts.
 *
 * Used by AccountForm on both the create and edit flows.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listContacts } from '@/api/contacts.js';
import { useDebounce } from '@/hooks/useDebounce.js';
import { Input } from '@/components/ui/Input.js';
import type { ContactResponse } from '@shared/schemas/contactSchema.js';

interface ContactSelectorProps {
  /** Currently selected contact UUIDs */
  selectedIds: string[];
  /** Called whenever the selection changes */
  onChange: (ids: string[]) => void;
  /** Disables all interactions */
  disabled?: boolean;
  /** HTML id prefix for test attributes */
  id?: string;
}

/**
 * Multi-select component for linking contacts to an account.
 * Fetches contacts via the contacts API and supports search by name or email.
 *
 * @param selectedIds - Currently selected contact UUIDs
 * @param onChange - Callback fired with the updated UUID array when selection changes
 * @param disabled - When true, disables all interactions
 * @param id - HTML id prefix used for data-testid attributes
 */
export default function ContactSelector({
  selectedIds,
  onChange,
  disabled = false,
  id = 'contact-selector',
}: ContactSelectorProps) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput);

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['contacts', 'selector-search', debouncedSearch],
    queryFn: () => listContacts({ search: debouncedSearch || undefined }),
    enabled: debouncedSearch.length > 0,
  });

  // Fetch the selected contacts by searching without a filter so we can show their names
  const { data: selectedData } = useQuery({
    queryKey: ['contacts', 'selector-selected-all'],
    queryFn: () => listContacts(),
    enabled: selectedIds.length > 0,
    staleTime: 60_000,
  });

  /** Map of UUID → ContactResponse for quick lookup */
  const allFetched: Map<string, ContactResponse> = new Map();
  for (const contact of selectedData?.data ?? []) {
    allFetched.set(contact.id, contact);
  }
  for (const contact of searchData?.data ?? []) {
    allFetched.set(contact.id, contact);
  }

  const selectedContacts: ContactResponse[] = selectedIds
    .map((id) => allFetched.get(id))
    .filter((c): c is ContactResponse => c !== undefined);

  const searchResults: ContactResponse[] = (searchData?.data ?? []).filter(
    (c) => !selectedIds.includes(c.id),
  );

  /**
   * Adds a contact to the selection.
   *
   * @param contactId - UUID of the contact to add
   */
  function addContact(contactId: string): void {
    if (!selectedIds.includes(contactId)) {
      onChange([...selectedIds, contactId]);
      setSearchInput('');
    }
  }

  /**
   * Removes a contact from the selection.
   *
   * @param contactId - UUID of the contact to remove
   */
  function removeContact(contactId: string): void {
    onChange(selectedIds.filter((id) => id !== contactId));
  }

  return (
    <div className="flex flex-col gap-2" data-testid={id}>
      <label className="text-sm font-medium text-gray-700">{t('accounts.contactsLabel')}</label>

      {/* Selected contacts as chips */}
      {selectedContacts.length > 0 && (
        <ul
          className="flex flex-wrap gap-2"
          data-testid={`${id}-selected-list`}
          aria-label={t('accounts.contactsLabel')}
        >
          {selectedContacts.map((contact) => (
            <li
              key={contact.id}
              className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-full px-3 py-1 text-sm text-indigo-800"
              data-testid={`${id}-chip-${contact.id}`}
            >
              <span>
                {contact.first_name} {contact.last_name}
              </span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${contact.first_name} ${contact.last_name}`}
                  data-testid={`${id}-remove-${contact.id}`}
                  className="ms-1 text-indigo-400 hover:text-indigo-700 focus:outline-none"
                  onClick={() => removeContact(contact.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {selectedContacts.length === 0 && (
        <p className="text-sm text-gray-500" data-testid={`${id}-none`}>
          {t('accounts.contactsNone')}
        </p>
      )}

      {/* Search input */}
      {!disabled && (
        <div className="relative">
          <Input
            id={`${id}-search`}
            data-testid={`${id}-search`}
            type="search"
            placeholder={t('accounts.contactsSearchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            disabled={disabled}
            autoComplete="off"
          />

          {/* Search results dropdown */}
          {debouncedSearch.length > 0 && (
            <ul
              className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-y-auto"
              data-testid={`${id}-dropdown`}
              role="listbox"
              aria-label={t('accounts.contactsSearchPlaceholder')}
            >
              {searchLoading && (
                <li className="px-4 py-3 text-sm text-gray-500" data-testid={`${id}-loading`}>
                  {t('contacts.loading')}
                </li>
              )}

              {!searchLoading && searchResults.length === 0 && (
                <li className="px-4 py-3 text-sm text-gray-500" data-testid={`${id}-no-results`}>
                  {t('contacts.empty')}
                </li>
              )}

              {searchResults.map((contact) => (
                <li key={contact.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    data-testid={`${id}-option-${contact.id}`}
                    className="w-full text-start px-4 py-2 text-sm hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none"
                    onClick={() => addContact(contact.id)}
                  >
                    <span className="font-medium text-gray-900">
                      {contact.first_name} {contact.last_name}
                    </span>
                    <span className="ms-2 text-gray-500">{contact.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
