/**
 * Admin Settings page.
 * Renders settings sections in adaptive tab navigation (MINCRM-259).
 * Layout adapts based on viewport and active nav layout:
 *   - Mobile (< 768px): horizontal scrollable tab bar
 *   - Desktop + left sidebar nav: horizontal tab bar (avoids double sidebar)
 *   - Desktop + top/hamburger nav: vertical tab list on the left
 */

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import NavBar from '@/components/NavBar.js';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { useNavLayout } from '@/components/NavLayoutContext.js';
import GeneralSettings from '@/pages/admin/GeneralSettings.js';
import NotificationSettings from '@/pages/admin/NotificationSettings.js';
import CurrencySettings from '@/pages/admin/CurrencySettings.js';
import CustomisationSettings from '@/pages/admin/CustomisationSettings.js';
import DataSettings from '@/pages/admin/DataSettings.js';
import IntegrationSettings from '@/pages/admin/IntegrationSettings.js';

type TabKey = 'general' | 'notifications' | 'currency' | 'customisation' | 'data' | 'integrations';

const TAB_KEYS: TabKey[] = [
  'general',
  'notifications',
  'currency',
  'customisation',
  'data',
  'integrations',
];

const TAB_CONTENT: Record<TabKey, React.ComponentType> = {
  general: GeneralSettings,
  notifications: NotificationSettings,
  currency: CurrencySettings,
  customisation: CustomisationSettings,
  data: DataSettings,
  integrations: IntegrationSettings,
};

function isValidTab(value: string | null): value is TabKey {
  return TAB_KEYS.includes(value as TabKey);
}

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMobile } = useBreakpoint();
  const { layout: navLayout } = useNavLayout();

  const rawTab = searchParams.get('tab');
  const activeTab: TabKey = isValidTab(rawTab) ? rawTab : 'general';

  function selectTab(tab: TabKey): void {
    if (tab === activeTab) return;
    setSearchParams({ tab }, { replace: false });
  }

  // Horizontal tabs when: mobile viewport, OR desktop with left sidebar active
  const useHorizontalTabs = isMobile || navLayout === 'left';

  const ActivePanel = TAB_CONTENT[activeTab];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="settings-heading">
          {t('settings.pageTitle')}
        </h1>

        {useHorizontalTabs ? (
          /* ── Horizontal tab bar layout ─────────────────────────────── */
          <div>
            <div
              className="flex overflow-x-auto border-b border-gray-200 mb-6"
              role="tablist"
              aria-label={t('settings.pageTitle')}
              data-testid="settings-tab-list"
            >
              {TAB_KEYS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls={`settings-panel-${tab}`}
                  id={`settings-tab-${tab}`}
                  data-testid={`settings-tab-${tab}`}
                  onClick={() => selectTab(tab)}
                  className={[
                    'px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500',
                    activeTab === tab
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                  ].join(' ')}
                >
                  {t(`settings.tabs.${tab}`)}
                </button>
              ))}
            </div>

            <div
              role="tabpanel"
              id={`settings-panel-${activeTab}`}
              aria-labelledby={`settings-tab-${activeTab}`}
              data-testid={`settings-panel-${activeTab}`}
            >
              <ActivePanel />
            </div>
          </div>
        ) : (
          /* ── Vertical tab list layout ──────────────────────────────── */
          <div className="flex gap-8 items-start">
            <div
              className="w-48 flex-shrink-0"
              role="tablist"
              aria-label={t('settings.pageTitle')}
              aria-orientation="vertical"
              data-testid="settings-tab-list"
            >
              {TAB_KEYS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls={`settings-panel-${tab}`}
                  id={`settings-tab-${tab}`}
                  data-testid={`settings-tab-${tab}`}
                  onClick={() => selectTab(tab)}
                  className={[
                    'w-full text-start px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-0.5',
                    activeTab === tab
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  ].join(' ')}
                >
                  {t(`settings.tabs.${tab}`)}
                </button>
              ))}
            </div>

            <div
              className="flex-1 min-w-0"
              role="tabpanel"
              id={`settings-panel-${activeTab}`}
              aria-labelledby={`settings-tab-${activeTab}`}
              data-testid={`settings-panel-${activeTab}`}
            >
              <ActivePanel />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
