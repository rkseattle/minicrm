/**
 * Generic typeahead search input — backs the unit-key and test-ID pickers
 * (MINCRM-636/637). Unlike RecentBuildSelect (a plain dropdown over a
 * small, already-fetched list), unit keys/test IDs have no "list
 * everything" endpoint at all: a single commit's coverage_units/
 * coverage_test_links can run into the hundreds of thousands of rows, so
 * this always debounces keystrokes into a scoped, limited backend search
 * rather than fetching a full list once.
 *
 * Deliberately uncontrolled beyond the search text itself: selecting a
 * result calls onSelect and clears the search box, rather than trying to
 * keep the input's displayed text in sync with "the value that was
 * selected" the way a native <select> does — the two can legitimately
 * diverge here (e.g. selecting, then typing a fresh search without
 * needing to clear the old selection's text first).
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_SEARCH_LENGTH = 2;

interface TypeaheadOption {
  value: string;
  label: string;
}

interface TypeaheadSelectProps {
  id: string;
  label: string;
  testId: string;
  placeholder: string;
  /** Disables the whole control (e.g. no commitSha chosen yet to search within). */
  disabled?: boolean;
  disabledReason?: string;
  queryKey: readonly unknown[];
  search: (searchTerm: string) => Promise<TypeaheadOption[]>;
  onSelect: (value: string) => void;
}

export default function TypeaheadSelect({
  id,
  label,
  testId,
  placeholder,
  disabled = false,
  disabledReason,
  queryKey,
  search,
  onSelect,
}: TypeaheadSelectProps) {
  const [rawInput, setRawInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(rawInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawInput]);

  const searchQuery = useQuery({
    queryKey: [...queryKey, debouncedSearch],
    queryFn: () => search(debouncedSearch),
    enabled: !disabled && debouncedSearch.length >= MIN_SEARCH_LENGTH,
    retry: false,
  });

  const options = searchQuery.data ?? [];

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        value={rawInput}
        onChange={(e) => setRawInput(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className="w-72 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
        data-testid={testId}
        autoComplete="off"
      />

      {!disabled && rawInput.trim().length > 0 && rawInput.trim().length < MIN_SEARCH_LENGTH && (
        <p className="mt-1 text-xs text-gray-500" data-testid={`${testId}-hint`}>
          Type at least {MIN_SEARCH_LENGTH} characters to search.
        </p>
      )}

      {searchQuery.isLoading && (
        <p className="mt-1 text-xs text-gray-500" data-testid={`${testId}-loading`}>
          Searching…
        </p>
      )}

      {searchQuery.isError && (
        <p className="mt-1 text-xs text-red-600" data-testid={`${testId}-error`}>
          Search failed — try again.
        </p>
      )}

      {searchQuery.isSuccess && debouncedSearch.length >= MIN_SEARCH_LENGTH && (
        <ul
          className="absolute z-10 mt-1 max-h-56 w-72 overflow-y-auto rounded-md border border-gray-200 bg-white text-sm shadow-lg"
          data-testid={`${testId}-results`}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-gray-500" data-testid={`${testId}-no-results`}>
              No matches.
            </li>
          ) : (
            options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(option.value);
                    setRawInput('');
                    setDebouncedSearch('');
                  }}
                  className="block w-full truncate px-3 py-2 text-left hover:bg-indigo-50"
                  data-testid={`${testId}-option-${option.value}`}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export type { TypeaheadOption };
