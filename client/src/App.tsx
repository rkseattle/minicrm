/**
 * App component — root routing configuration.
 * Declares all application routes using React Router v6.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute.js';
import AdminRoute from '@/components/AdminRoute.js';
import LoginPage from '@/pages/LoginPage.js';
import ChangePasswordPage from '@/pages/ChangePasswordPage.js';
import DashboardPage from '@/pages/DashboardPage.js';
import ContactsPage from '@/pages/ContactsPage.js';
import ContactDetailPage from '@/pages/ContactDetailPage.js';
import AccountsPage from '@/pages/AccountsPage.js';
import AccountDetailPage from '@/pages/AccountDetailPage.js';
import DealsPage from '@/pages/DealsPage.js';
import DealDetailPage from '@/pages/DealDetailPage.js';
import PipelineBoardPage from '@/pages/PipelineBoardPage.js';
import MyTasksPage from '@/pages/MyTasksPage.js';
import UsersPage from '@/pages/UsersPage.js';
import AdminSettingsPage from '@/pages/AdminSettingsPage.js';
import WinLossReportPage from '@/pages/WinLossReportPage.js';

/**
 * Root application component with route definitions.
 */
export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />

      {/* Authenticated routes */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/contacts/:id" element={<ContactDetailPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/accounts/:id" element={<AccountDetailPage />} />
        <Route path="/deals" element={<DealsPage />} />
        <Route path="/deals/:id" element={<DealDetailPage />} />
        <Route path="/pipeline" element={<PipelineBoardPage />} />
        <Route path="/tasks" element={<MyTasksPage />} />
      </Route>

      {/* Admin-only routes */}
      <Route element={<AdminRoute />}>
        <Route path="/users" element={<UsersPage />} />
        <Route path="/admin/settings" element={<AdminSettingsPage />} />
        <Route path="/reports/win-loss" element={<WinLossReportPage />} />
      </Route>

      {/* Catch-all: redirect unknown paths to the dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
