/**
 * Page-level error boundary. Catches unhandled render errors and shows a
 * fallback instead of a blank screen. Adapted from minicrm-client's own
 * ErrorBoundary.tsx (no shared code — this app has no i18n or Sentry wiring).
 */

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

function ErrorFallback() {
  return (
    <div
      data-testid="error-boundary-fallback"
      className="flex min-h-screen items-center justify-center bg-gray-50 px-4"
    >
      <div className="w-full max-w-md text-center">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">Something went wrong</h1>
        <p className="mb-6 text-sm text-gray-500">
          An unexpected error occurred while rendering this page.
        </p>
        <button
          type="button"
          data-testid="error-boundary-reload"
          onClick={() => window.location.reload()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
