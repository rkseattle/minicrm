/**
 * Renders a single lead as a summary card in the NLI result block.
 */
import { Link } from 'react-router-dom';
import { recordPath } from '@shared/types/recordPath.js';

interface LeadCardData {
  id: string;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  company?: string | null;
  company_name?: string | null;
  status?: string | null;
  lead_source?: string | null;
}

interface LeadResultCardProps {
  lead: LeadCardData;
}

export default function LeadResultCard({ lead }: LeadResultCardProps) {
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ');

  return (
    <div
      className="flex items-center gap-3 py-2 px-3 rounded-lg border border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors"
      data-testid={`nli-lead-card-${lead.id}`}
    >
      <div className="min-w-0 flex-1">
        <Link
          to={recordPath('lead', lead.id)}
          className="text-sm font-medium text-primary-600 hover:underline truncate block"
          data-testid={`nli-lead-card-link-${lead.id}`}
        >
          {fullName}
        </Link>
        <div className="flex gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
          {(lead.company ?? lead.company_name) && <span>{lead.company ?? lead.company_name}</span>}
          {lead.status && <span>· {lead.status}</span>}
          {lead.email && <span>· {lead.email}</span>}
        </div>
      </div>
    </div>
  );
}
