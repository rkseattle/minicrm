/**
 * Tests for useLanguagePreference.
 *
 * Covers both modes: optimistic (the nav selectors, which switch immediately and revert
 * on failure) and non-optimistic (the Profile form, which waits for the save).
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useLanguagePreference } from './useLanguagePreference.js';
import i18n from '../i18n.js';
import { server } from '../test/setup.js';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('useLanguagePreference', () => {
  it('applies the saved locale to the interface', async () => {
    server.use(
      http.patch('/api/v1/users/me/language', () => HttpResponse.json({ language: 'fr' })),
    );
    const { result } = renderHook(() => useLanguagePreference(), { wrapper });

    act(() => result.current.save('fr'));

    await waitFor(() => {
      expect(i18n.language).toBe('fr');
    });
  });

  it('resolves a null preference through the org default', async () => {
    server.use(
      http.patch('/api/v1/users/me/language', () => HttpResponse.json({ language: null })),
      http.get('/api/v1/settings/default-language', () => HttpResponse.json({ language: 'de' })),
    );
    await i18n.changeLanguage('fr');
    const { result } = renderHook(() => useLanguagePreference(), { wrapper });

    act(() => result.current.save(null));

    // Without the fallback the interface would sit in the old locale after clearing.
    await waitFor(() => {
      expect(i18n.language).toBe('de');
    });
  });

  it('reverts to the previous locale when an optimistic save fails', async () => {
    server.use(
      http.patch('/api/v1/users/me/language', () => new HttpResponse(null, { status: 500 })),
    );
    const { result } = renderHook(() => useLanguagePreference({ optimistic: true }), { wrapper });

    act(() => result.current.save('de'));
    await waitFor(() => {
      expect(i18n.language).toBe('de');
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(i18n.language).toBe('en');
  });

  it('leaves the interface alone until a non-optimistic save succeeds', async () => {
    let resolveRequest: (() => void) | undefined;
    server.use(
      http.patch('/api/v1/users/me/language', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return HttpResponse.json({ language: 'fr' });
      }),
    );
    const { result } = renderHook(() => useLanguagePreference(), { wrapper });

    act(() => result.current.save('fr'));
    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });
    expect(i18n.language).toBe('en');

    act(() => resolveRequest?.());
    await waitFor(() => {
      expect(i18n.language).toBe('fr');
    });
  });

  it('runs onSaved only after the request settles', async () => {
    const seen: string[] = [];
    server.use(
      http.patch('/api/v1/users/me/language', () => HttpResponse.json({ language: 'es' })),
    );
    const { result } = renderHook(
      () => useLanguagePreference({ onSaved: () => seen.push('saved') }),
      { wrapper },
    );

    act(() => result.current.save('es'));
    expect(seen).toEqual([]);

    await waitFor(() => {
      expect(seen).toEqual(['saved']);
    });
  });

  it('does not run onSaved when the save fails', async () => {
    const seen: string[] = [];
    server.use(
      http.patch('/api/v1/users/me/language', () => new HttpResponse(null, { status: 500 })),
    );
    const { result } = renderHook(
      () => useLanguagePreference({ onSaved: () => seen.push('saved') }),
      { wrapper },
    );

    act(() => result.current.save('es'));
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(seen).toEqual([]);
  });
});
