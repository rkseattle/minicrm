/**
 * Dispatches NLI tool results to the appropriate CRM result card components.
 * Renders a loading skeleton while the send mutation is in flight,
 * and gracefully handles empty result sets. (MINCRM-423, MINCRM-431)
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiToolResult } from '@shared/schemas/aiSessionSchema.js';
import ContactResultCard from './ContactResultCard.js';
import AccountResultCard from './AccountResultCard.js';
import DealResultCard from './DealResultCard.js';
import ActivityResultCard from './ActivityResultCard.js';
import NoteResultCard from './NoteResultCard.js';
import LeadResultCard from './LeadResultCard.js';
import ReportResultCard from './ReportResultCard.js';

interface NliResultBlockProps {
  toolResults: AiToolResult[];
  isLoading?: boolean;
}

/** Set of tool names that produce renderable results in the conversation thread */
const READ_TOOL_NAMES = new Set([
  'searchContacts',
  'getContact',
  'searchAccounts',
  'getAccount',
  'searchDeals',
  'getDeal',
  'searchActivities',
  'getActivity',
  'searchNotes',
  'getNote',
  'searchLeads',
  'getLead',
  'generateReport',
]);

/** Extracts an array of records from list or single-record tool output */
function extractItems(output: unknown): unknown[] {
  if (output === null || output === undefined) return [];
  // list tools return { data: [...], total: number }
  if (typeof output === 'object' && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    // single-record tools return the record directly; wrap in array
    if ('id' in obj) return [obj];
  }
  if (Array.isArray(output)) return output;
  return [];
}

function renderItems(toolName: string, items: unknown[]): ReactNode {
  if (items.length === 0) return null;

  if (toolName === 'searchContacts' || toolName === 'getContact') {
    return items.map((item, i) => {
      const c = item as Record<string, unknown>;
      // Cast via unknown: tool output is untyped JSON; the card's interface is structurally compatible
      const contact = item as unknown as Parameters<typeof ContactResultCard>[0]['contact'];
      return <ContactResultCard key={(c.id as string | undefined) ?? i} contact={contact} />;
    });
  }

  if (toolName === 'searchAccounts' || toolName === 'getAccount') {
    return items.map((item, i) => {
      const a = item as Record<string, unknown>;
      // Cast via unknown: tool output is untyped JSON; the card's interface is structurally compatible
      const account = item as unknown as Parameters<typeof AccountResultCard>[0]['account'];
      return <AccountResultCard key={(a.id as string | undefined) ?? i} account={account} />;
    });
  }

  if (toolName === 'searchDeals' || toolName === 'getDeal') {
    return items.map((item, i) => {
      const d = item as Record<string, unknown>;
      // Cast via unknown: tool output is untyped JSON; the card's interface is structurally compatible
      const deal = item as unknown as Parameters<typeof DealResultCard>[0]['deal'];
      return <DealResultCard key={(d.id as string | undefined) ?? i} deal={deal} />;
    });
  }

  if (toolName === 'searchActivities' || toolName === 'getActivity') {
    return items.map((item, i) => {
      const a = item as Record<string, unknown>;
      // Cast via unknown: tool output is untyped JSON; the card's interface is structurally compatible
      const activity = item as unknown as Parameters<typeof ActivityResultCard>[0]['activity'];
      return <ActivityResultCard key={(a.id as string | undefined) ?? i} activity={activity} />;
    });
  }

  if (toolName === 'searchNotes' || toolName === 'getNote') {
    return items.map((item, i) => {
      const n = item as Record<string, unknown>;
      // Cast via unknown: tool output is untyped JSON; the card's interface is structurally compatible
      const note = item as unknown as Parameters<typeof NoteResultCard>[0]['note'];
      return <NoteResultCard key={(n.id as string | undefined) ?? i} note={note} />;
    });
  }

  if (toolName === 'searchLeads' || toolName === 'getLead') {
    return items.map((item, i) => {
      const l = item as Record<string, unknown>;
      // Cast via unknown: tool output is untyped JSON; the card's interface is structurally compatible
      const lead = item as unknown as Parameters<typeof LeadResultCard>[0]['lead'];
      return <LeadResultCard key={(l.id as string | undefined) ?? i} lead={lead} />;
    });
  }

  return null;
}

/** Extracts the report type and data from a generateReport tool output object */
function extractReport(output: unknown): { report_type: string; data: unknown } | null {
  if (output === null || output === undefined || typeof output !== 'object') return null;
  const obj = output as Record<string, unknown>;
  // generateReport returns the report data directly with a report_type discriminator
  // injected by the NLI result renderer. Fall back to checking for known report shapes.
  if (typeof obj.report_type === 'string') return { report_type: obj.report_type, data: obj };
  // win_loss shape
  if ('wonCount' in obj || 'winRate' in obj) return { report_type: 'win_loss', data: obj };
  // activity_volume shape
  if ('rows' in obj && 'totals' in obj) return { report_type: 'activity_volume', data: obj };
  // stage_trend shape
  if ('dataPoints' in obj || 'stages' in obj) return { report_type: 'stage_trend', data: obj };
  return null;
}

export default function NliResultBlock({ toolResults, isLoading = false }: NliResultBlockProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-2 mt-2" data-testid="nli-result-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" aria-hidden="true" />
        ))}
      </div>
    );
  }

  // Only render blocks for read tools that return renderable entity data
  const readResults = toolResults.filter((r) => READ_TOOL_NAMES.has(r.toolName));
  if (readResults.length === 0) return null;

  return (
    <div className="mt-2 space-y-3" data-testid="nli-result-block">
      {readResults.map((result, blockIdx) => {
        // generateReport renders a single card directly rather than a list of items
        if (result.toolName === 'generateReport') {
          const reportData = extractReport(result.output);
          if (!reportData) return null;
          const typedReport = reportData as Parameters<typeof ReportResultCard>[0]['report'];
          return (
            <div key={blockIdx} data-testid={`nli-result-group-${blockIdx}`}>
              <ReportResultCard report={typedReport} />
            </div>
          );
        }

        const items = extractItems(result.output);
        const rendered = renderItems(result.toolName, items);
        if (!rendered) {
          return (
            <p
              key={blockIdx}
              className="text-xs text-gray-400 italic px-1"
              data-testid="nli-result-empty"
            >
              {t('ai.results.noResults')}
            </p>
          );
        }
        return (
          <div key={blockIdx} className="space-y-1.5" data-testid={`nli-result-group-${blockIdx}`}>
            {rendered}
          </div>
        );
      })}
    </div>
  );
}
