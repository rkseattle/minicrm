import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import GapsPage from './GapsPage.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import {
  MOCK_DEAD_ZONE_UNIT,
  MOCK_NEVER_TAKEN_BRANCH,
  MOCK_CHANGED_UNTESTED_UNIT,
} from '@/test/msw/handlers.js';

async function submitGapsForm(commitSha: string, baseSha = ''): Promise<void> {
  await userEvent.type(screen.getByTestId('gaps-commit-sha-input'), commitSha);
  if (baseSha) {
    await userEvent.type(screen.getByTestId('gaps-base-sha-input'), baseSha);
  }
  await userEvent.click(screen.getByTestId('gaps-submit-button'));
}

describe('GapsPage', () => {
  it('shows the empty state before a commit SHA is submitted', () => {
    renderWithProviders(<GapsPage />);
    expect(screen.getByTestId('gaps-empty')).toBeInTheDocument();
  });

  it('shows a loading state while the gaps request is in flight', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/gaps', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({
          deadZoneUnits: [],
          neverTakenBranches: [],
          changedUntestedUnits: null,
        });
      }),
    );
    renderWithProviders(<GapsPage />);
    await submitGapsForm('abc123');
    expect(screen.getByTestId('gaps-loading')).toBeInTheDocument();
  });

  it('shows a generic error message on a failed request', async () => {
    server.use(
      http.get(
        '*/api/v1/admin/coverage/reporting/gaps',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderWithProviders(<GapsPage />);
    await submitGapsForm('abc123');
    await waitFor(() => expect(screen.getByTestId('gaps-error')).toBeInTheDocument());
  });

  it('shows an empty-category message when the active tab has no gaps', async () => {
    renderWithProviders(<GapsPage />);
    await submitGapsForm('abc123');
    await waitFor(() => expect(screen.getByTestId('gaps-tab-dead-zones')).toBeInTheDocument());
    expect(screen.getByTestId('gaps-tab-empty')).toBeInTheDocument();
  });

  it('renders dead-zone units in a table, switches to never-taken-branches on tab click', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/gaps', () =>
        HttpResponse.json({
          deadZoneUnits: [MOCK_DEAD_ZONE_UNIT],
          neverTakenBranches: [MOCK_NEVER_TAKEN_BRANCH],
          changedUntestedUnits: null,
        }),
      ),
    );
    renderWithProviders(<GapsPage />);
    await submitGapsForm('abc123');

    await waitFor(() => expect(screen.getByTestId('gaps-table')).toBeInTheDocument());
    expect(screen.getByText(MOCK_DEAD_ZONE_UNIT.unitKey)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('gaps-tab-never-taken-branches'));
    expect(screen.getByText(MOCK_NEVER_TAKEN_BRANCH.unitKey)).toBeInTheDocument();
  });

  it('disables the changed-but-untested tab when no baseSha was submitted', async () => {
    renderWithProviders(<GapsPage />);
    await submitGapsForm('abc123');
    await waitFor(() => expect(screen.getByTestId('gaps-tab-changed-untested')).toBeDisabled());
  });

  it('shows changed-but-untested units when a baseSha is submitted', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/gaps', () =>
        HttpResponse.json({
          deadZoneUnits: [],
          neverTakenBranches: [],
          changedUntestedUnits: [MOCK_CHANGED_UNTESTED_UNIT],
        }),
      ),
    );
    renderWithProviders(<GapsPage />);
    await submitGapsForm('abc123', 'base-sha-1');

    await waitFor(() => expect(screen.getByTestId('gaps-tab-changed-untested')).not.toBeDisabled());
    await userEvent.click(screen.getByTestId('gaps-tab-changed-untested'));
    expect(screen.getByText(MOCK_CHANGED_UNTESTED_UNIT.unitKey)).toBeInTheDocument();
    expect(screen.getByText('in-line')).toBeInTheDocument();
  });

  it('disables export buttons when the active tab has no rows', async () => {
    renderWithProviders(<GapsPage />);
    await submitGapsForm('abc123');
    await waitFor(() => expect(screen.getByTestId('gaps-export-csv-button')).toBeDisabled());
    expect(screen.getByTestId('gaps-export-json-button')).toBeDisabled();
  });

  it('triggers a CSV download when Export CSV is clicked with rows present', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/gaps', () =>
        HttpResponse.json({
          deadZoneUnits: [MOCK_DEAD_ZONE_UNIT],
          neverTakenBranches: [],
          changedUntestedUnits: null,
        }),
      ),
    );
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    renderWithProviders(<GapsPage />);
    await submitGapsForm('abc123');
    await waitFor(() => expect(screen.getByTestId('gaps-export-csv-button')).not.toBeDisabled());

    await userEvent.click(screen.getByTestId('gaps-export-csv-button'));

    expect(createObjectURLSpy).toHaveBeenCalled();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});
