/**
 * DealCard component.
 * Displays a single deal on the pipeline board.
 * Shows the deal name (as a link), account name, value, close date,
 * and an inline stage selector for moving the deal between stages.
 */

import { Link } from 'react-router-dom';
import { Select } from '@/components/ui/Select.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';

interface DealCardProps {
  /** The deal record to display */
  deal: DealResponse;
  /** Resolved account display name, or '—' when no account is linked */
  accountName: string;
  /** Called when the user selects a different stage */
  onStageChange: (dealId: string, stage: PipelineStage) => void;
  /** When true, the stage selector is disabled */
  isUpdating: boolean;
}

/**
 * Formats a deal value for display.
 *
 * @param value - Numeric string from the API (pg returns numeric as string)
 * @returns Formatted string or '—' when value is absent
 */
function formatValue(value: string | null): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return isNaN(num) ? '—' : `$${num.toLocaleString()}`;
}

/**
 * Card representing a single deal on the pipeline board.
 *
 * @param deal - Deal record
 * @param accountName - Resolved account name
 * @param onStageChange - Stage change handler
 * @param isUpdating - Whether a stage update is in flight for this card
 */
export default function DealCard({ deal, accountName, onStageChange, isUpdating }: DealCardProps) {
  return (
    <div
      data-testid={`deal-card-${deal.id}`}
      className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm"
    >
      <Link
        to={`/deals/${deal.id}`}
        data-testid={`deal-card-link-${deal.id}`}
        className="font-medium text-sm text-indigo-600 hover:underline block mb-1 truncate"
      >
        {deal.name}
      </Link>

      {accountName !== '—' && (
        <p
          data-testid={`deal-card-account-${deal.id}`}
          className="text-xs text-gray-500 truncate mb-2"
        >
          {accountName}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span data-testid={`deal-card-value-${deal.id}`}>{formatValue(deal.value)}</span>
        <span data-testid={`deal-card-close-date-${deal.id}`}>{deal.close_date ?? '—'}</span>
      </div>

      <Select
        id={`deal-stage-select-${deal.id}`}
        data-testid={`deal-card-stage-select-${deal.id}`}
        value={deal.stage}
        onChange={(e) => onStageChange(deal.id, e.target.value as PipelineStage)}
        disabled={isUpdating}
        className="text-xs"
      >
        {PIPELINE_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {stage}
          </option>
        ))}
      </Select>
    </div>
  );
}
