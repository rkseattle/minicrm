/**
 * ErrorBoundary component.
 * Catches unhandled render errors and displays a fallback UI instead of a blank screen.
 * Wrap the application router or layout with this component to prevent full app crashes.
 */

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { useTranslation } from 'react-i18next';
import { captureException } from '../sentry.js';

/**
 * Fallback UI rendered when the ErrorBoundary catches a render error.
 * Extracted as a functional component so it can use the useTranslation hook.
 */
function ErrorFallback() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="error-boundary-fallback"
      className="min-h-screen flex items-center justify-center bg-gray-50 px-4"
    >
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('errors.boundaryTitle')}</h1>
        <p className="text-sm text-gray-500 mb-6">{t('errors.boundaryMessage')}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            data-testid="error-boundary-reload"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {t('errors.boundaryReload')}
          </button>
          <a
            href="/"
            data-testid="error-boundary-dashboard-link"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {t('errors.boundaryDashboard')}
          </a>
        </div>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  /** Content to render when no error has occurred */
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Page-level error boundary.
 * On render error: logs to console, shows a user-friendly fallback with
 * a "Reload page" button and a "Go to Dashboard" link.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * Updates state to trigger fallback UI on the next render.
   *
   * @param _error - The error that was thrown
   * @returns New state with hasError set to true
   */
  static getDerivedStateFromError(_error: unknown): ErrorBoundaryState {
    return { hasError: true };
  }

  /**
   * Logs error details to the console for diagnostics.
   *
   * @param error - The error that was thrown
   * @param info - React component stack information
   */
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    captureException(error);
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }

    return this.props.children;
  }
}
