/**
 * Shared utility for triggering browser CSV file downloads.
 * (MINCRM-164, MINCRM-165, MINCRM-166)
 */

/**
 * Creates a temporary anchor element to trigger a file download from a Blob.
 *
 * @param blob - CSV blob received from the server
 * @param filename - Suggested filename for the download
 */
export function triggerCsvDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
