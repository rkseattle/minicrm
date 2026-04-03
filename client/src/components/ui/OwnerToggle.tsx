/**
 * OwnerToggle — segmented "All / Mine" button control for list view owner filtering.
 * Satisfies MINCRM-55: visible recognition-based filter replacing URL-only ?owner=me param.
 */

import { useTranslation } from 'react-i18next';

/** Owner filter value */
export type OwnerFilter = 'all' | 'me';

export interface OwnerToggleProps {
  /** Current filter value */
  value: OwnerFilter;
  /** Called when the user selects a new value */
  onChange: (value: OwnerFilter) => void;
  /** data-testid prefix — rendered as `{testIdPrefix}-all` and `{testIdPrefix}-mine` */
  testIdPrefix: string;
}

/**
 * Segmented "All / Mine" toggle for owner filtering on list views.
 *
 * @param value - Active filter ('all' | 'me')
 * @param onChange - Handler called with the new filter value
 * @param testIdPrefix - Base string for data-testid attributes
 */
export function OwnerToggle({ value, onChange, testIdPrefix }: OwnerToggleProps) {
  const { t } = useTranslation();

  const BASE =
    'px-3 py-1.5 text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1';
  const ACTIVE = 'bg-indigo-600 text-white border-indigo-600 z-10';
  const INACTIVE = 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50';

  return (
    <div
      role="group"
      aria-label={t('common.ownerToggle.label')}
      className="inline-flex rounded-md shadow-sm"
    >
      <button
        type="button"
        data-testid={`${testIdPrefix}-all`}
        aria-pressed={value === 'all'}
        onClick={() => value !== 'all' && onChange('all')}
        className={`${BASE} ${value === 'all' ? ACTIVE : INACTIVE} rounded-s-md`}
      >
        {t('common.ownerToggle.all')}
      </button>
      <button
        type="button"
        data-testid={`${testIdPrefix}-mine`}
        aria-pressed={value === 'me'}
        onClick={() => value !== 'me' && onChange('me')}
        className={`${BASE} ${value === 'me' ? ACTIVE : INACTIVE} -ms-px rounded-e-md`}
      >
        {t('common.ownerToggle.mine')}
      </button>
    </div>
  );
}
