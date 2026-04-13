/**
 * CSV serialization utilities for export endpoints.
 * (MINCRM-164, MINCRM-165, MINCRM-166)
 */

/**
 * Escapes a single CSV field value according to RFC 4180.
 * Fields containing commas, double-quotes, or newlines are wrapped in double-quotes.
 * Embedded double-quotes are escaped by doubling them.
 *
 * @param value - Raw cell value (null/undefined rendered as empty string)
 * @returns Properly escaped CSV field
 */
function escapeCsvField(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str =
    value instanceof Date
      ? value
          .toISOString()
          .replace('T', ' ')
          .replace(/\.\d{3}Z$/, ' UTC')
      : String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
