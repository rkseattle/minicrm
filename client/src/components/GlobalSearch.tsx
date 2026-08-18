/**
 * GlobalSearch — search bar in the navigation that queries across contacts,
 * accounts, and deals simultaneously. Results appear in a dropdown panel
 * grouped by entity type.
 */

import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { globalSearch, type LeadSearchResult } from '@/api/search.js';
import { useDebounce } from '@/hooks/useDebounce.js';
import { useOnClickOutside } from '@/hooks/useOnClickOutside.js';

/** Minimum characters before a search query is sent */
const MIN_QUERY_LENGTH = 2;

/**
 * Navigation search bar with debounced querying and a grouped results dropdown.
 */
export default function GlobalSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query);

  const isQueryLong = debouncedQuery.trim().length >= MIN_QUERY_LENGTH;

  const { data } = useQuery({
    queryKey: ['global-search', debouncedQuery],
    queryFn: () => globalSearch(debouncedQuery.trim()),
    enabled: isQueryLong,
    // Override global staleTime: 0 — brief cache avoids hammering the server on rapid typing.
    staleTime: 30_000,
  });

  const closeDropdown = useCallback(() => {
    setOpen(false);
  }, []);

  useOnClickOutside(containerRef, closeDropdown);

  /**
   * Handles keyboard events on the input. Closes the dropdown on Escape.
   *
   * @param e - Keyboard event from the input element.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      setOpen(false);
      e.currentTarget.blur();
    }
  }

  const hasResults =
    data &&
    (data.contacts.length > 0 ||
      data.accounts.length > 0 ||
      data.deals.length > 0 ||
      data.leads.length > 0);

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative">
      <input
        type="search"
        data-testid="global-search-input"
        aria-label={t('search.inputLabel')}
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full lg:w-64 text-sm text-gray-700 bg-gray-50 border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white transition-colors placeholder:text-gray-400"
      />

      {showDropdown && (
        <div
          data-testid="search-results-panel"
          className="absolute start-0 top-full mt-1 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-x-hidden overflow-y-auto max-h-[min(32rem,calc(100dvh-6rem))]"
        >
          {/* Minimum-length hint */}
          {!isQueryLong && (
            <p data-testid="search-min-length-hint" className="px-4 py-3 text-sm text-gray-500">
              {t('search.minLengthHint', { min: MIN_QUERY_LENGTH })}
            </p>
          )}

          {/* Empty state */}
          {isQueryLong && data && !hasResults && (
            <p data-testid="search-empty-state" className="px-4 py-3 text-sm text-gray-500">
              {t('search.noResults', { query: debouncedQuery.trim() })}
            </p>
          )}

          {/* Contacts group */}
          {data && data.contacts.length > 0 && (
            <section aria-label={t('nav.contacts')}>
              <header className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                {t('nav.contacts')}
              </header>
              <ul>
                {data.contacts.map((contact) => (
                  <li key={contact.id}>
                    <Link
                      to={`/contacts/${contact.id}`}
                      data-testid={`search-result-contact-${contact.id}`}
                      onClick={closeDropdown}
                      className="flex flex-col px-4 py-2.5 hover:bg-primary-50 transition-colors min-w-0"
                    >
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {contact.first_name} {contact.last_name}
                      </span>
                      <span className="text-xs text-gray-500 truncate">{contact.email}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Accounts group */}
          {data && data.accounts.length > 0 && (
            <section aria-label={t('nav.accounts')}>
              <header className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                {t('nav.accounts')}
              </header>
              <ul>
                {data.accounts.map((account) => (
                  <li key={account.id}>
                    <Link
                      to={`/accounts/${account.id}`}
                      data-testid={`search-result-account-${account.id}`}
                      onClick={closeDropdown}
                      className="block px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-primary-50 transition-colors truncate"
                    >
                      {account.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Deals group */}
          {data && data.deals.length > 0 && (
            <section aria-label={t('nav.deals')}>
              <header className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                {t('nav.deals')}
              </header>
              <ul>
                {data.deals.map((deal) => (
                  <li key={deal.id}>
                    <Link
                      to={`/deals/${deal.id}`}
                      data-testid={`search-result-deal-${deal.id}`}
                      onClick={closeDropdown}
                      className="flex flex-col px-4 py-2.5 hover:bg-primary-50 transition-colors min-w-0"
                    >
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {deal.name}
                      </span>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{deal.stage}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Leads group */}
          {data && data.leads.length > 0 && (
            <section aria-label={t('nav.leads')}>
              <header className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                {t('nav.leads')}
              </header>
              <ul>
                {data.leads.map((lead: LeadSearchResult) => (
                  <li key={lead.id}>
                    <Link
                      to={`/leads/${lead.id}`}
                      data-testid={`search-result-lead-${lead.id}`}
                      onClick={closeDropdown}
                      className="flex flex-col px-4 py-2.5 hover:bg-primary-50 transition-colors min-w-0"
                    >
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {lead.first_name} {lead.last_name}
                      </span>
                      <span className="text-xs text-gray-500 truncate">
                        {lead.company_name ?? lead.email}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
