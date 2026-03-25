/**
 * LoginPage component.
 * Renders the email/password login form.
 * On success, invalidates the auth query and redirects to the dashboard.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { login } from '@/api/auth.js';
import { AUTH_QUERY_KEY } from '@/hooks/useAuth.js';

/**
 * Extracts a translated error message from an axios error response.
 *
 * @param {unknown} error - The caught error object.
 * @param {Function} t - The i18next translate function.
 * @returns {string}
 */
function resolveErrorMessage(error, t) {
  const code = error?.response?.data?.error?.code;
  if (code && t(`errors.${code}`, { defaultValue: '' })) {
    return t(`errors.${code}`);
  }
  return t('errors.generic');
}

/**
 * Login page with email and password form.
 *
 * @returns {JSX.Element}
 */
export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      navigate('/', { replace: true });
    },
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    loginMutation.mutate();
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f9fafb',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          padding: '2rem',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <h1 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>
          {t('login.title')}
        </h1>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="email" style={{ display: 'block', marginBottom: '0.25rem' }}>
              {t('login.emailLabel')}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
              style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="password" style={{ display: 'block', marginBottom: '0.25rem' }}>
              {t('login.passwordLabel')}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
            />
          </div>

          {loginMutation.isError && (
            <p
              role="alert"
              style={{ color: '#dc2626', marginBottom: '1rem', fontSize: '0.875rem' }}
            >
              {resolveErrorMessage(loginMutation.error, t)}
            </p>
          )}

          <button
            type="submit"
            disabled={loginMutation.isPending}
            style={{ width: '100%', padding: '0.625rem' }}
          >
            {loginMutation.isPending ? t('login.submitting') : t('login.submitButton')}
          </button>
        </form>
      </div>
    </div>
  );
}
