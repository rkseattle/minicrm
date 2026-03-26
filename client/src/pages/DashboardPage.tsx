/**
 * DashboardPage component.
 * Minimal placeholder for Phase 1. Displays a welcome message for the
 * currently authenticated user. The full dashboard is implemented in later phases.
 */

import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { useAuth } from '@/hooks/useAuth.js';

/**
 * Dashboard landing page.
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            {t('dashboard.welcome', { name: user?.name ?? '' })}
          </h1>
          <p className="text-gray-500 mt-1 text-sm">{t('dashboard.subtitle')}</p>
        </div>

        {/* Empty state — full dashboard content added in later phases */}
        <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-16 text-center">
          <p className="text-gray-400 text-sm">{t('dashboard.emptyState')}</p>
        </div>
      </main>
    </div>
  );
}
