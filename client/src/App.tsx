/**
 * App component — root routing configuration.
 * Declares all application routes using React Router v6.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute.js';
import AdminRoute from '@/components/AdminRoute.js';
import LoginPage from '@/pages/LoginPage.js';
import DashboardPage from '@/pages/DashboardPage.js';
import ContactsPage from '@/pages/ContactsPage.js';
import ContactDetailPage from '@/pages/ContactDetailPage.js';
import AccountsPage from '@/pages/AccountsPage.js';
import AccountDetailPage from '@/pages/AccountDetailPage.js';
import UsersPage from '@/pages/UsersPage.js';

/**
 * Root application component with route definitions.
 */
export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />

      {/* Authenticated routes */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/contacts/:id" element={<ContactDetailPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/accounts/:id" element={<AccountDetailPage />} />
      </Route>

      {/* Admin-only routes */}
      <Route element={<AdminRoute />}>
        <Route path="/users" element={<UsersPage />} />
      </Route>

      {/* Catch-all: redirect unknown paths to the dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
