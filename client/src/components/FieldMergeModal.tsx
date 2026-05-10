/**
 * FieldMergeModal — three-way merge UI for optimistic locking conflict resolution. (MINCRM-351)
 *
 * When a PATCH returns 409 OPTIMISTIC_LOCK_CONFLICT, the user is shown a field-by-field
 * comparison of base (what they loaded), theirs (what the other user saved), and mine
 * (what they were trying to save). Auto-resolvable fields are shown as informational rows;
 * only true conflicts (A→B by them, A→C by me) require an explicit per-field choice.
 */

import { useEffect, useRef, useState } from 'react';
import { diffChars } from 'diff';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';

export interface FieldMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'contact' | 'account' | 'deal' | 'lead' | 'activity';
  /** Values in the cache when the user opened the record */
  base: Record<string, unknown>;
  /** Values the other user saved (from 409 response body) */
  theirs: Record<string, unknown>;
  /** Values the user was trying to save (mutation payload) */
  mine: Record<string, unknown>;
  /** Human-readable label for each field key to include in the table */
  fieldLabels: Record<string, string>;
  /** Called with the merged field values when the user clicks Save resolved */
  onResolve: (resolved: Record<string, unknown>) => void;
}

type MergeKind = 'unchanged' | 'only-mine' | 'only-theirs' | 'same-change' | 'conflict';

interface FieldRow {
  key: string;
  label: string;
  kind: MergeKind;
  baseValue: unknown;
  theirsValue: unknown;
  mineValue: unknown;
}

function classifyField(base: unknown, theirs: unknown, mine: unknown): MergeKind {
  const baseStr = String(base ?? '');
  const theirsStr = String(theirs ?? '');
  const mineStr = String(mine ?? '');

  if (baseStr === theirsStr && baseStr === mineStr) return 'unchanged';
  if (theirsStr === baseStr && mineStr !== baseStr) return 'only-mine';
  if (mineStr === baseStr && theirsStr !== baseStr) return 'only-theirs';
  if (theirsStr === mineStr) return 'same-change';
  return 'conflict';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * Renders an inline character-level diff between two strings.
 * Deletions are shown in red with strikethrough; additions in green.
 */
function InlineDiff({ from, to }: { from: string; to: string }) {
  const parts = diffChars(from, to);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <ins key={i} className="bg-green-100 text-green-800 no-underline">
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del key={i} className="bg-red-100 text-red-700 line-through">
              {part.value}
            </del>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </span>
  );
}

/**
 * Renders a cell value. For string fields against a base, renders an inline diff.
 * For non-string fields (or when no base is needed), renders a formatted label.
 */
function ValueCell({
  value,
  base,
  showDiff,
}: {
  value: unknown;
  base?: unknown;
  showDiff: boolean;
}) {
  if (showDiff && typeof value === 'string' && typeof base === 'string') {
    return <InlineDiff from={base} to={value} />;
  }
  return <span>{formatValue(value)}</span>;
}

