/**
 * Renders a single deal as a summary row in the NLI result block. (MINCRM-431)
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface DealCardData {
  id: string;
  name: string;
  stage?: string | null;
  value?: string | null;
  currency?: string;
  close_date?: string | null;
  owner_name?: string | null;
}

interface DealResultCardProps {
  deal: DealCardData;
}

function formatValue(
  value: string | null | undefined,
  currency: string | undefined,
  locale: string,
): string {
  if (!value) return '—';
  const num = parseFloat(value);
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency ?? 'USD',
  }).format(num);
}

export default function DealResultCard({ deal }: DealResultCardProps) {
  const { t, i18n } = useTranslation();

  return (
    <div
      className="flex items-center gap-3 py-2 px-3 rounded-lg border border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors"
      data-testid={`nli-deal-card-${deal.id}`}
    >
      <div className="min-w-0 flex-1">
        <Link
          to={`/deals/${deal.id}`}
          className="text-sm font-medium text-primary-600 hover:underline truncate block"
          data-testid={`nli-deal-card-link-${deal.id}`}
        >
          {deal.name}
        </Link>
        <div className="flex gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
          {deal.stage && <span>{deal.stage}</span>}
          <span>· {formatValue(deal.value, deal.currency, i18n.language)}</span>
          {deal.close_date && <span>· {t('ai.results.closes', { date: deal.close_date })}</span>}
          {deal.owner_name && <span>· {deal.owner_name}</span>}
        </div>
      </div>
    </div>
  );
}
