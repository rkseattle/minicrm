/**
 * DealCard component.
 * Displays a single deal on the pipeline board.
 * Shows the deal name (as a link), account name, value, close date,
 * and an inline stage selector for moving the deal between stages.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import { CLOSED_STAGES } from '@/components/CloseDealModal.js';
import { usePipelineStages } from '@/hooks/usePipelineStages.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';

interface DealCardProps {
  /** The deal record to display */
  deal: DealResponse;
  /** Resolved account display name, or '—' when no account is linked */
  accountName: string;
  /** Called when the user selects a non-terminal stage */
  onStageChange: (dealId: string, stage: PipelineStage) => void;
  /**
   * Called when the user selects a terminal stage (Closed Won / Closed Lost).
   * The parent is responsible for opening the close deal modal.
   */
  onCloseRequested: (dealId: string, stage: 'Closed Won' | 'Closed Lost') => void;
  /** When true, the stage selector is disabled */
  isUpdating: boolean;
  /**
   * Optional prefix for data-testid attributes.
   * Used to disambiguate cards rendered in multiple views (e.g. "mobile-").
   */
  testIdPrefix?: string;
}

/**
 * Formats a deal value as a USD currency string using the active locale.
 *
 * @param value - Numeric string from the API (pg returns numeric as string)
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted USD currency string, or '—' when value is absent
 */
function formatValue(value: string | null, locale: string): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return isNaN(num)
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(num);
}

/**
 * Card representing a single deal on the pipeline board.
 *
 * @param deal - Deal record
 * @param accountName - Resolved account name
 * @param onStageChange - Handler for non-terminal stage changes
 * @param onCloseRequested - Handler for terminal stage selections (opens close modal)
 * @param isUpdating - Whether a stage update is in flight for this card
 */
export default function DealCard({
  deal,
  accountName,
  onStageChange,
  onCloseRequested,
  isUpdating,
  testIdPrefix = '',
}: DealCardProps) {
  const { t, i18n } = useTranslation();
  const { stageNames, terminalStageNames } = usePipelineStages();
  return (
    <div
      data-testid={`${testIdPrefix}deal-card-${deal.id}`}
      className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm"
    >
      <Link
        to={`/deals/${deal.id}`}
        data-testid={`${testIdPrefix}deal-card-link-${deal.id}`}
        className="font-medium text-sm text-indigo-600 hover:underline block mb-1 truncate"
        title={deal.name}
      >
        {deal.name}
      </Link>

      {accountName !== '—' && (
        <p
          data-testid={`${testIdPrefix}deal-card-account-${deal.id}`}
          className="text-xs text-gray-500 truncate mb-2"
          title={accountName}
        >
          {accountName}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span data-testid={`${testIdPrefix}deal-card-value-${deal.id}`}>
          {formatValue(deal.value, i18n.language)}
        </span>
        <span data-testid={`${testIdPrefix}deal-card-close-date-${deal.id}`}>
          {deal.close_date ?? '—'}
        </span>
      </div>

      <Select
        id={`deal-stage-select-${deal.id}`}
        data-testid={`${testIdPrefix}deal-card-stage-select-${deal.id}`}
        value={deal.stage}
        onChange={(e) => {
          const selected = e.target.value;
          if (
            terminalStageNames.includes(selected) ||
            (CLOSED_STAGES as string[]).includes(selected)
          ) {
            onCloseRequested(deal.id, selected as 'Closed Won' | 'Closed Lost');
          } else {
            onStageChange(deal.id, selected as PipelineStage);
          }
        }}
        disabled={isUpdating}
        className="text-xs"
      >
        {stageNames.map((stage) => (
          <option key={stage} value={stage}>
            {getStageDisplayName(stage, t)}
          </option>
        ))}
      </Select>
    </div>
  );
}
