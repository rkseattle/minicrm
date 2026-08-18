/**
 * DataAndPlatformSettings — Demo data management and setup checklist reset.
 * Consolidates DataSettings and the setup checklist section (previously in
 * GeneralSettings) into a single Data & Platform tab.
 */

import DataSettings from '@/pages/admin/DataSettings.js';
import SetupChecklistSettings from '@/pages/admin/SetupChecklistSettings.js';

export default function DataAndPlatformSettings() {
  return (
    <>
      <DataSettings />
      <div className="mt-8">
        <SetupChecklistSettings />
      </div>
    </>
  );
}
