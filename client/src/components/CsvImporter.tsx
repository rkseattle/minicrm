/**
 * CsvImporter — shared wizard component for importing CRM data from CSV files.
 * Steps: 1) file select → 2) column mapping → 3) preview → 4) confirm + run → 5) progress → 6) summary.
 * Used by AdminSettingsPage for accounts, contacts, and deals.
 * MINCRM-158, MINCRM-159, MINCRM-160, MINCRM-255
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { parseCsv, startImport, getImportJob } from '@/api/import.js';
import type { CrmField, ImportEntity, ParseResponse, ImportJobResponse } from '@/api/import.js';

/** Max file size in bytes exposed to the UI (10 MB) */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** How often to poll the job status endpoint while the import is running */
const POLL_INTERVAL_MS = 2000;

type WizardStep = 'select' | 'mapping' | 'preview' | 'running' | 'summary';

export interface CsvImporterProps {
  /** The CRM entity being imported */
  entity: ImportEntity;
  /** Entity-specific label for the importer heading */
  entityLabel: string;
  /** Additional import options (flags) available for this entity */
  options?: CsvImporterOption[];
}

/** An optional boolean flag surfaced in the UI during the mapping step */
export interface CsvImporterOption {
  key: string;
  label: string;
  defaultValue: boolean;
}

/**
 * Multi-step CSV import wizard with background job polling.
 */
