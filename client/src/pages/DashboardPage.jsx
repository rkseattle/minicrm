/**
 * DashboardPage component.
 * Minimal placeholder for Phase 1. Displays a welcome message for the
 * currently authenticated user. The full dashboard is implemented in later phases.
 */

import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.jsx';
import { useAuth } from '@/hooks/useAuth.js';

/**
 * Dashboard landing page.
 *
 * @returns {JSX.Element}
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div>
      <NavBar />
      <main style={{ padding: '2rem' }}>
        <h1>{t('dashboard.welcome', { name: user?.name ?? '' })}</h1>
      </main>
    </div>
  );
}
