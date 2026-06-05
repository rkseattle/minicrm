/**
 * Reports shell page.
 * Hosts the adaptive SubPageNav and renders the active report's content. (MINCRM-294)
 *
 * View persistence priority on load:
 *   1. `?view=<key>` URL query param
 *   2. localStorage key `minicrm_reports_last_view`
 *   3. Default: `win-loss`
 *
 * Layout follows the same adaptive rules as Admin Settings (MINCRM-259):
 *   - Mobile: horizontal scrollable tab bar
 *   - Desktop + left sidebar nav: horizontal tab bar
 *   - Desktop + top/hamburger nav: vertical tab list on the left
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import NavBar from '@/components/NavBar.js';
import SubPageNav from '@/components/SubPageNav.js';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { useNavLayout } from '@/components/NavLayoutContext.js';
import { WinLossReportContent } from '@/pages/WinLossReportPage.js';
import { ActivityVolumeReportContent } from '@/pages/ActivityVolumeReportPage.js';
import { StageTrendReportContent } from '@/pages/StageTrendReportPage.js';
import { CustomReportBuilderContent } from '@/pages/CustomReportBuilderPage.js';

type ReportView = 'win-loss' | 'activity' | 'pipeline-stage' | 'custom-reports';

const REPORT_VIEWS: ReportView[] = ['win-loss', 'activity', 'pipeline-stage', 'custom-reports'];
const LOCALSTORAGE_KEY = 'minicrm_reports_last_view';

function isValidView(value: string | null): value is ReportView {
  return REPORT_VIEWS.includes(value as ReportView);
}

function readLastView(): ReportView | null {
  try {
    const stored = localStorage.getItem(LOCALSTORAGE_KEY);
    return isValidView(stored) ? stored : null;
  } catch {
    return null;
  }
}

function saveLastView(view: ReportView): void {
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, view);
  } catch {
    // localStorage unavailable — silently ignore
  }
}

const REPORT_CONTENT: Record<ReportView, React.ComponentType> = {
  'win-loss': WinLossReportContent,
  activity: ActivityVolumeReportContent,
  'pipeline-stage': StageTrendReportContent,
  'custom-reports': CustomReportBuilderContent,
};

export default function ReportsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMobile } = useBreakpoint();
  const { layout: navLayout } = useNavLayout();

  // Priority: URL param → localStorage → default
  const rawView = searchParams.get('view');
  const activeView: ReportView = isValidView(rawView) ? rawView : (readLastView() ?? 'win-loss');

  // Keep URL in sync with the resolved view (covers localStorage-restore case)
  useEffect(() => {
    if (!isValidView(rawView)) {
      setSearchParams({ view: activeView }, { replace: true });
    }
  }, [rawView, activeView, setSearchParams]);

  function selectView(key: string): void {
    const view = key as ReportView;
    saveLastView(view);
    setSearchParams({ view }, { replace: false });
  }

  const ActiveContent = REPORT_CONTENT[activeView];

  const navItems = REPORT_VIEWS.map((view) => ({
    key: view,
    label: t(`reports.nav.${view.replace('-', '_')}`),
    'data-testid': `reports-tab-${view}`,
  }));

  // Vertical mode (desktop + top/hamburger) needs a flex row to place nav beside content.
  const useVerticalLayout = !isMobile && navLayout !== 'left';

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="reports-page-heading">
          {t('reports.pageTitle')}
        </h1>

        {useVerticalLayout ? (
          <div className="flex gap-8 items-start">
            <SubPageNav
              items={navItems}
              activeKey={activeView}
              onChange={selectView}
              ariaLabel={t('reports.pageTitle')}
              data-testid="reports-tab-list"
              panelTestidPrefix="reports-panel"
              itemTestidPrefix="reports-tab"
            />
            <div
              className="flex-1 min-w-0"
              role="tabpanel"
              id={`reports-panel-${activeView}`}
              aria-labelledby={`reports-tab-${activeView}`}
              data-testid={`reports-panel-${activeView}`}
            >
              <ActiveContent />
            </div>
          </div>
        ) : (
          <>
            <SubPageNav
              items={navItems}
              activeKey={activeView}
              onChange={selectView}
              ariaLabel={t('reports.pageTitle')}
              data-testid="reports-tab-list"
              panelTestidPrefix="reports-panel"
              itemTestidPrefix="reports-tab"
            />
            <div
              role="tabpanel"
              id={`reports-panel-${activeView}`}
              aria-labelledby={`reports-tab-${activeView}`}
              data-testid={`reports-panel-${activeView}`}
            >
              <ActiveContent />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