export default function CsvImporter({ entity, entityLabel, options = [] }: CsvImporterProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<WizardStep>('select');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parseData, setParseData] = useState<ParseResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  // mapping: CRM field key → chosen CSV column header
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // option flags: option.key → boolean value
  const [optionValues, setOptionValues] = useState<Record<string, boolean>>(
    Object.fromEntries(options.map((o) => [o.key, o.defaultValue])),
  );

  // Background job tracking (MINCRM-255)
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<ImportJobResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ── Progress polling ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!jobId || step !== 'running') return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let elapsedTimer: ReturnType<typeof setInterval> | null = null;

    setElapsedSeconds(0);
    elapsedTimer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    async function poll(): Promise<void> {
      if (cancelled) return;
      try {
        const job = await getImportJob(jobId!);
        if (cancelled) return;
        setJobData(job);
        if (job.status === 'complete' || job.status === 'failed') {
          if (elapsedTimer) clearInterval(elapsedTimer);
          setStep('summary');
        } else {
          timerId = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) {
          timerId = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      if (elapsedTimer) clearInterval(elapsedTimer);
    };
  }, [jobId, step]);

  // ── Step 1: File selection ─────────────────────────────────────────────────

  async function handleFileSelect(selectedFile: File): Promise<void> {
    setFileError(null);
    setParseError(null);

    if (!selectedFile.name.toLowerCase().endsWith('.csv') && selectedFile.type !== 'text/csv') {
      setFileError(t('import.error.notCsv'));
      return;
    }
    if (selectedFile.size > MAX_FILE_BYTES) {
      setFileError(t('import.error.tooLarge'));
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);
    setStep('mapping');

    try {
      const parsed = await parseCsv(entity, selectedFile);
      setParseData(parsed);
      const autoMapping: Record<string, string> = {};
      for (const field of parsed.fields) {
        const match = parsed.headers.find(
          (h) =>
            h.toLowerCase() === field.key.toLowerCase() ||
            h.toLowerCase() === field.label.toLowerCase(),
        );
        if (match) autoMapping[field.key] = match;
      }
      setMapping(autoMapping);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('import.error.parseFailed');
      setParseError(message);
    } finally {
      setIsParsing(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const selected = e.target.files?.[0];
    if (selected) void handleFileSelect(selected);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) void handleFileSelect(dropped);
  }

  // ── Step 2: Column mapping ─────────────────────────────────────────────────

  function handleMappingChange(fieldKey: string, csvHeader: string): void {
    setMapping((prev) => ({ ...prev, [fieldKey]: csvHeader }));
  }

  function isMappingComplete(): boolean {
    if (!parseData) return false;
    return parseData.fields
      .filter((f) => f.required)
      .every((f) => (mapping[f.key] ?? '').length > 0);
  }

  // ── Step 3: Preview ────────────────────────────────────────────────────────

  function getMappedValue(row: Record<string, string>, fieldKey: string): string {
    const header = mapping[fieldKey];
    if (!header) return '';
    return row[header] ?? '';
  }

  // ── Step 4: Run import ─────────────────────────────────────────────────────

  async function handleRunImport(): Promise<void> {
    if (!file) return;
    setStep('running');
    setRunError(null);
    setJobData(null);
    try {
      const cleanMapping: Record<string, string> = Object.fromEntries(
        Object.entries(mapping).filter(([, v]) => v.length > 0),
      );
      const result = await startImport(entity, file, cleanMapping, optionValues);
      setJobId(result.job_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('import.error.runFailed');
      setRunError(message);
      setStep('preview');
    }
  }

  // ── Step 5: Download error report ─────────────────────────────────────────

  function handleDownloadErrors(): void {
    if (!jobData?.error_csv) return;
    const blob = new Blob([jobData.error_csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entity}-import-errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  function handleReset(): void {
    setStep('select');
    setFile(null);
    setFileError(null);
    setParseData(null);
    setParseError(null);
    setMapping({});
    setOptionValues(Object.fromEntries(options.map((o) => [o.key, o.defaultValue])));
    setJobId(null);
    setJobData(null);
    setRunError(null);
    setElapsedSeconds(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Progress bar helpers ───────────────────────────────────────────────────

  function progressPercent(): number {
    if (!jobData?.total_rows || jobData.total_rows === 0) return 0;
    return Math.min(100, Math.round((jobData.processed_rows / jobData.total_rows) * 100));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div data-testid={`csv-importer-${entity}`}>
      {/* Step 1: File select */}
      {step === 'select' && (
        <div>
          <div
            role="button"
            tabIndex={0}
            data-testid={`${entity}-drop-zone`}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <p className="text-sm text-gray-600">
              {t('import.dropZoneHint', { entity: entityLabel })}
            </p>
            <p className="text-xs text-gray-500 mt-1">{t('import.csvOnly')}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label={t('import.fileInputLabel', { entity: entityLabel })}
            data-testid={`${entity}-file-input`}
            onChange={handleInputChange}
          />
          {fileError && (
            <p
              role="alert"
              className="mt-2 text-sm text-red-600"
              data-testid={`${entity}-file-error`}
            >
              {fileError}
            </p>
          )}
        </div>
      )}

      {/* Step 2 + 3: Mapping + Preview */}
      {(step === 'mapping' || step === 'preview') && (
        <div>
          {isParsing && (
            <p className="text-sm text-gray-500" data-testid={`${entity}-parsing`}>
              {t('import.parsing')}
            </p>
          )}

          {parseError && (
            <p role="alert" className="text-sm text-red-600" data-testid={`${entity}-parse-error`}>
              {parseError}
            </p>
          )}

          {parseData && !isParsing && (
            <>
              <p className="text-xs text-gray-500 mb-4">
                {t('import.selectedFile')}{' '}
                <span className="font-medium text-gray-700" data-testid={`${entity}-selected-file`}>
                  {file?.name}
                </span>
              </p>

              {/* Column mapping */}
              <h3 className="text-sm font-semibold text-gray-800 mb-3">
                {t('import.mappingHeading')}
              </h3>
              <div className="space-y-3 mb-6">
                {parseData.fields.map((field: CrmField) => (
                  <div key={field.key} className="flex items-center gap-4">
                    <label
                      htmlFor={`${entity}-map-${field.key}`}
                      className="w-44 text-sm text-gray-700 shrink-0"
                    >
                      {field.label}
                      {field.required && (
                        <span className="ms-1 text-red-500" aria-label={t('import.required')}>
                          *
                        </span>
                      )}
                    </label>
                    <select
                      id={`${entity}-map-${field.key}`}
                      data-testid={`${entity}-map-${field.key}`}
                      value={mapping[field.key] ?? ''}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                      className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">{t('import.selectColumn')}</option>
                      {parseData.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Entity-specific option flags */}
              {options.length > 0 && (
                <div className="space-y-2 mb-6">
                  {options.map((opt) => (
                    <label key={opt.key} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        data-testid={`${entity}-option-${opt.key}`}
                        checked={optionValues[opt.key] ?? opt.defaultValue}
                        onChange={(e) =>
                          setOptionValues((prev) => ({ ...prev, [opt.key]: e.target.checked }))
                        }
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              )}

              {/* Preview table */}
              {step === 'preview' && parseData.preview.length > 0 && (
                <div className="mb-6 overflow-x-auto">
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">
                    {t('import.previewHeading')}
                  </h3>
                  <table className="min-w-full text-xs border border-gray-200 rounded">
                    <thead className="bg-gray-50">
                      <tr>
                        {parseData.fields
                          .filter((f) => mapping[f.key])
                          .map((f) => (
                            <th
                              key={f.key}
                              className="px-3 py-2 text-start font-medium text-gray-600 border-b border-gray-200"
                            >
                              {f.label}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parseData.preview.map((row, rowIdx) => (
                        <tr
                          key={rowIdx}
                          className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                          data-testid={`${entity}-preview-row-${rowIdx}`}
                        >
                          {parseData.fields
                            .filter((f) => mapping[f.key])
                            .map((f) => {
                              const val = getMappedValue(row, f.key);
                              const isEmpty = f.required && !val;
                              return (
                                <td
                                  key={f.key}
                                  className={`px-3 py-2 border-b border-gray-100 ${isEmpty ? 'bg-yellow-50 text-yellow-700' : ''}`}
                                >
                                  {val || (isEmpty ? t('import.missingValue') : '')}
                                </td>
                              );
                            })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {runError && (
                <p
                  role="alert"
                  className="mb-4 text-sm text-red-600"
                  data-testid={`${entity}-run-error`}
                >
                  {runError}
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  size="md"
                  data-testid={`${entity}-back-button`}
                  onClick={handleReset}
                >
                  {t('import.back')}
                </Button>

                {step === 'mapping' && (
                  <Button
                    variant="primary"
                    size="md"
                    data-testid={`${entity}-preview-button`}
                    disabled={!isMappingComplete()}
                    onClick={() => setStep('preview')}
                  >
                    {t('import.previewButton')}
                  </Button>
                )}

                {step === 'preview' && (
                  <Button
                    variant="primary"
                    size="md"
                    data-testid={`${entity}-run-button`}
                    onClick={() => void handleRunImport()}
                  >
                    {t('import.runButton', { entity: entityLabel })}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: Running — progress bar */}
      {step === 'running' && (
        <div data-testid={`${entity}-running`} className="space-y-4">
          <div className="flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4 text-indigo-600 shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <p className="text-sm text-gray-600">{t('import.running', { entity: entityLabel })}</p>
          </div>

          {/* Progress bar */}
          {jobData && jobData.total_rows !== null && (
            <>
              <div
                role="progressbar"
                aria-valuenow={progressPercent()}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('import.progressLabel')}
                data-testid={`${entity}-progress-bar`}
                className="w-full bg-gray-200 rounded-full h-2"
              >
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent()}%` }}
                />
              </div>
              <p className="text-xs text-gray-500" data-testid={`${entity}-progress-text`}>
                {t('import.progressText', {
                  processed: jobData.processed_rows,
                  total: jobData.total_rows,
                  percent: progressPercent(),
                })}
              </p>
            </>
          )}

          {/* Live counters */}
          {jobData && (
            <ul className="text-xs text-gray-600 space-y-0.5">
              <li data-testid={`${entity}-progress-created`}>
                {t('import.progressCreated', { count: jobData.created })}
              </li>
              <li data-testid={`${entity}-progress-skipped`}>
                {t('import.progressSkipped', { count: jobData.skipped })}
              </li>
              <li data-testid={`${entity}-progress-failed`}>
                {t('import.progressFailed', { count: jobData.failed })}
              </li>
            </ul>
          )}

          {/* Elapsed time */}
          <p className="text-xs text-gray-500" data-testid={`${entity}-elapsed`}>
            {t('import.elapsed', { seconds: elapsedSeconds })}
          </p>
        </div>
      )}

      {/* Step 5: Summary */}
      {step === 'summary' && jobData && (
        <div data-testid={`${entity}-summary`}>
          {jobData.status === 'failed' ? (
            <>
              <p
                role="alert"
                className="text-sm text-red-600 mb-3"
                data-testid={`${entity}-summary-error`}
              >
                {t('import.summaryFailedJob')}
              </p>
              {jobData.error_csv && (
                <Button
                  variant="secondary"
                  size="md"
                  data-testid={`${entity}-download-errors`}
                  onClick={handleDownloadErrors}
                >
                  {t('import.downloadErrors')}
                </Button>
              )}
            </>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-gray-800 mb-3">
                {t('import.summaryHeading')}
              </h3>
              <ul className="space-y-1 text-sm text-gray-700 mb-4">
                <li data-testid={`${entity}-summary-created`}>
                  {t('import.summaryCreated', { count: jobData.created })}
                </li>
                <li data-testid={`${entity}-summary-skipped`}>
                  {t('import.summarySkipped', { count: jobData.skipped })}
                </li>
                <li data-testid={`${entity}-summary-failed`}>
                  {t('import.summaryFailed', { count: jobData.failed })}
                </li>
              </ul>

              {jobData.failed > 0 && jobData.error_csv && (
                <Button
                  variant="secondary"
                  size="md"
                  data-testid={`${entity}-download-errors`}
                  onClick={handleDownloadErrors}
                >
                  {t('import.downloadErrors')}
                </Button>
              )}
            </>
          )}

          <div className="mt-4">
            <Button
              variant="ghost"
              size="sm"
              data-testid={`${entity}-import-again`}
              onClick={handleReset}
            >
              {t('import.importAgain', { entity: entityLabel })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
