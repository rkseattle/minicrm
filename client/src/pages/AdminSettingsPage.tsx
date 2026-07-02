/**
 * Admin Settings page.
 * Renders settings sections in adaptive tab navigation (MINCRM-259).
 * Layout adapts based on viewport and active nav layout:
 *   - Mobile (< 768px): native <select> picker — one line, OS-native UX
 *   - Desktop + left sidebar nav: horizontal tab bar (avoids double sidebar)
 *   - Desktop + top/hamburger nav: vertical tab list on the left
 *
 * Navigation chrome is provided by SubPageNav (MINCRM-294).
 * Tab structure reorganized from 12+1 → 10 grouped tabs (MINCRM-563).
 */

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import NavBar from '@/components/NavBar.js';
import SubPageNav from '@/components/SubPageNav.js';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { useNavLayout } from '@/components/NavLayoutContext.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import WorkspaceSettings from '@/pages/admin/WorkspaceSettings.js';
import BrandingSettings from '@/pages/admin/BrandingSettings.js';
import PipelinesAndFieldsSettings from '@/pages/admin/PipelinesAndFieldsSettings.js';
import UsersAndAccessSettings from '@/pages/admin/UsersAndAccessSettings.js';
import SecuritySettings from '@/pages/admin/SecuritySettings.js';
import NotificationSettings from '@/pages/admin/NotificationSettings.js';
import IntegrationSettings from '@/pages/admin/IntegrationSettings.js';
import AiSettings from '@/pages/admin/AiSettings.js';
import FeatureFlagsSettings from '@/pages/admin/FeatureFlagsSettings.js';
import DataAndPlatformSettings from '@/pages/admin/DataAndPlatformSettings.js';

type TabKey =
  | 'workspace'
  | 'branding'
  | 'pipelines'
  | 'users'
  | 'security'
  | 'notifications'
  | 'integrations'
  | 'ai'
  | 'platform'
  | 'flags';

/** Canonical tab order — Feature Flags is last (admin-only housekeeping). */
const TAB_KEYS: TabKey[] = [
  'workspace',
  'branding',
  'pipelines',
  'users',
  'security',
  'notifications',
  'integrations',
  'ai',
  'platform',
  'flags',
];

const TAB_CONTENT: Record<TabKey, React.ComponentType> = {
  workspace: WorkspaceSettings,
  branding: BrandingSettings,
  pipelines: PipelinesAndFieldsSettings,
  users: UsersAndAccessSettings,
  security: SecuritySettings,
  notifications: NotificationSettings,
  integrations: IntegrationSettings,
  ai: AiSettings,
  flags: FeatureFlagsSettings,
  platform: DataAndPlatformSettings,
};

function isValidTab(value: string | null): value is TabKey {
  return TAB_KEYS.includes(value as TabKey);
}

/** Renders Panel in a visually-disabled state with a banner. Used when a flag gates an admin panel. (MINCRM-566) */
function DisabledPanelWrapper({ Panel, banner }: { Panel: React.ComponentType; banner: string }) {
  return (
    <div className="opacity-60" aria-disabled="true" data-testid="ai-panel-disabled-wrapper">
      <p
        className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-6"
        data-testid="ai-panel-disabled-banner"
      >
        {banner}
      </p>
      <fieldset disabled className="contents">
        <Panel />
      </fieldset>
    </div>
  );
}

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMobile } = useBreakpoint();
  const { layout: navLayout } = useNavLayout();
  const { enabled: aiEnabled } = useFeatureFlag('ai_features');

  const rawTab = searchParams.get('tab');
  const activeTab: TabKey = isValidTab(rawTab) ? rawTab : 'workspace';

  function selectTab(key: string): void {
    setSearchParams({ tab: key }, { replace: false });
  }

  const ActivePanel = TAB_CONTENT[activeTab];
  // When the AI flag is off, render the panel in a visually-disabled state rather than hiding it.
  // Non-admin surfaces that hide AI features by flag are correct and unchanged. (MINCRM-566)
  const aiPanelDisabled = activeTab === 'ai' && !aiEnabled;

  const navItems = TAB_KEYS.map((tab) => ({
    key: tab,
    label: t(`settings.tabs.${tab}`),
    'data-testid': `settings-tab-${tab}`,
  }));

  // Vertical mode (desktop + top/hamburger) needs a flex row to place nav beside content.
  // Mobile and horizontal modes render nav above content — no flex wrapper needed.
  const useVerticalLayout = !isMobile && navLayout !== 'left';

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="settings-heading">
          {t('settings.pageTitle')}
        </h1>

        {useVerticalLayout ? (
          /* ── Vertical tab list (desktop + top/hamburger nav) ──────── */
          <div className="flex gap-8 items-start">
            <SubPageNav
              items={navItems}
              activeKey={activeTab}
              onChange={selectTab}
              ariaLabel={t('settings.pageTitle')}
              data-testid="settings-tab-list"
              panelTestidPrefix="settings-panel"
              itemTestidPrefix="settings-tab"
            />
            <div
              className="flex-1 min-w-0"
              role="tabpanel"
              id={`settings-panel-${activeTab}`}
              aria-labelledby={`settings-tab-${activeTab}`}
              data-testid={`settings-panel-${activeTab}`}
            >
              {activeTab === 'ai' ? (
                <AiSettings disabled={aiPanelDisabled} />
              ) : aiPanelDisabled ? (
                <DisabledPanelWrapper
                  Panel={ActivePanel}
                  banner={t('settings.featureDisabledBanner')}
                />
              ) : (
                <ActivePanel />
              )}
            </div>
          </div>
        ) : (
          /* ── Mobile select or horizontal tab bar ───────────────────── */
          <>
            <SubPageNav
              items={navItems}
              activeKey={activeTab}
              onChange={selectTab}
              ariaLabel={t('settings.pageTitle')}
              data-testid="settings-tab-list"
              panelTestidPrefix="settings-panel"
              itemTestidPrefix="settings-tab"
            />
            <div
              role="tabpanel"
              id={`settings-panel-${activeTab}`}
              aria-labelledby={isMobile ? 'settings-tab-list-select' : `settings-tab-${activeTab}`}
              data-testid={`settings-panel-${activeTab}`}
            >
              {activeTab === 'ai' ? (
                <AiSettings disabled={aiPanelDisabled} />
              ) : aiPanelDisabled ? (
                <DisabledPanelWrapper
                  Panel={ActivePanel}
                  banner={t('settings.featureDisabledBanner')}
                />
              ) : (
                <ActivePanel />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
