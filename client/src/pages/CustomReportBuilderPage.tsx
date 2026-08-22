/**
 * CustomReportBuilderPage — build, run, save, and export custom reports.
 *
 * Layout:
 *   Left panel  — saved reports list + "New report" button
 *   Right panel — builder form + results table/chart
 *
 * Query flow:
 *   1. User picks entity type and selects fields / filters
 *   2. "Run" → POST /api/v1/reports/custom/run  (ad-hoc, no save)
 *   3. "Save" → POST /api/v1/reports/custom (or PATCH /:id to update)
 *   4. Clicking a saved report loads its config into the builder
 *   5. "Export CSV" → POST /api/v1/reports/custom/:id/export (saved only)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ExportMenu } from '@/components/ui/ExportMenu.js';
import {
  listCustomReports,
  runAdHocReport,
  createCustomReport,
  updateCustomReport,
  deleteCustomReport,
  CUSTOM_REPORTS_QUERY_KEY,
  getCustomReportExportUrl,
  getCustomReportExportPdfUrl,
} from '@/api/customReports.js';
import { useAuth } from '@/hooks/useAuth.js';
import type {
  CustomReportResponse,
  ReportEntityType,
  ReportConfig,
  FilterCondition,
  FilterOperator,
  AggregateType,
  SortDirection,
  RunReportResponse,
  ReportVisibility,
} from '@shared/schemas/customReportSchema.js';
import {
  REPORT_ENTITY_TYPES,
  FILTER_OPERATORS,
  AGGREGATE_TYPES,
  REPORT_VISIBILITY_OPTIONS,
} from '@shared/schemas/customReportSchema.js';

// ── Field metadata per entity ──────────────────────────────────────────────────

const ENTITY_FIELDS: Record<ReportEntityType, string[]> = {
  contact: [
    'id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'title',
    'account_id',
    'created_at',
    'owner_id',
  ],
  account: ['id', 'name', 'account_type', 'website', 'created_at', 'owner_id'],
  deal: [
    'id',
    'name',
    'stage',
    'value',
    'currency',
    'probability',
    'close_date',
    'created_at',
    'owner_id',
  ],
  lead: [
    'id',
    'first_name',
    'last_name',
    'email',
    'company_name',
    'status',
    'lead_source',
    'created_at',
    'owner_id',
  ],
  activity: ['id', 'type', 'status', 'direction', 'outcome', 'created_at', 'owner_id'],
};

const NUMERIC_FIELDS: Record<ReportEntityType, string[]> = {
  contact: [],
  account: [],
  deal: ['value', 'probability'],
  lead: [],
  activity: [],
};

// ── Chart colours ──────────────────────────────────────────────────────────────
const CHART_COLORS = [
  'rgba(99,102,241,0.7)',
  'rgba(34,197,94,0.7)',
  'rgba(251,146,60,0.7)',
  'rgba(236,72,153,0.7)',
  'rgba(20,184,166,0.7)',
];
const CHART_BORDER_COLORS = [
  'rgb(99,102,241)',
  'rgb(34,197,94)',
  'rgb(251,146,60)',
  'rgb(236,72,153)',
  'rgb(20,184,166)',
];

// ── Chart drawing ──────────────────────────────────────────────────────────────

interface ChartInput {
  columns: string[];
  rows: Record<string, string | number | null>[];
  chartType: 'bar' | 'line';
}

function drawChart(canvas: HTMLCanvasElement, input: ChartInput): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { columns, rows, chartType } = input;
  if (rows.length === 0 || columns.length < 2) return;

  // Use first column as label, remaining as series
  const labelCol = columns[0];
  const seriesCols = columns.slice(1);
  const labels = rows.map((r) => String(r[labelCol] ?? ''));
  const series = seriesCols.map((col, ci) => ({
    label: col,
    data: rows.map((r) => {
      const v = r[col];
      return v === null ? 0 : Number(v);
    }),
    color: CHART_COLORS[ci % CHART_COLORS.length],
    borderColor: CHART_BORDER_COLORS[ci % CHART_BORDER_COLORS.length],
  }));

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.scale(dpr, dpr);

  const paddingLeft = 50;
  const paddingRight = 16;
  const paddingTop = 24;
  const paddingBottom = 60;
  const chartW = cssW - paddingLeft - paddingRight;
  const chartH = cssH - paddingTop - paddingBottom;

  ctx.clearRect(0, 0, cssW, cssH);

  const allValues = series.flatMap((s) => s.data);
  const maxVal = Math.max(...allValues, 1);

  // Gridlines
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = paddingTop + chartH - (i / gridLines) * chartH;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + chartW, y);
    ctx.stroke();
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'end';
    ctx.fillText(String(Math.round((i / gridLines) * maxVal)), paddingLeft - 6, y + 4);
  }

  const groupW = chartW / Math.max(labels.length, 1);
  const barW = chartType === 'bar' ? groupW / (series.length + 1) : 0;

  for (let si = 0; si < series.length; si++) {
    const s = series[si];
    ctx.strokeStyle = s.borderColor;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 2;

    if (chartType === 'bar') {
      for (let i = 0; i < s.data.length; i++) {
        const barH = (s.data[i] / maxVal) * chartH;
        const x = paddingLeft + i * groupW + si * barW + barW * 0.5;
        const y = paddingTop + chartH - barH;
        ctx.fillRect(x, y, barW * 0.9, barH);
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < s.data.length; i++) {
        const x = paddingLeft + i * groupW + groupW / 2;
        const y = paddingTop + chartH - (s.data[i] / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // X-axis labels
  ctx.fillStyle = '#374151';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < labels.length; i++) {
    const x = paddingLeft + i * groupW + groupW / 2;
    const label = labels[i].length > 12 ? labels[i].slice(0, 10) + '…' : labels[i];
    ctx.fillText(label, x, paddingTop + chartH + 16);
  }

  // Legend
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'start';
  let legendX = paddingLeft;
  for (const s of series) {
    ctx.fillStyle = s.borderColor;
    ctx.fillRect(legendX, paddingTop + chartH + 32, 12, 12);
    ctx.fillStyle = '#374151';
    ctx.fillText(s.label, legendX + 16, paddingTop + chartH + 42);
    legendX += ctx.measureText(s.label).width + 36;
  }
}

// ── Default config ─────────────────────────────────────────────────────────────

function defaultConfig(entityType: ReportEntityType): ReportConfig {
  const fields = ENTITY_FIELDS[entityType];
  return {
    selected_fields: fields.slice(0, 3),
    filters: [],
    sort_field: undefined,
    sort_direction: undefined,
    group_by: undefined,
    aggregate: undefined,
    chart_type: undefined,
  };
}

// ── Filter row component ───────────────────────────────────────────────────────

const VALUE_LESS_OPERATORS: FilterOperator[] = ['is_null', 'is_not_null'];

interface FilterRowProps {
  filter: FilterCondition;
  index: number;
  fields: string[];
  onChange: (updated: FilterCondition) => void;
  onRemove: () => void;
}

function FilterRow({ filter, index, fields, onChange, onRemove }: FilterRowProps) {
  const { t } = useTranslation();
  const noValue = VALUE_LESS_OPERATORS.includes(filter.operator);

  return (
    <div className="flex flex-wrap gap-2 items-center" data-testid={`filter-row-${index}`}>
      <select
        className="border border-gray-300 rounded px-2 py-1 text-sm"
        value={filter.field}
        onChange={(e) => onChange({ ...filter, field: e.target.value })}
        data-testid={`filter-field-${index}`}
        aria-label={t('reports.customReports.filterField')}
      >
        {fields.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      <select
        className="border border-gray-300 rounded px-2 py-1 text-sm"
        value={filter.operator}
        onChange={(e) =>
          onChange({ ...filter, operator: e.target.value as FilterOperator, value: undefined })
        }
        data-testid={`filter-operator-${index}`}
        aria-label={t('reports.customReports.filterOperator')}
      >
        {FILTER_OPERATORS.map((op) => (
          <option key={op} value={op}>
            {t(
              `reports.customReports.operator${op.charAt(0).toUpperCase() + op.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`,
            )}
          </option>
        ))}
      </select>

      {!noValue && (
        <input
          type="text"
          className="border border-gray-300 rounded px-2 py-1 text-sm w-36"
          value={filter.value ?? ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value || undefined })}
          placeholder={t('reports.customReports.filterValue')}
          data-testid={`filter-value-${index}`}
          aria-label={t('reports.customReports.filterValue')}
        />
      )}

      <button
        type="button"
        className="text-sm text-red-600 hover:text-red-800"
        onClick={onRemove}
        data-testid={`filter-remove-${index}`}
        aria-label={t('reports.customReports.removeFilter')}
      >
        {t('reports.customReports.removeFilter')}
      </button>
    </div>
  );
}

// ── Save dialog ────────────────────────────────────────────────────────────────

interface SaveDialogProps {
  initialName: string;
  onConfirm: (name: string, visibility: ReportVisibility) => void;
  onCancel: () => void;
  isSaving: boolean;
}

function SaveDialog({ initialName, onConfirm, onCancel, isSaving }: SaveDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState<ReportVisibility>('public');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) onConfirm(name.trim(), visibility);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-dialog-title"
      data-testid="save-report-dialog"
    >
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 id="save-dialog-title" className="text-lg font-semibold text-gray-900 mb-4">
          {t('reports.customReports.saveDialog.title')}
        </h2>
        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('reports.customReports.saveDialog.nameLabel')}
          </label>
          <input
            ref={inputRef}
            type="text"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('reports.customReports.saveDialog.namePlaceholder')}
            data-testid="save-report-name-input"
            maxLength={200}
            required
          />
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('reports.customReports.saveDialog.visibilityLabel')}
          </label>
          <select
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as ReportVisibility)}
            data-testid="save-report-visibility-select"
          >
            {REPORT_VISIBILITY_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {t(`reports.customReports.visibility.${v}`)}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              onClick={onCancel}
              data-testid="save-report-cancel"
            >
              {t('reports.customReports.saveDialog.cancel')}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSaving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
              data-testid="save-report-confirm"
            >
              {t('reports.customReports.saveDialog.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CustomReportBuilderContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── Saved reports list ──────────────────────────────────────────────────────
  const {
    data: savedReports,
    isLoading: isLoadingSaved,
    isError: isErrorSaved,
  } = useQuery({
    queryKey: CUSTOM_REPORTS_QUERY_KEY,
    queryFn: listCustomReports,
  });

  // ── Builder state ───────────────────────────────────────────────────────────
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeReportVisibility, setActiveReportVisibility] = useState<ReportVisibility>('public');
  const [entityType, setEntityType] = useState<ReportEntityType>('contact');
  const [config, setConfig] = useState<ReportConfig>(() => defaultConfig('contact'));
  const [result, setResult] = useState<RunReportResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Draw chart when result or chart_type changes ────────────────────────────
  useEffect(() => {
    if (!result || !config.chart_type || !canvasRef.current) return;
    drawChart(canvasRef.current, {
      columns: result.columns,
      rows: result.rows,
      chartType: config.chart_type,
    });
  }, [result, config.chart_type]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const runMutation = useMutation({
    mutationFn: () => runAdHocReport(entityType, config),
    onSuccess: (data) => {
      setResult(data);
      setRunError(null);
    },
    onError: () => {
      setRunError(t('reports.customReports.errorRun'));
      setResult(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: ({ name, visibility }: { name: string; visibility: ReportVisibility }) =>
      createCustomReport({ name, entity_type: entityType, config, visibility }),
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: CUSTOM_REPORTS_QUERY_KEY });
      setActiveReportId(report.id);
      setShowSaveDialog(false);
      setSaveError(null);
    },
    onError: () => {
      setSaveError(t('reports.customReports.errorSave'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: ReportVisibility }) =>
      updateCustomReport(id, { config, visibility }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOM_REPORTS_QUERY_KEY });
      setSaveError(null);
    },
    onError: () => {
      setSaveError(t('reports.customReports.errorSave'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCustomReport(id),
    onSuccess: (_, deletedId) => {
      void queryClient.invalidateQueries({ queryKey: CUSTOM_REPORTS_QUERY_KEY });
      if (activeReportId === deletedId) {
        setActiveReportId(null);
        setResult(null);
      }
      setPendingDeleteId(null);
      setDeleteError(null);
    },
    onError: () => {
      setDeleteError(t('reports.customReports.deleteError'));
      setPendingDeleteId(null);
    },
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const fields = ENTITY_FIELDS[entityType];

  function changeEntityType(et: ReportEntityType) {
    setEntityType(et);
    setConfig(defaultConfig(et));
    setResult(null);
    setActiveReportId(null);
  }

  function loadReport(report: CustomReportResponse) {
    setActiveReportId(report.id);
    setActiveReportVisibility(report.visibility);
    setEntityType(report.entity_type as ReportEntityType);
    setConfig(report.config);
    setResult(null);
  }

  function toggleField(field: string) {
    setConfig((prev) => {
      // When grouped, only the group_by column itself may be selected.
      if (prev.group_by && field !== prev.group_by) return prev;
      const already = prev.selected_fields.includes(field);
      const next = already
        ? prev.selected_fields.filter((f) => f !== field)
        : [...prev.selected_fields, field];
      // Keep at least one field selected
      return { ...prev, selected_fields: next.length > 0 ? next : prev.selected_fields };
    });
  }

  function addFilter() {
    setConfig((prev) => ({
      ...prev,
      filters: [...prev.filters, { field: fields[0], operator: 'eq' as FilterOperator }],
    }));
  }

  function updateFilter(index: number, updated: FilterCondition) {
    setConfig((prev) => {
      const filters = [...prev.filters];
      filters[index] = updated;
      return { ...prev, filters };
    });
  }

  function removeFilter(index: number) {
    setConfig((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== index),
    }));
  }

  const handleSaveConfirm = useCallback(
    (name: string, visibility: ReportVisibility) => {
      createMutation.mutate({ name, visibility });
    },
    [createMutation],
  );

  const handleUpdate = useCallback(() => {
    if (activeReportId)
      updateMutation.mutate({ id: activeReportId, visibility: activeReportVisibility });
  }, [activeReportId, activeReportVisibility, updateMutation]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Mirrors the capabilities the server checks: reports:create/edit/export are held by
  // admin and manager, reports:delete by admin alone. Hidden rather than left to 403.
  const canAuthorReports = user?.role === 'admin' || user?.role === 'manager';
  const canExportReports = canAuthorReports;
  const canDeleteReports = user?.role === 'admin';

  const activeReport = savedReports?.find((r) => r.id === activeReportId) ?? null;
  const activeReportCanMutate =
    activeReport !== null &&
    canAuthorReports &&
    (user?.role === 'admin' ||
      activeReport.created_by === user?.id ||
      activeReport.visibility === 'public');

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-6 items-start" data-testid="custom-report-builder">
      {/* Saved reports sidebar */}
      <aside className="w-56 shrink-0" data-testid="saved-reports-sidebar">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">
            {t('reports.customReports.savedReports')}
          </h2>
          <button
            type="button"
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            onClick={() => {
              setActiveReportId(null);
              setConfig(defaultConfig(entityType));
              setResult(null);
            }}
            data-testid="new-report-button"
          >
            {t('reports.customReports.newReport')}
          </button>
        </div>

        {isLoadingSaved && (
          <p className="text-sm text-gray-500" data-testid="saved-reports-loading">
            {t('reports.customReports.loading')}
          </p>
        )}
        {isErrorSaved && (
          <p className="text-sm text-red-600" data-testid="saved-reports-error">
            {t('reports.customReports.errorLoad')}
          </p>
        )}
        {!isLoadingSaved && !isErrorSaved && savedReports && savedReports.length === 0 && (
          <p className="text-sm text-gray-400" data-testid="saved-reports-empty">
            {t('reports.customReports.noSavedReports')}
          </p>
        )}

        <ul className="space-y-1" data-testid="saved-reports-list">
          {savedReports?.map((report) => {
            // Narrower than it looks: reps previously deleted their own reports, but
            // reports:delete is admin-only, so ownership no longer grants it.
            const canMutate = canDeleteReports;
            return (
              <li key={report.id} className="group flex items-center gap-1 min-w-0">
                <button
                  type="button"
                  className={`flex-1 min-w-0 text-start text-sm px-2 py-1 rounded truncate ${
                    activeReportId === report.id
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                  onClick={() => loadReport(report)}
                  data-testid={`saved-report-${report.id}`}
                >
                  <span className="truncate">{report.name}</span>
                </button>
                <span
                  className={`shrink-0 text-xs px-1 py-0.5 rounded ${
                    report.visibility === 'private'
                      ? 'bg-gray-100 text-gray-500'
                      : report.visibility === 'public_read_only'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-green-50 text-green-700'
                  }`}
                  data-testid={`report-visibility-${report.id}`}
                  title={t(`reports.customReports.visibility.${report.visibility}`)}
                >
                  {report.visibility === 'private'
                    ? '🔒'
                    : report.visibility === 'public_read_only'
                      ? '👁'
                      : '✓'}
                </span>
                {canMutate && (
                  <button
                    type="button"
                    className="hidden group-hover:block shrink-0 text-gray-400 hover:text-red-600 text-xs px-1"
                    onClick={() => setPendingDeleteId(report.id)}
                    data-testid={`delete-report-${report.id}`}
                    aria-label={t('reports.customReports.deleteConfirm')}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {deleteError && (
          <p className="text-sm text-red-600 mt-2" data-testid="delete-report-error">
            {deleteError}
          </p>
        )}

        {/* Inline delete confirm */}
        {pendingDeleteId && (
          <div
            className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm"
            data-testid="delete-confirm-panel"
          >
            <p className="text-red-700 mb-2">{t('reports.customReports.deleteConfirm')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                onClick={() => deleteMutation.mutate(pendingDeleteId)}
                data-testid="delete-confirm-yes"
              >
                {t('reports.customReports.deleteConfirm')}
              </button>
              <button
                type="button"
                className="px-2 py-1 text-gray-600 text-xs hover:text-gray-800"
                onClick={() => setPendingDeleteId(null)}
                data-testid="delete-confirm-cancel"
              >
                {t('reports.customReports.saveDialog.cancel')}
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Builder + results */}
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          {t('reports.customReports.builderHeading')}
        </h2>

        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5">
          {/* Entity type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('reports.customReports.entityTypeLabel')}
            </label>
            <select
              className="border border-gray-300 rounded px-3 py-2 text-sm"
              value={entityType}
              onChange={(e) => changeEntityType(e.target.value as ReportEntityType)}
              data-testid="entity-type-select"
            >
              {REPORT_ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>
                  {t(`reports.customReports.entity${et.charAt(0).toUpperCase() + et.slice(1)}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Field selection */}
          <div>
            <fieldset>
              <legend className="text-sm font-medium text-gray-700 mb-2">
                {t('reports.customReports.fieldsLabel')}
              </legend>
              <div className="flex flex-wrap gap-2" data-testid="fields-selector">
                {fields.map((field) => {
                  const disabled = !!config.group_by && field !== config.group_by;
                  return (
                    <label
                      key={field}
                      className={`flex items-center gap-1 text-sm ${disabled ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer'}`}
                      title={
                        disabled ? t('reports.customReports.fieldDisabledByGroupBy') : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={config.selected_fields.includes(field)}
                        onChange={() => toggleField(field)}
                        disabled={disabled}
                        data-testid={`field-checkbox-${field}`}
                        className="rounded border-gray-300"
                      />
                      {field}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          {/* Filters */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {t('reports.customReports.filtersLabel')}
              </span>
              <button
                type="button"
                className="text-xs text-indigo-600 hover:text-indigo-800"
                onClick={addFilter}
                data-testid="add-filter-button"
              >
                {t('reports.customReports.addFilter')}
              </button>
            </div>
            <div className="space-y-2" data-testid="filters-list">
              {config.filters.map((filter, i) => (
                <FilterRow
                  key={i}
                  filter={filter}
                  index={i}
                  fields={fields}
                  onChange={(updated) => updateFilter(i, updated)}
                  onRemove={() => removeFilter(i)}
                />
              ))}
            </div>
          </div>

          {/* Group by + aggregate */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reports.customReports.groupByLabel')}
              </label>
              <select
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                value={config.group_by ?? ''}
                onChange={(e) => {
                  const groupBy = e.target.value || undefined;
                  setConfig((prev) => ({
                    ...prev,
                    group_by: groupBy,
                    // A grouped/aggregated query can only select the group_by
                    // column itself — any other selected field would violate
                    // PostgreSQL GROUP BY rules (see server validateConfig).
                    selected_fields: groupBy ? [groupBy] : prev.selected_fields,
                  }));
                }}
                data-testid="group-by-select"
              >
                <option value="">{t('reports.customReports.groupByNone')}</option>
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reports.customReports.aggregateLabel')}
              </label>
              <select
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                value={config.aggregate?.type ?? ''}
                onChange={(e) => {
                  const val = e.target.value as AggregateType | '';
                  setConfig((prev) => ({
                    ...prev,
                    aggregate: val ? { type: val } : undefined,
                  }));
                }}
                data-testid="aggregate-type-select"
              >
                <option value="">{t('reports.customReports.aggregateNone')}</option>
                {AGGREGATE_TYPES.map((at) => (
                  <option key={at} value={at}>
                    {t(
                      `reports.customReports.aggregate${at.charAt(0).toUpperCase() + at.slice(1)}`,
                    )}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Sum field picker (only when aggregate = sum) */}
          {config.aggregate?.type === 'sum' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reports.customReports.aggregateSumField')}
              </label>
              <select
                className="border border-gray-300 rounded px-2 py-1 text-sm"
                value={config.aggregate.field ?? ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    aggregate: { type: 'sum', field: e.target.value || undefined },
                  }))
                }
                data-testid="aggregate-sum-field-select"
              >
                <option value="">—</option>
                {NUMERIC_FIELDS[entityType].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sort */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reports.customReports.sortByLabel')}
              </label>
              <select
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                value={config.sort_field ?? ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sort_field: e.target.value || undefined,
                  }))
                }
                data-testid="sort-field-select"
              >
                <option value="">{t('reports.customReports.sortByNone')}</option>
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('reports.customReports.sortDirectionLabel')}
              </label>
              <select
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                value={config.sort_direction ?? 'asc'}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sort_direction: e.target.value as SortDirection,
                  }))
                }
                data-testid="sort-direction-select"
              >
                <option value="asc">{t('reports.customReports.sortDirectionAsc')}</option>
                <option value="desc">{t('reports.customReports.sortDirectionDesc')}</option>
              </select>
            </div>
          </div>

          {/* Chart type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('reports.customReports.chartTypeLabel')}
            </label>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-sm"
              value={config.chart_type ?? ''}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  chart_type: (e.target.value as 'bar' | 'line') || undefined,
                }))
              }
              data-testid="chart-type-select"
            >
              <option value="">{t('reports.customReports.chartTypeNone')}</option>
              <option value="bar">{t('reports.customReports.chartTypeBar')}</option>
              <option value="line">{t('reports.customReports.chartTypeLine')}</option>
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100 items-center">
            <button
              type="button"
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending || config.selected_fields.length === 0}
              data-testid="run-report-button"
            >
              {runMutation.isPending
                ? t('reports.customReports.runningButton')
                : t('reports.customReports.runButton')}
            </button>

            {activeReportId && activeReportCanMutate && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="active-report-visibility-select"
                  className="text-sm text-gray-600 shrink-0"
                >
                  {t('reports.customReports.saveDialog.visibilityLabel')}
                </label>
                <select
                  id="active-report-visibility-select"
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                  value={activeReportVisibility}
                  onChange={(e) => setActiveReportVisibility(e.target.value as ReportVisibility)}
                  data-testid="active-report-visibility-select"
                >
                  {REPORT_VISIBILITY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {t(`reports.customReports.visibility.${v}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {canAuthorReports && activeReportId ? (
              <>
                <button
                  type="button"
                  className="px-4 py-2 bg-white border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50"
                  onClick={handleUpdate}
                  disabled={isSaving}
                  data-testid="update-report-button"
                >
                  {t('reports.customReports.updateButton')}
                </button>
                <button
                  type="button"
                  className="px-4 py-2 bg-white border border-gray-300 text-sm rounded hover:bg-gray-50"
                  onClick={() => setShowSaveDialog(true)}
                  data-testid="save-as-new-button"
                >
                  {t('reports.customReports.saveAsNewButton')}
                </button>
              </>
            ) : canAuthorReports ? (
              <button
                type="button"
                className="px-4 py-2 bg-white border border-gray-300 text-sm rounded hover:bg-gray-50"
                onClick={() => setShowSaveDialog(true)}
                data-testid="save-report-button"
              >
                {t('reports.customReports.saveButton')}
              </button>
            ) : null}

            {canExportReports && activeReportId && result && (
              <ExportMenu
                label={t('common.export')}
                testId="custom-reports-export-menu-button"
                items={[
                  {
                    key: 'csv',
                    testId: 'custom-reports-export-csv-button',
                    label: t('reports.customReports.exportCsv'),
                    href: getCustomReportExportUrl(activeReportId),
                  },
                  {
                    key: 'pdf',
                    testId: 'custom-reports-export-pdf-button',
                    label: t('reports.customReports.exportPdf'),
                    href: getCustomReportExportPdfUrl(activeReportId),
                  },
                ]}
              />
            )}
          </div>

          {saveError && (
            <p className="text-sm text-red-600" data-testid="save-report-error">
              {saveError}
            </p>
          )}
        </div>

        {/* Results */}
        {runError && (
          <div
            className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700"
            data-testid="run-report-error"
          >
            {runError}
          </div>
        )}

        {result && (
          <div className="mt-6" data-testid="report-results">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">
                {t('reports.customReports.resultsHeading')}
              </h3>
              <span className="text-sm text-gray-500" data-testid="results-count">
                {t('reports.customReports.resultsCount', { count: result.row_count })}
              </span>
            </div>

            {/* Chart */}
            {config.chart_type && result.rows.length > 0 && (
              <div className="mb-4 bg-white border border-gray-200 rounded-lg p-4">
                <canvas
                  ref={canvasRef}
                  className="w-full"
                  style={{ height: 260 }}
                  data-testid="report-chart"
                />
              </div>
            )}

            {/* Table */}
            {result.rows.length === 0 ? (
              <p className="text-sm text-gray-500 py-4" data-testid="results-empty">
                {t('reports.customReports.resultsEmpty')}
              </p>
            ) : (
              <div
                className="overflow-x-auto rounded-lg border border-gray-200"
                data-testid="results-table"
              >
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {result.columns.map((col) => (
                        <th
                          key={col}
                          className="px-4 py-3 text-start font-medium text-gray-500 uppercase tracking-wider text-xs"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {result.rows.map((row, ri) => (
                      <tr key={ri} data-testid={`result-row-${ri}`}>
                        {result.columns.map((col) => (
                          <td key={col} className="px-4 py-2 text-gray-900 break-words">
                            {row[col] === null ? '—' : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save dialog */}
      {showSaveDialog && (
        <SaveDialog
          initialName={
            activeReportId ? (savedReports?.find((r) => r.id === activeReportId)?.name ?? '') : ''
          }
          onConfirm={handleSaveConfirm}
          onCancel={() => setShowSaveDialog(false)}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
