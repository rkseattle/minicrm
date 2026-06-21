/**
 * UsersAndAccessSettings — Teams, roles, and visibility policy management.
 * Consolidates TeamsSettings, RolesSettings, and VisibilitySettings into a
 * single Users & Access tab (MINCRM-563).
 */

import TeamsSettings from '@/pages/admin/TeamsSettings.js';
import RolesSettings from '@/pages/admin/RolesSettings.js';
import VisibilitySettings from '@/pages/admin/VisibilitySettings.js';

export default function UsersAndAccessSettings() {
  return (
    <>
      <TeamsSettings />
      <div className="mt-8">
        <RolesSettings />
      </div>
      <div className="mt-8">
        <VisibilitySettings />
      </div>
    </>
  );
}
