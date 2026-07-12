/**
 * AccountHealthBadge component. (MINCRM-467)
 * Renders the 5-state AI relationship health score as a colored badge with a
 * click-to-reveal "Why this score?" panel showing the top 2-3 contributing
 * factors, plus a single-threaded risk flag when applicable.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AccountHealthFactor,
  AccountHealthState,
} from '@shared/schemas/accountHealthScoreSchema.js';

const STATE_CLASSES: Record<AccountHealthState, string> = {
  strong: 'bg-emerald-100 text-emerald-800 ring-emerald-600/30',
  healthy: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  cooling: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  at_risk: 'bg-red-50 text-red-700 ring-red-600/20',
  dormant: 'bg-red-100 text-red-800 ring-red-600/30',
};

interface AccountHealthBadgeProps {
  accountId: string;
  state: AccountHealthState;
  singleThreadedRisk: boolean;
  contributingFactors: AccountHealthFactor[];
}

export default function AccountHealthBadge({
  accountId,
  state,
  singleThreadedRisk,
  contributingFactors,
}: AccountHealthBadgeProps) {
  const { t } = useTranslation();
  const [showWhy, setShowWhy] = useState(false);

  return (
    <span className="relative inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${STATE_CLASSES[state]}`}
        data-testid={`account-health-badge-${accountId}`}
      >
        {t(`relationshipHealth.state.${state}`)}
      </span>
      {singleThreadedRisk && (
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap bg-amber-50 text-amber-700 ring-amber-600/20"
          data-testid={`account-health-single-threaded-${accountId}`}
        >
          {t('relationshipHealth.singleThreadedRisk')}
        </span>
      )}
      {contributingFactors.length > 0 && (
        <button
          type="button"
          data-testid={`account-health-why-${accountId}`}
          aria-expanded={showWhy}
          aria-label={t('relationshipHealth.whyLabel')}
          className="text-xs text-gray-400 hover:text-gray-600 underline decoration-dotted"
          onClick={() => setShowWhy((prev) => !prev)}
        >
          {t('relationshipHealth.whyButton')}
        </button>
      )}
      {showWhy && contributingFactors.length > 0 && (
        <div
          role="tooltip"
          data-testid={`account-health-why-panel-${accountId}`}
          className="absolute z-10 top-full mt-1 start-0 w-64 rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg"
        >
          <p className="font-medium text-gray-500 mb-1">
            {t('relationshipHealth.aiInferredLabel')}
          </p>
          <ul className="space-y-1">
            {contributingFactors.slice(0, 3).map((factor, index) => (
              <li key={index}>{factor.description}</li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
