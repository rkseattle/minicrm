/**
 * CsvImporter — shared wizard component for importing CRM data from CSV files.
 * Steps: 1) file select → 2) column mapping → 3) preview → 4) confirm + run → 5) summary.
 * Used by AdminSettingsPage for accounts, contacts, and deals.
 * MINCRM-158, MINCRM-159, MINCRM-160
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { parseCsv, runImport } from '@/api/import.js';
import type { CrmField, ImportEntity, ParseResponse, ImportRunResponse } from '@/api/import.js';

/** Max file size in bytes exposed to the UI (10 MB) */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
 * Multi-step CSV import wizard.
 *
 * @param entity - The CRM entity type.
 * @param entityLabel - Human-readable entity name for headings.
 * @param options - Optional boolean flags for entity-specific behavior.
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

  const [summary, setSummary] = useState<ImportRunResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // ── Step 1: File selection ─────────────────────────────────────────────────

  /**
   * Validates and stores the selected file, then triggers CSV parsing.
   *
   * @param selectedFile - The File chosen by the user.
   */
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
      // Auto-map CSV headers to CRM fields when the names match exactly (case-insensitive)
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

  /**
   * Handles a file input change event.
   *
   * @param e - The change event from the file input.
   */
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const selected = e.target.files?.[0];
    if (selected) void handleFileSelect(selected);
  }

  /**
   * Handles drag-and-drop file drops.
   *
   * @param e - The DragEvent.
   */
  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) void handleFileSelect(dropped);
  }

  // ── Step 2: Column mapping ─────────────────────────────────────────────────

  /**
   * Updates the column mapping for a single CRM field.
   *
   * @param fieldKey - The CRM field key being mapped.
   * @param csvHeader - The CSV column header to map it to, or '' to unmap.
   */
  function handleMappingChange(fieldKey: string, csvHeader: string): void {
    setMapping((prev) => ({ ...prev, [fieldKey]: csvHeader }));
  }

  /**
   * Returns true when all required CRM fields have a non-empty mapping.
   */
  function isMappingComplete(): boolean {
    if (!parseData) return false;
    return parseData.fields
      .filter((f) => f.required)
      .every((f) => (mapping[f.key] ?? '').length > 0);
  }

  // ── Step 3: Preview ────────────────────────────────────────────────────────

  /**
   * Gets the display value for a preview cell given the current mapping.
   *
   * @param row - The preview row object.
   * @param fieldKey - The CRM field key.
   */
  function getMappedValue(row: Record<string, string>, fieldKey: string): string {
    const header = mapping[fieldKey];
    if (!header) return '';
    return row[header] ?? '';
  }

  // ── Step 4: Run import ─────────────────────────────────────────────────────

  /**
   * Runs the import against the server.
   */
  async function handleRunImport(): Promise<void> {
    if (!file) return;
    setStep('running');
    setRunError(null);
    try {
      // Strip empty mappings before sending
      const cleanMapping: Record<string, string> = Object.fromEntries(
        Object.entries(mapping).filter(([, v]) => v.length > 0),
      );
      const result = await runImport(entity, file, cleanMapping, optionValues);
      setSummary(result);
      setStep('summary');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('import.error.runFailed');
      setRunError(message);
      setStep('preview');
    }
  }

  // ── Step 5: Download error report ─────────────────────────────────────────

  /**
   * Triggers a browser download of the error report CSV.
   */
  function handleDownloadErrors(): void {
    if (!summary?.errorCsv) return;
    const blob = new Blob([summary.errorCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entity}-import-errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  /**
   * Resets the wizard back to the file selection step.
   */
  function handleReset(): void {
    setStep('select');
    setFile(null);
    setFileError(null);
    setParseData(null);
    setParseError(null);
    setMapping({});
    setOptionValues(Object.fromEntries(options.map((o) => [o.key, o.defaultValue])));
    setSummary(null);
    setRunError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
            <p className="text-xs text-gray-400 mt-1">{t('import.csvOnly')}</p>
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

      {/* Step 4: Running */}
      {step === 'running' && (
        <p className="text-sm text-gray-500" data-testid={`${entity}-running`}>
          {t('import.running', { entity: entityLabel })}
        </p>
      )}

      {/* Step 5: Summary */}
      {step === 'summary' && summary && (
        <div data-testid={`${entity}-summary`}>
          <h3 className="text-sm font-semibold text-gray-800 mb-3">{t('import.summaryHeading')}</h3>
          <ul className="space-y-1 text-sm text-gray-700 mb-4">
            <li data-testid={`${entity}-summary-created`}>
              {t('import.summaryCreated', { count: summary.created })}
            </li>
            <li data-testid={`${entity}-summary-skipped`}>
              {t('import.summarySkipped', { count: summary.skipped })}
            </li>
            <li data-testid={`${entity}-summary-failed`}>
              {t('import.summaryFailed', { count: summary.failedCount })}
            </li>
          </ul>

          {summary.failedCount > 0 && summary.errorCsv && (
            <Button
              variant="secondary"
              size="md"
              data-testid={`${entity}-download-errors`}
              onClick={handleDownloadErrors}
            >
              {t('import.downloadErrors')}
            </Button>
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
