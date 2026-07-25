import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute.js';
import NavLayout from '@/components/NavLayout.js';
import LoginPage from '@/pages/LoginPage.js';
import AccessDeniedPage from '@/pages/AccessDeniedPage.js';
import OverviewPage from '@/pages/OverviewPage.js';
import GapsPage from '@/pages/GapsPage.js';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/access-denied" element={<AccessDeniedPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<NavLayout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/gaps" element={<GapsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
