/**
 * Renders an NLI-generated report inline in the conversation thread as a
 * summary table. Supports win_loss, activity_volume, and stage_trend report
 * types. Uses summary tables rather than interactive charts — the full chart
 * view is in the Reports module. (MINCRM-424)
 */
import { useTranslation } from 'react-i18next';

// ── Win/Loss ──────────────────────────────────────────────────────────────────

interface WinLossRepRow {
  ownerName: string;
  wonCount: number;
  lostCount: number;
  winRate: number | null;
}

interface WinLossData {
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  currency?: string;
  homeCurrency?: string;
  repRows?: WinLossRepRow[];
}

// ── Activity Volume ───────────────────────────────────────────────────────────

interface ActivityTypeCounts {
  Note: number;
  Call: number;
  Email: number;
  Meeting: number;
  Task: number;
}

interface ActivityVolumeRepRow {
  ownerName: string;
  counts: ActivityTypeCounts;
  total: number;
}

interface ActivityVolumeData {
  totals?: ActivityTypeCounts & { total: number };
  rows?: ActivityVolumeRepRow[];
}

// ── Stage Trend ───────────────────────────────────────────────────────────────

interface StageTrendDataPoint {
  stage: string;
  entered?: number;
  converted?: number;
}

interface StageTrendData {
  stages?: string[];
  dataPoints?: StageTrendDataPoint[];
  windowStart?: string;
  windowEnd?: string;
}

// ── Union ──────────────────────────────────────────────────────────────────────

type ReportData =
  | { report_type: 'win_loss'; data: WinLossData }
  | { report_type: 'activity_volume'; data: ActivityVolumeData }
  | { report_type: 'stage_trend'; data: StageTrendData };

interface ReportResultCardProps {
  report: ReportData;
}

function WinLossTable({ data }: { data: WinLossData }) {
  const { t } = useTranslation();
  const currency = data.homeCurrency ?? data.currency ?? 'USD';

  return (
    <div data-testid="nli-report-win-loss">
      <div className="flex gap-6 text-sm mb-3">
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">{data.wonCount}</p>
          <p className="text-xs text-gray-500">{t('ai.results.report.won')}</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-red-500">{data.lostCount}</p>
          <p className="text-xs text-gray-500">{t('ai.results.report.lost')}</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-800">
            {data.winRate != null
              ? t('ai.results.report.winRateValue', { value: (data.winRate * 100).toFixed(0) })
              : '—'}
          </p>
          <p className="text-xs text-gray-500">{t('ai.results.report.winRate')}</p>
        </div>
      </div>
      {data.repRows && data.repRows.length > 0 && (
        <table className="w-full text-xs text-left border-t border-gray-100">
          <thead>
            <tr className="text-gray-400">
              <th className="py-1 pe-3 font-medium">{t('ai.results.report.rep')}</th>
              <th className="py-1 pe-3 font-medium text-end">{t('ai.results.report.won')}</th>
              <th className="py-1 pe-3 font-medium text-end">{t('ai.results.report.lost')}</th>
            </tr>
          </thead>
          <tbody>
            {data.repRows.map((row) => (
              <tr key={row.ownerName} className="border-t border-gray-50">
                <td className="py-1 pe-3 text-gray-700">{row.ownerName}</td>
                <td className="py-1 pe-3 text-end text-green-600">{row.wonCount}</td>
                <td className="py-1 pe-3 text-end text-red-500">{row.lostCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-gray-400 mt-1">{currency}</p>
    </div>
  );
}

function ActivityVolumeTable({ data }: { data: ActivityVolumeData }) {
  const { t } = useTranslation();
  const rows = data.rows ?? [];

  return (
    <div data-testid="nli-report-activity-volume">
      {data.totals && (
        <p className="text-sm font-semibold text-gray-800 mb-2">
          {t('ai.results.report.totalActivities', { count: data.totals.total })}
        </p>
      )}
      {rows.length > 0 && (
        <table className="w-full text-xs text-left border-t border-gray-100">
          <thead>
            <tr className="text-gray-400">
              <th className="py-1 pe-3 font-medium">{t('ai.results.report.rep')}</th>
              <th className="py-1 pe-3 font-medium text-end">{t('ai.results.report.total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ownerName} className="border-t border-gray-50">
                <td className="py-1 pe-3 text-gray-700">{row.ownerName}</td>
                <td className="py-1 pe-3 text-end text-gray-800">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StageTrendTable({ data }: { data: StageTrendData }) {
  const { t } = useTranslation();
  const points = data.dataPoints ?? [];

  return (
    <div data-testid="nli-report-stage-trend">
      {(data.windowStart ?? data.windowEnd) && (
        <p className="text-xs text-gray-400 mb-2">
          {t('ai.results.report.dateRange', {
            from: data.windowStart?.slice(0, 10) ?? '',
            to: data.windowEnd?.slice(0, 10) ?? '',
          })}
        </p>
      )}
      {points.length > 0 && (
        <table className="w-full text-xs text-left border-t border-gray-100">
          <thead>
            <tr className="text-gray-400">
              <th className="py-1 pe-3 font-medium">{t('ai.results.report.stage')}</th>
              <th className="py-1 pe-3 font-medium text-end">{t('ai.results.report.entries')}</th>
              <th className="py-1 pe-3 font-medium text-end">
                {t('ai.results.report.conversions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((pt) => (
              <tr key={pt.stage} className="border-t border-gray-50">
                <td className="py-1 pe-3 text-gray-700">{pt.stage}</td>
                <td className="py-1 pe-3 text-end text-gray-800">{pt.entered ?? 0}</td>
                <td className="py-1 pe-3 text-end text-gray-800">{pt.converted ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const REPORT_TITLE_KEYS: Record<string, string> = {
  win_loss: 'ai.results.report.title_win_loss',
  activity_volume: 'ai.results.report.title_activity_volume',
  stage_trend: 'ai.results.report.title_stage_trend',
};

export default function ReportResultCard({ report }: ReportResultCardProps) {
  const { t } = useTranslation();

  const titleKey = REPORT_TITLE_KEYS[report.report_type] ?? 'ai.results.report.title_win_loss';

  return (
    <div
      className="py-3 px-4 rounded-lg border border-blue-100 bg-blue-50"
      data-testid={`nli-report-card-${report.report_type}`}
    >
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-3">
        {t(titleKey)}
      </p>
      {report.report_type === 'win_loss' && <WinLossTable data={report.data as WinLossData} />}
      {report.report_type === 'activity_volume' && (
        <ActivityVolumeTable data={report.data as ActivityVolumeData} />
      )}
      {report.report_type === 'stage_trend' && (
        <StageTrendTable data={report.data as StageTrendData} />
      )}
      <p className="text-xs text-blue-400 mt-2 italic">{t('ai.results.report.viewFullReport')}</p>
    </div>
  );
}
