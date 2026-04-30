/**
 * Tests for ErrorBoundary component (MINCRM-112).
 */

import { screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary.js';
import * as sentry from '../sentry.js';

vi.mock('../sentry.js', () => ({ captureException: vi.fn() }));

/** Component that always throws on render — used to trigger the boundary */
function ThrowingChild(): never {
  throw new Error('Test render error');
}

/** Component that renders normally */
function HappyChild() {
  return <div data-testid="happy-child">All good</div>;
}

describe('ErrorBoundary', () => {
  // Suppress React's expected console.error output for error boundary tests
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <HappyChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('happy-child')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument();
  });

  it('renders the fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
  });

  it('shows a reload button in the fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-reload')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-reload')).toHaveTextContent('Reload page');
  });

  it('shows a Go to Dashboard link in the fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    const dashboardLink = screen.getByTestId('error-boundary-dashboard-link');
    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink).toHaveAttribute('href', '/');
  });

  it('logs the error to the console', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('calls captureException when a child throws', () => {
    const captureExceptionSpy = vi.spyOn(sentry, 'captureException');
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(captureExceptionSpy).toHaveBeenCalledWith(expect.any(Error));
  });
});
