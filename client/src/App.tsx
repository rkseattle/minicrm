/**
 * App component — root routing configuration.
 * Declares all application routes using React Router v6.
 * Wraps the route tree in NavLayoutProvider so the active layout is available
 * to all page components. (MINCRM-133)
 */

import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute.js';
import AdminRoute from '@/components/AdminRoute.js';
import { NavLayoutProvider, useNavLayout } from '@/components/NavLayoutContext.js';
import NavLeft from '@/components/NavLeft.js';
import LoginPage from '@/pages/LoginPage.js';
import ChangePasswordPage from '@/pages/ChangePasswordPage.js';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.js';
import ResetPasswordPage from '@/pages/ResetPasswordPage.js';
import SetPasswordPage from '@/pages/SetPasswordPage.js';
import DashboardPage from '@/pages/DashboardPage.js';
import ContactsPage from '@/pages/ContactsPage.js';
import ContactDetailPage from '@/pages/ContactDetailPage.js';
import AccountsPage from '@/pages/AccountsPage.js';
import AccountDetailPage from '@/pages/AccountDetailPage.js';
import DealsPage from '@/pages/DealsPage.js';
import DealDetailPage from '@/pages/DealDetailPage.js';
import MyTasksPage from '@/pages/MyTasksPage.js';
import UsersPage from '@/pages/UsersPage.js';
import AdminSettingsPage from '@/pages/AdminSettingsPage.js';
import WinLossReportPage from '@/pages/WinLossReportPage.js';
import ActivityVolumeReportPage from '@/pages/ActivityVolumeReportPage.js';
import ActivitiesPage from '@/pages/ActivitiesPage.js';
import AutomationRulesPage from '@/pages/AutomationRulesPage.js';
import ProfilePage from '@/pages/ProfilePage.js';
import AuditLogPage from '@/pages/AuditLogPage.js';
import LeadsPage from '@/pages/LeadsPage.js';
import LeadDetailPage from '@/pages/LeadDetailPage.js';
import AdminTagsPage from '@/pages/AdminTagsPage.js';

/**
 * Wraps the outlet in NavLeft when the left layout is active.
 * For top and hamburger layouts, each page renders its own NavBar inline,
 * so no wrapper is needed here.
 */
function LayoutShell() {
  const { layout } = useNavLayout();
  if (layout === 'left') {
    return (
      <NavLeft>
        <Outlet />
      </NavLeft>
    );
  }
  return <Outlet />;
}

/**
 * Route tree wrapped in NavLayoutProvider.
 */
function AppRoutes() {
  return (
    <Routes>
      {/* Public routes — no layout shell */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />

      {/* Authenticated routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<LayoutShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/accounts/:id" element={<AccountDetailPage />} />
          <Route path="/deals" element={<DealsPage />} />
          <Route path="/deals/:id" element={<DealDetailPage />} />
          {/* MINCRM-51: /pipeline merged into /deals; redirect for backwards compatibility */}
          <Route path="/pipeline" element={<Navigate to="/deals" replace />} />
          <Route path="/tasks" element={<MyTasksPage />} />
          <Route path="/activities" element={<ActivitiesPage />} />
          <Route path="/reports/activity-volume" element={<ActivityVolumeReportPage />} />
          <Route path="/reports/win-loss" element={<WinLossReportPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      {/* Admin-only routes */}
      <Route element={<AdminRoute />}>
        <Route element={<LayoutShell />}>
          <Route path="/users" element={<UsersPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/tags" element={<AdminTagsPage />} />
          <Route path="/admin/audit-log" element={<AuditLogPage />} />
          <Route path="/admin/automation" element={<AutomationRulesPage />} />
        </Route>
      </Route>

      {/* Catch-all: redirect unknown paths to the dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Root application component with route definitions.
 */
export default function App() {
  return (
    <NavLayoutProvider>
      <AppRoutes />
    </NavLayoutProvider>
  );
}
