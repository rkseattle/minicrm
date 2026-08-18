/**
 * Client-side CSV/JSON export for gap-analysis lists — an exportable list of
 * gap methods and branches. Generated entirely in the
 * browser from already-fetched data — no new backend endpoint, since the
 * reporting query API's /gaps response already carries everything a
 * downstream tool or spreadsheet would need.
 */

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Escapes a CSV field per RFC 4180: wraps in quotes if it contains a comma, quote, or newline. */
function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Accepts Record<string, unknown> rather than a narrower value-typed
 * constraint — this is a generic export utility called with whichever flat
 * row shape a given gap-analysis tab happens to have (dead-zone units,
 * changed-but-untested units, etc.), which differ in field set but are all
 * safely stringifiable.
 */
export function exportRowsAsCsv(rows: Record<string, unknown>[], filename: string): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const lines = [
    columns.join(','),
    ...rows.map((row) =>
      columns
        .map((col) =>
          escapeCsvField(row[col] === null || row[col] === undefined ? '' : String(row[col])),
        )
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

export function exportRowsAsJson(rows: unknown[], filename: string): void {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
}
