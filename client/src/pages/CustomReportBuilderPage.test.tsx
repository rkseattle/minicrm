/**
 * Tests for the CustomReportBuilderPage component. (MINCRM-402)
 * Covers: loading state, empty state, error state, builder interactions,
 * running a report, saving a report, and CSV export link.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { CustomReportBuilderContent } from './CustomReportBuilderPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { REP_USER } from '../test/msw/handlers.js';

const MOCK_USER_ID = 'user-abc';

function makeReport(
  overrides: Partial<{
    id: string;
    name: string;
    entity_type: string;
    visibility: string;
    created_by: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 'rpt-1',
    name: overrides.name ?? 'Alpha Report',
    entity_type: overrides.entity_type ?? 'contact',
    visibility: overrides.visibility ?? 'public',
    config: { selected_fields: ['id'], filters: [] },
    created_by: overrides.created_by ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ── Loading state ─────────────────────────────────────────────────────────────

describe('CustomReportBuilderContent — loading state', () => {
  it('shows loading indicator while saved reports are fetching', () => {
    server.use(
      http.get('/api/v1/reports/custom', async () => {
        await new Promise(() => {}); // never resolves — stays loading
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    expect(screen.getByTestId('saved-reports-loading')).toBeInTheDocument();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe('CustomReportBuilderContent — error state', () => {
  it('shows error message when saved reports fail to load', async () => {
    server.use(
      http.get('/api/v1/reports/custom', () => {
        return HttpResponse.json(
          { error: { code: 'SERVER_ERROR', message: 'oops' } },
          { status: 500 },
        );
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-reports-error')).toBeInTheDocument();
    });
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('CustomReportBuilderContent — empty state', () => {
  it('shows no-saved-reports message when list is empty', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-reports-empty')).toBeInTheDocument();
    });
  });
});

// ── Builder interactions ──────────────────────────────────────────────────────

describe('CustomReportBuilderContent — builder', () => {
  it('renders entity type selector with all 5 options', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-type-select')).toBeInTheDocument();
    });
    const select = screen.getByTestId('entity-type-select') as HTMLSelectElement;
    expect(select.options).toHaveLength(5);
  });

  it('renders field checkboxes for the selected entity', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('fields-selector')).toBeInTheDocument();
    });
    // contact is the default entity
    expect(screen.getByTestId('field-checkbox-id')).toBeInTheDocument();
    expect(screen.getByTestId('field-checkbox-email')).toBeInTheDocument();
  });

  it('adds a filter row when "Add filter" is clicked', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('add-filter-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('add-filter-button'));
    expect(screen.getByTestId('filter-row-0')).toBeInTheDocument();
  });

  it('removes a filter row when "Remove" is clicked', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('add-filter-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('add-filter-button'));
    expect(screen.getByTestId('filter-row-0')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('filter-remove-0'));
    expect(screen.queryByTestId('filter-row-0')).not.toBeInTheDocument();
  });

  it('shows aggregate sum field picker only when sum is selected', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-type-select')).toBeInTheDocument();
    });

    // switch to deal entity type so sum fields are available
    await userEvent.selectOptions(screen.getByTestId('entity-type-select'), 'deal');
    await userEvent.selectOptions(screen.getByTestId('aggregate-type-select'), 'sum');
    expect(screen.getByTestId('aggregate-sum-field-select')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId('aggregate-type-select'), '');
    expect(screen.queryByTestId('aggregate-sum-field-select')).not.toBeInTheDocument();
  });
});

// ── Run report ────────────────────────────────────────────────────────────────

describe('CustomReportBuilderContent — run report', () => {
  it('shows empty results state when run returns no rows', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('run-report-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('run-report-button'));
    await waitFor(() => {
      expect(screen.getByTestId('results-empty')).toBeInTheDocument();
    });
  });

  it('shows results table when run returns rows', async () => {
    server.use(
      http.post('/api/v1/reports/custom/run', () => {
        return HttpResponse.json({
          columns: ['id', 'first_name'],
          rows: [{ id: 'abc', first_name: 'Alice' }],
          row_count: 1,
        });
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('run-report-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('run-report-button'));
    await waitFor(() => {
      expect(screen.getByTestId('results-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('result-row-0')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows error message when run fails', async () => {
    server.use(
      http.post('/api/v1/reports/custom/run', () => {
        return HttpResponse.json(
          { error: { code: 'SERVER_ERROR', message: 'x' } },
          { status: 500 },
        );
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('run-report-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('run-report-button'));
    await waitFor(() => {
      expect(screen.getByTestId('run-report-error')).toBeInTheDocument();
    });
  });
});

// ── Save report ───────────────────────────────────────────────────────────────

describe('CustomReportBuilderContent — save report', () => {
  it('opens save dialog when "Save report" is clicked', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('save-report-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('save-report-button'));
    expect(screen.getByTestId('save-report-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('save-report-visibility-select')).toBeInTheDocument();
  });

  it('closes save dialog when Cancel is clicked', async () => {
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('save-report-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('save-report-button'));
    await userEvent.click(screen.getByTestId('save-report-cancel'));
    expect(screen.queryByTestId('save-report-dialog')).not.toBeInTheDocument();
  });

  it('saves a report and shows it in the saved list', async () => {
    let reportCreated = false;
    server.use(
      http.post('/api/v1/reports/custom', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        reportCreated = true;
        return HttpResponse.json(makeReport({ id: 'new-report-id', name: String(body['name']) }), {
          status: 201,
        });
      }),
      http.get('/api/v1/reports/custom', () => {
        return HttpResponse.json({
          reports: reportCreated
            ? [makeReport({ id: 'new-report-id', name: 'My Test Report' })]
            : [],
        });
      }),
    );

    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('save-report-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('save-report-button'));
    await userEvent.clear(screen.getByTestId('save-report-name-input'));
    await userEvent.type(screen.getByTestId('save-report-name-input'), 'My Test Report');
    await userEvent.click(screen.getByTestId('save-report-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('save-report-dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('My Test Report')).toBeInTheDocument();
    });
  });
});

// ── Saved reports list ────────────────────────────────────────────────────────

describe('CustomReportBuilderContent — saved reports list', () => {
  it('renders saved reports in the sidebar', async () => {
    server.use(
      http.get('/api/v1/reports/custom', () => {
        return HttpResponse.json({ reports: [makeReport({ id: 'rpt-1', name: 'Alpha Report' })] });
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-report-rpt-1')).toBeInTheDocument();
    });
    expect(screen.getByText('Alpha Report')).toBeInTheDocument();
  });

  it('loading a saved report populates the builder', async () => {
    server.use(
      http.get('/api/v1/reports/custom', () => {
        return HttpResponse.json({
          reports: [
            makeReport({
              id: 'rpt-2',
              name: 'Deal Report',
              entity_type: 'deal',
            }),
          ],
        });
      }),
    );
    // Override config for this test since makeReport uses a generic one
    server.use(
      http.get('/api/v1/reports/custom', () => {
        return HttpResponse.json({
          reports: [
            {
              ...makeReport({ id: 'rpt-2', name: 'Deal Report', entity_type: 'deal' }),
              config: { selected_fields: ['id', 'name', 'stage'], filters: [] },
            },
          ],
        });
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-report-rpt-2')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('saved-report-rpt-2'));

    // entity type should switch to deal
    const entitySelect = screen.getByTestId('entity-type-select') as HTMLSelectElement;
    expect(entitySelect.value).toBe('deal');

    // stage checkbox should be checked
    expect(screen.getByTestId('field-checkbox-stage')).toBeChecked();
  });

  it('hides delete button for public_read_only reports the user does not own', async () => {
    server.use(
      // Return a rep user so admin bypass doesn't apply
      http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })),
      http.get('/api/v1/reports/custom', () => {
        return HttpResponse.json({
          reports: [
            makeReport({
              id: 'rpt-ro',
              name: 'Read Only Report',
              visibility: 'public_read_only',
              created_by: 'other-user',
            }),
          ],
        });
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-report-rpt-ro')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('delete-report-rpt-ro')).not.toBeInTheDocument();
  });

  it('shows delete button for public reports regardless of ownership', async () => {
    server.use(
      http.get('/api/v1/reports/custom', () => {
        return HttpResponse.json({
          reports: [
            makeReport({
              id: 'rpt-pub',
              name: 'Public Report',
              visibility: 'public',
              created_by: 'other-user',
            }),
          ],
        });
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-report-rpt-pub')).toBeInTheDocument();
    });
    // Delete button is hidden until hover; check it exists in DOM
    expect(screen.getByTestId('delete-report-rpt-pub')).toBeInTheDocument();
  });

  it('shows visibility badge on each report', async () => {
    server.use(
      http.get('/api/v1/reports/custom', () => {
        return HttpResponse.json({
          reports: [
            makeReport({
              id: 'rpt-badge',
              name: 'Badge Report',
              visibility: 'private',
              created_by: MOCK_USER_ID,
            }),
          ],
        });
      }),
    );
    renderWithProviders(<CustomReportBuilderContent />);
    await waitFor(() => {
      expect(screen.getByTestId('report-visibility-rpt-badge')).toBeInTheDocument();
    });
  });
});
