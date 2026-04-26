/**
 * Admin Settings page.
 * Thin shell that renders all settings sections. Sections are extracted into
 * client/src/pages/admin/ for maintainability (MINCRM-259).
 */

import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import GeneralSettings from '@/pages/admin/GeneralSettings.js';
import NotificationSettings from '@/pages/admin/NotificationSettings.js';
import CurrencySettings from '@/pages/admin/CurrencySettings.js';
import CustomisationSettings from '@/pages/admin/CustomisationSettings.js';
import DataSettings from '@/pages/admin/DataSettings.js';
import IntegrationSettings from '@/pages/admin/IntegrationSettings.js';

export default function AdminSettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="settings-heading">
          {t('settings.pageTitle')}
        </h1>

        <GeneralSettings />

        <div className="mt-8">
          <NotificationSettings />
        </div>

        <div className="mt-8">
          <CurrencySettings />
        </div>

        <div className="mt-8">
          <CustomisationSettings />
        </div>

        <div className="mt-8">
          <DataSettings />
        </div>

        <div className="mt-8">
          <IntegrationSettings />
        </div>
      </main>
    </div>
  );
}
