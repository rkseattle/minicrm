/**
 * CSV serialization utilities for export endpoints.
 * (MINCRM-164, MINCRM-165, MINCRM-166)
 */

/** Characters that Excel/Sheets treat as formula starters — prefix with ' to prevent DDE injection */
const FORMULA_START_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Formats a Date for display in export output (CSV and PDF), e.g. `2026-07-07 14:30:00 UTC`.
 * Shared so both export formats render the same date the same way.
 */
export function formatExportDate(value: Date): string {
  return value
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

/**
 * Escapes a single CSV field value according to RFC 4180.
 * Fields containing commas, double-quotes, or newlines are wrapped in double-quotes.
 * Embedded double-quotes are escaped by doubling them.
 * Fields whose first character is a spreadsheet formula trigger character are prefixed
 * with a single quote to prevent DDE/formula injection (MINCRM-164).
 *
 * @param value - Raw cell value (null/undefined rendered as empty string)
 * @returns Properly escaped CSV field
 */
function escapeCsvField(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = value instanceof Date ? formatExportDate(value) : String(value);
  // Prefix formula-trigger characters to prevent DDE injection in Excel / Google Sheets
  const sanitized = str.length > 0 && FORMULA_START_CHARS.has(str[0]) ? `'${str}` : str;
  if (
    sanitized.includes('"') ||
    sanitized.includes(',') ||
    sanitized.includes('\n') ||
    sanitized.includes('\r')
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

/**
 * Serializes an array of objects to a UTF-8 CSV string with a BOM prefix.
 * The BOM (\uFEFF) ensures Excel opens the file with correct UTF-8 encoding.
 *
 * @param headers - Ordered column header names
 * @param rows - Array of plain objects; values are extracted by header name
 * @returns Complete CSV string starting with a UTF-8 BOM
 */
export function serializeToCsv(
  headers: string[],
  rows: Record<string, string | number | Date | null | undefined>[],
): string {
  const headerLine = headers.map(escapeCsvField).join(',');
  const dataLines = rows.map((row) => headers.map((h) => escapeCsvField(row[h])).join(','));
  return '\uFEFF' + [headerLine, ...dataLines].join('\r\n');
}

/**
 * Builds the filename for a CSV export in the format `minicrm-<entity>-YYYY-MM-DD.csv`.
 *
 * @param entity - Entity name (e.g. 'contacts', 'accounts', 'deals')
 * @returns Filename string
 */
export function csvFilename(entity: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `minicrm-${entity}-${date}.csv`;
}
