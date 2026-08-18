/**
 * useExportAction — wraps an async export call with an in-flight loading
 * flag, following the setLoading(true) → await → finally setLoading(false)
 * pattern shared by every list page's ExportMenu items (Deals, Accounts,
 * Contacts, Leads).
 */

import { useCallback, useState } from 'react';

export interface UseExportActionResult {
  /** True while the wrapped export call is in flight. */
  isExporting: boolean;
  /** Runs `fn`, setting isExporting for its duration regardless of outcome. */
  run: (fn: () => Promise<void>) => Promise<void>;
}

export function useExportAction(): UseExportActionResult {
  const [isExporting, setIsExporting] = useState(false);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setIsExporting(true);
    try {
      await fn();
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { isExporting, run };
}
