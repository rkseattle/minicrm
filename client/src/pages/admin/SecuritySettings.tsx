/**
 * SecuritySettings — MFA enforcement, SSO, and SCIM provisioning.
 * Creates a dedicated Security & Identity tab consolidating auth/provisioning
 * concerns previously scattered across General and Integrations.
 */

import MfaSettings from '@/pages/admin/MfaSettings.js';
import SsoSettings from '@/pages/admin/SsoSettings.js';
import ScimSettings from '@/pages/admin/ScimSettings.js';

export default function SecuritySettings() {
  return (
    <>
      <MfaSettings />
      <div className="mt-8">
        <SsoSettings />
      </div>
      <div className="mt-8">
        <ScimSettings />
      </div>
    </>
  );
}