export default function FieldMergeModal({
  isOpen,
  onClose,
  base,
  theirs,
  mine,
  fieldLabels,
  onResolve,
}: FieldMergeModalProps) {
  const { t } = useTranslation();
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const rows: FieldRow[] = Object.entries(fieldLabels)
    .map(([key, label]) => ({
      key,
      label,
      kind: classifyField(base[key], theirs[key], mine[key]),
      baseValue: base[key],
      theirsValue: theirs[key],
      mineValue: mine[key],
    }))
    .filter((row) => row.kind !== 'unchanged');

  // Per-field choice for true conflicts: defaults to 'theirs' to preserve the other user's work.
  const [choices, setChoices] = useState<Record<string, 'theirs' | 'mine'>>({});

  // Reset choices whenever the modal opens with fresh data.
  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, 'theirs' | 'mine'> = {};
      rows.forEach((row) => {
        if (row.kind === 'conflict') initial[row.key] = 'theirs';
      });
      setChoices(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Focus management: move focus into modal on open, restore on close.
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        firstFocusRef.current?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      onClose();
    }
  }

  function buildResolved(): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    rows.forEach((row) => {
      switch (row.kind) {
        case 'only-mine':
        case 'same-change':
          resolved[row.key] = row.mineValue;
          break;
        case 'only-theirs':
          resolved[row.key] = row.theirsValue;
          break;
        case 'conflict': {
          const choice = choices[row.key] ?? 'theirs';
          resolved[row.key] = choice === 'theirs' ? row.theirsValue : row.mineValue;
          break;
        }
      }
    });
    return resolved;
  }

  function handleSaveResolved(): void {
    onResolve(buildResolved());
  }

  const hasVisibleRows = rows.length > 0;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-8"
      data-testid="field-merge-modal-overlay"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="field-merge-modal-title"
        data-testid="field-merge-modal"
        className="relative w-full max-w-4xl mx-4 p-0"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <h2
              id="field-merge-modal-title"
              className="text-base font-semibold text-gray-900"
              data-testid="field-merge-modal-title"
            >
              {t('errors.fieldMergeTitle')}
            </h2>
            <p className="mt-1 text-sm text-gray-600">{t('errors.fieldMergeSubtitle')}</p>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {hasVisibleRows ? (
              <table className="w-full text-sm" data-testid="field-merge-table">
                <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start w-32">
                      {t('errors.fieldMergeField')}
                    </th>
                    <th scope="col" className="px-4 py-3 text-start">
                      {t('errors.fieldMergeOriginal')}
                    </th>
                    <th scope="col" className="px-4 py-3 text-start">
                      {t('errors.fieldMergeTheirVersion')}
                    </th>
                    <th scope="col" className="px-4 py-3 text-start">
                      {t('errors.fieldMergeYourVersion')}
                    </th>
                    <th scope="col" className="px-4 py-3 text-start w-40">
                      {t('errors.fieldMergeKeep')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => {
                    const isConflict = row.kind === 'conflict';
                    const showStringDiff =
                      typeof row.theirsValue === 'string' || typeof row.mineValue === 'string';

                    return (
                      <tr
                        key={row.key}
                        data-testid={`field-merge-row-${row.key}`}
                        className={isConflict ? 'bg-amber-50' : 'bg-white'}
                      >
                        {/* Field label */}
                        <td className="px-4 py-3 font-medium text-gray-700 align-top">
                          {row.label}
                        </td>

                        {/* Original (base) */}
                        <td className="px-4 py-3 text-gray-500 align-top">
                          {formatValue(row.baseValue)}
                        </td>

                        {/* Their version */}
                        <td className="px-4 py-3 text-gray-800 align-top">
                          <ValueCell
                            value={row.theirsValue}
                            base={row.baseValue}
                            showDiff={showStringDiff && row.kind !== 'only-mine'}
                          />
                        </td>

                        {/* Your version */}
                        <td className="px-4 py-3 text-gray-800 align-top">
                          <ValueCell
                            value={row.mineValue}
                            base={row.baseValue}
                            showDiff={showStringDiff && row.kind !== 'only-theirs'}
                          />
                        </td>

                        {/* Keep column */}
                        <td className="px-4 py-3 align-top">
                          {isConflict ? (
                            <fieldset className="border-0 p-0 m-0">
                              <legend className="sr-only">
                                {t('errors.fieldMergeChoiceLabel', { field: row.label })}
                              </legend>
                              <label className="flex items-center gap-1.5 mb-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`merge-choice-${row.key}`}
                                  value="theirs"
                                  checked={(choices[row.key] ?? 'theirs') === 'theirs'}
                                  onChange={() =>
                                    setChoices((c) => ({ ...c, [row.key]: 'theirs' }))
                                  }
                                  data-testid={`field-merge-radio-${row.key}-theirs`}
                                  className="text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>{t('errors.fieldMergeKeepTheirs')}</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`merge-choice-${row.key}`}
                                  value="mine"
                                  checked={(choices[row.key] ?? 'theirs') === 'mine'}
                                  onChange={() => setChoices((c) => ({ ...c, [row.key]: 'mine' }))}
                                  data-testid={`field-merge-radio-${row.key}-mine`}
                                  className="text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>{t('errors.fieldMergeKeepMine')}</span>
                              </label>
                            </fieldset>
                          ) : (
                            <span
                              className="text-xs text-gray-400 italic"
                              data-testid={`field-merge-auto-${row.key}`}
                            >
                              {t('errors.fieldMergeAuto')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="px-6 py-8 text-sm text-gray-500 text-center">
                {t('errors.fieldMergeNoChanges')}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 flex items-center gap-3">
            <Button
              ref={firstFocusRef}
              type="button"
              variant="primary"
              data-testid="field-merge-save-button"
              onClick={handleSaveResolved}
            >
              {t('errors.fieldMergeSaveResolved')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="field-merge-discard-button"
              onClick={onClose}
            >
              {t('errors.fieldMergeDiscard')}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
