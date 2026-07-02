/**
 * ChampionBlockerBadge component. (MINCRM-466)
 * Renders the 5-state AI champion/blocker classification as a colored badge
 * with a click-to-reveal "Why?" panel showing the 1-2 most recent contributing
 * signals. Always labeled as AI-inferred, never presented as fact.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ChampionBlockerSignal,
  ChampionBlockerStatus,
} from '@shared/schemas/championBlockerSchema.js';

const STATUS_CLASSES: Record<ChampionBlockerStatus, string> = {
  champion: 'bg-emerald-100 text-emerald-800 ring-emerald-600/30',
  likely_champion: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  neutral: 'bg-gray-100 text-gray-600 ring-gray-500/10',
  likely_blocker: 'bg-red-50 text-red-700 ring-red-600/20',
  blocker: 'bg-red-100 text-red-800 ring-red-600/30',
};

interface ChampionBlockerBadgeProps {
  contactId: string;
  status: ChampionBlockerStatus;
  isOverridden?: boolean;
  recentSignals?: ChampionBlockerSignal[];
  /** When provided, renders a "Not accurate" feedback link that calls this handler. */
  onDismiss?: () => void;
  isDismissing?: boolean;
}

/**
 * Renders nothing for the default 'neutral', non-overridden state — the
 * ticket's AC specifies "Neutral (default — no badge shown)".
 */
export default function ChampionBlockerBadge({
  contactId,
  status,
  isOverridden = false,
  recentSignals = [],
  onDismiss,
  isDismissing = false,
}: ChampionBlockerBadgeProps) {
  const { t } = useTranslation();
  const [showWhy, setShowWhy] = useState(false);

  if (status === 'neutral' && !isOverridden) return null;

  return (
    <span className="relative inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${STATUS_CLASSES[status]}`}
        data-testid={`champion-blocker-badge-${contactId}`}
      >
        {t(`championBlocker.status.${status}`)}
      </span>
      {recentSignals.length > 0 && (
        <button
          type="button"
          data-testid={`champion-blocker-why-${contactId}`}
          aria-expanded={showWhy}
          aria-label={t('championBlocker.whyLabel')}
          className="text-xs text-gray-400 hover:text-gray-600 underline decoration-dotted"
          onClick={() => setShowWhy((prev) => !prev)}
        >
          {t('championBlocker.whyButton')}
        </button>
      )}
      {showWhy && recentSignals.length > 0 && (
        <div
          role="tooltip"
          data-testid={`champion-blocker-why-panel-${contactId}`}
          className="absolute z-10 top-full mt-1 start-0 w-64 rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg"
        >
          <p className="font-medium text-gray-500 mb-1">{t('championBlocker.aiInferredLabel')}</p>
          <ul className="space-y-1">
            {recentSignals.slice(0, 2).map((signal, index) => (
              <li key={index}>{signal.description}</li>
            ))}
          </ul>
        </div>
      )}
      {onDismiss && (
        <button
          type="button"
          data-testid={`champion-blocker-dismiss-${contactId}`}
          className="text-xs text-gray-400 hover:text-gray-600 underline decoration-dotted"
          disabled={isDismissing}
          onClick={onDismiss}
        >
          {isDismissing ? t('championBlocker.dismissing') : t('championBlocker.notAccurate')}
        </button>
      )}
    </span>
  );
}
