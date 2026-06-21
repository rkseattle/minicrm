/**
 * WorkspaceSettings — Default language, navigation layout, default currency,
 * and exchange rates. Consolidates GeneralSettings (lang + nav) and
 * CurrencySettings into a single Workspace tab (MINCRM-563).
 */

import GeneralSettings from '@/pages/admin/GeneralSettings.js';
import CurrencySettings from '@/pages/admin/CurrencySettings.js';

export default function WorkspaceSettings() {
  return (
    <>
      <GeneralSettings />
      <div className="mt-8">
        <CurrencySettings />
      </div>
    </>
  );
}
