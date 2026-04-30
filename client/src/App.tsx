/**
 * App component — root routing configuration.
 * Declares all application routes using React Router v6.
 * Wraps the route tree in NavLayoutProvider so the active layout is available
 * to all page components. (MINCRM-133)
 *
 * Page components are loaded via React.lazy() so Vite splits each page into its
 * own chunk, reducing the initial bundle to only what the landing route needs.
 * A single Suspense boundary around the Routes tree handles the loading state.
 * (MINCRM-281)
 */

import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute.js';
import AdminRoute from '@/components/AdminRoute.js';
import { NavLayoutProvider, useNavLayout } from '@/components/NavLayoutContext.js';
import NavLeft from '@/components/NavLeft.js';
import OnboardingBanner from '@/components/OnboardingBanner.js';

// Page-level lazy imports — each becomes its own Vite chunk (MINCRM-281)
const LoginPage = lazy(() => import('@/pages/LoginPage.js'));
const ChangePasswordPage = lazy(() => import('@/pages/ChangePasswordPage.js'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage.js'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage.js'));
const SetPasswordPage = lazy(() => import('@/pages/SetPasswordPage.js'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage.js'));
const ContactsPage = lazy(() => import('@/pages/ContactsPage.js'));
const ContactDetailPage = lazy(() => import('@/pages/ContactDetailPage.js'));
const AccountsPage = lazy(() => import('@/pages/AccountsPage.js'));
const AccountDetailPage = lazy(() => import('@/pages/AccountDetailPage.js'));
const DealsPage = lazy(() => import('@/pages/DealsPage.js'));
const DealDetailPage = lazy(() => import('@/pages/DealDetailPage.js'));
const MyTasksPage = lazy(() => import('@/pages/MyTasksPage.js'));
const UsersPage = lazy(() => import('@/pages/UsersPage.js'));
const AdminSettingsPage = lazy(() => import('@/pages/AdminSettingsPage.js'));
const WinLossReportPage = lazy(() => import('@/pages/WinLossReportPage.js'));
const ActivityVolumeReportPage = lazy(() => import('@/pages/ActivityVolumeReportPage.js'));
const ActivitiesPage = lazy(() => import('@/pages/ActivitiesPage.js'));
const AutomationRulesPage = lazy(() => import('@/pages/AutomationRulesPage.js'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage.js'));
const AuditLogPage = lazy(() => import('@/pages/AuditLogPage.js'));
const LeadsPage = lazy(() => import('@/pages/LeadsPage.js'));
const LeadDetailPage = lazy(() => import('@/pages/LeadDetailPage.js'));
const AdminTagsPage = lazy(() => import('@/pages/AdminTagsPage.js'));

/**
 * Wraps the outlet in NavLeft when the left layout is active.
 * For top and hamburger layouts, each page renders its own NavBar inline,
 * so no wrapper is needed here.
 * For left layout, OnboardingBanner renders above page content inside NavLeft. (MINCRM-256)
 */
function LayoutShell() {
  const { layout } = useNavLayout();
  if (layout === 'left') {
    return (
      <NavLeft>
        <OnboardingBanner />
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
    <Suspense
      fallback={<div className="flex h-screen items-center justify-center" aria-label="Loading" />}
    >
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
    </Suspense>
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
