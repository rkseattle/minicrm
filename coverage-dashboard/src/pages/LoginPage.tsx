/**
 * Minimal login page — this dashboard reuses minicrm-server's existing
 * admin session-cookie auth (see api/auth.ts), it does not implement its
 * own credential store.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { login } from '@/api/auth.js';
import { useAuth, authQueryOptions } from '@/hooks/useAuth.js';

interface LocationState {
  from?: { pathname: string };
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading } = useAuth();

  if (!isLoading && isAuthenticated) {
    const from = (location.state as LocationState | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      // Clear rather than invalidate: a previous account's cached coverage data
      // on this tab is readable on the next mount even while it refetches.
      queryClient.clear();
      // Warm the auth entry before navigating: clear() emptied it, and
      // ProtectedRoute renders a loading state on a miss. This is a latency
      // optimization, not a correctness step — ProtectedRoute refetches on
      // arrival either way — so a failure here must not be reported as a login
      // error. It is logged rather than discarded: silently swallowing it would
      // hide a /auth/me outage behind nothing worse than a brief spinner.
      try {
        await queryClient.fetchQuery(authQueryOptions);
      } catch (warmupErr) {
        console.warn('Post-login auth warm-up failed; continuing.', warmupErr);
      }
      const from = (location.state as LocationState | null)?.from?.pathname ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setError('Invalid email or password');
      } else if (axios.isAxiosError(err) && err.response?.status === 403) {
        setError('Your account is not able to sign in right now');
      } else {
        setError('Something went wrong — please try again');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm"
        data-testid="login-form"
      >
        <h1 className="mb-6 text-xl font-semibold text-gray-900">Coverage/TIA Dashboard</h1>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            data-testid="login-error"
          >
            {error}
          </div>
        )}

        <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          data-testid="login-email-input"
        />

        <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          data-testid="login-password-input"
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          data-testid="login-submit-button"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
