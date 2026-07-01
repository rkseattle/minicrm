/**
 * Tests for CustomisationSettings — pipeline stages reorder (MINCRM-381) and
 * custom fields section (MINCRM-276).
 *
 * Pipeline stages covers:
 *  - Stages table renders with move-up / move-down buttons
 *  - Move-up sends a PUT /reorder request with the new order
 *  - Move-down sends a PUT /reorder request with the new order
 *  - Reorder error shows a feedback toast
 *
 * Custom fields covers:
 *  - Custom fields section renders with entity type selector
 *  - Add field form appears when Add Field is clicked
 *  - Fields table renders when definitions exist
 *  - Delete confirmation dialog appears when delete is clicked
 *  - Name conflict error shown on duplicate add
 *  - Success feedback shown after adding a field
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import CustomisationSettings from './CustomisationSettings.js';
import { PIPELINE_STAGES_FIXTURE } from '../../test/msw/handlers.js';

const FIELD_ID = '00000000-0000-0000-0000-000000000099';

// ── Pipeline stages section ──────────────────────────────────────────────────

describe('CustomisationSettings — pipeline stages reorder (MINCRM-381)', () => {
  it('renders the pipeline stages table with move-up and move-down buttons', async () => {
    renderWithProviders(<CustomisationSettings />);

    const firstId = PIPELINE_STAGES_FIXTURE[0].id;
    const secondId = PIPELINE_STAGES_FIXTURE[1].id;

    // Wait for stages to load (requires both pipelines and stages queries to resolve)
    await waitFor(() => {
      expect(screen.getByTestId(`pipeline-stage-move-up-${firstId}`)).toBeInTheDocument();
    });

    expect(screen.getByTestId(`pipeline-stage-move-up-${firstId}`)).toBeDisabled();
    expect(screen.getByTestId(`pipeline-stage-move-down-${firstId}`)).not.toBeDisabled();
    expect(screen.getByTestId(`pipeline-stage-move-up-${secondId}`)).not.toBeDisabled();
  });

  it('sends PUT /reorder with swapped order when move-up is clicked', async () => {
    const capturedBodies: { stages: string[] }[] = [];
    server.use(
      http.put('/api/v1/settings/pipeline-stages/reorder', async ({ request }) => {
        const body = (await request.json()) as { stages: string[] };
        capturedBodies.push(body);
        return HttpResponse.json({ stages: PIPELINE_STAGES_FIXTURE });
      }),
    );

    renderWithProviders(<CustomisationSettings />);

    const secondId = PIPELINE_STAGES_FIXTURE[1].id;

    // Wait for stages to load (requires both pipelines and stages queries to resolve)
    await waitFor(() => {
      expect(screen.getByTestId(`pipeline-stage-move-up-${secondId}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`pipeline-stage-move-up-${secondId}`));

    await waitFor(() => expect(capturedBodies).toHaveLength(1));

    // Moving index 1 up: expected order swaps index 0 and 1
    const expectedOrder = [
      PIPELINE_STAGES_FIXTURE[1].id,
      PIPELINE_STAGES_FIXTURE[0].id,
      ...PIPELINE_STAGES_FIXTURE.slice(2).map((s) => s.id),
    ];
    expect(capturedBodies[0].stages).toEqual(expectedOrder);
  });

  it('sends PUT /reorder with swapped order when move-down is clicked', async () => {
    const capturedBodies: { stages: string[] }[] = [];
    server.use(
      http.put('/api/v1/settings/pipeline-stages/reorder', async ({ request }) => {
        const body = (await request.json()) as { stages: string[] };
        capturedBodies.push(body);
        return HttpResponse.json({ stages: PIPELINE_STAGES_FIXTURE });
      }),
    );

    renderWithProviders(<CustomisationSettings />);

    const firstId = PIPELINE_STAGES_FIXTURE[0].id;

    // Wait for stages to load (requires both pipelines and stages queries to resolve)
    await waitFor(() => {
      expect(screen.getByTestId(`pipeline-stage-move-down-${firstId}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`pipeline-stage-move-down-${firstId}`));

    await waitFor(() => expect(capturedBodies).toHaveLength(1));

    // Moving index 0 down: expected order swaps index 0 and 1
    const expectedOrder = [
      PIPELINE_STAGES_FIXTURE[1].id,
      PIPELINE_STAGES_FIXTURE[0].id,
      ...PIPELINE_STAGES_FIXTURE.slice(2).map((s) => s.id),
    ];
    expect(capturedBodies[0].stages).toEqual(expectedOrder);
  });

  it('shows error toast when reorder request fails', async () => {
    server.use(
      http.put('/api/v1/settings/pipeline-stages/reorder', () =>
        HttpResponse.json(
          { error: { code: 'STAGE_NOT_FOUND', message: 'not found' } },
          { status: 404 },
        ),
      ),
    );

    renderWithProviders(<CustomisationSettings />);

    const firstId = PIPELINE_STAGES_FIXTURE[0].id;

    // Wait for stages to load (requires both pipelines and stages queries to resolve)
    await waitFor(() => {
      expect(screen.getByTestId(`pipeline-stage-move-down-${firstId}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`pipeline-stage-move-down-${firstId}`));

    await waitFor(() => {
      expect(screen.getByTestId('pipeline-stages-feedback')).toBeInTheDocument();
    });
  });
});

// ── Stage exit requirements (MINCRM-527) ─────────────────────────────────────

describe('CustomisationSettings — stage exit requirements (MINCRM-527)', () => {
  const firstStage = PIPELINE_STAGES_FIXTURE[0]; // ps-1, no exit requirements

  it('shows exit requirement inputs when edit button is clicked', async () => {
    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`pipeline-stage-edit-${firstStage.id}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`pipeline-stage-edit-${firstStage.id}`));

    expect(screen.getByTestId(`pipeline-stage-exit-required-${firstStage.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pipeline-stage-exit-warning-${firstStage.id}`)).toBeInTheDocument();
  });

  it('sends stage_exit_requirements to PATCH when saving the edit form', async () => {
    const capturedBodies: unknown[] = [];
    server.use(
      http.patch(`/api/v1/settings/pipeline-stages/${firstStage.id}`, async ({ request }) => {
        capturedBodies.push(await request.json());
        return HttpResponse.json({ ...firstStage });
      }),
    );

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`pipeline-stage-edit-${firstStage.id}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`pipeline-stage-edit-${firstStage.id}`));

    fireEvent.change(screen.getByTestId(`pipeline-stage-exit-required-${firstStage.id}`), {
      target: { value: 'close_date, amount' },
    });
    fireEvent.change(screen.getByTestId(`pipeline-stage-exit-warning-${firstStage.id}`), {
      target: { value: 'notes' },
    });

    fireEvent.click(screen.getByTestId(`pipeline-stage-save-${firstStage.id}`));

    await waitFor(() => expect(capturedBodies).toHaveLength(1));

    const body = capturedBodies[0] as {
      stage_exit_requirements: { required_fields: string[]; warning_fields: string[] };
    };
    expect(body.stage_exit_requirements.required_fields).toEqual(['close_date', 'amount']);
    expect(body.stage_exit_requirements.warning_fields).toEqual(['notes']);
  });

  it('strips empty entries from comma-separated field lists (parseFieldList)', async () => {
    const capturedBodies: unknown[] = [];
    server.use(
      http.patch(`/api/v1/settings/pipeline-stages/${firstStage.id}`, async ({ request }) => {
        capturedBodies.push(await request.json());
        return HttpResponse.json({ ...firstStage });
      }),
    );

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`pipeline-stage-edit-${firstStage.id}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`pipeline-stage-edit-${firstStage.id}`));

    // Trailing comma + extra spaces should be stripped
    fireEvent.change(screen.getByTestId(`pipeline-stage-exit-required-${firstStage.id}`), {
      target: { value: '  close_date ,  , ' },
    });

    fireEvent.click(screen.getByTestId(`pipeline-stage-save-${firstStage.id}`));

    await waitFor(() => expect(capturedBodies).toHaveLength(1));

    const body = capturedBodies[0] as {
      stage_exit_requirements: { required_fields: string[]; warning_fields: string[] };
    };
    expect(body.stage_exit_requirements.required_fields).toEqual(['close_date']);
    expect(body.stage_exit_requirements.warning_fields).toEqual([]);
  });
});

// ── Custom fields section ─────────────────────────────────────────────────────

function mockEmptyCustomFields() {
  server.use(
    http.get('/api/v1/custom-fields/definitions', () => HttpResponse.json({ definitions: [] })),
  );
}

function mockCustomFieldsWithOne(piiExcluded = false) {
  server.use(
    http.get('/api/v1/custom-fields/definitions', () =>
      HttpResponse.json({
        definitions: [
          {
            id: FIELD_ID,
            entity_type: 'contact',
            name: 'NPS Score',
            field_type: 'text',
            options: null,
            sort_order: 0,
            pii_excluded: piiExcluded,
          },
        ],
      }),
    ),
  );
}

describe('CustomisationSettings — custom fields section', () => {
  it('renders the custom fields section with entity type selector', async () => {
    mockEmptyCustomFields();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('custom-fields-section')).toBeInTheDocument();
      expect(screen.getByTestId('custom-fields-entity-select')).toBeInTheDocument();
      expect(screen.getByTestId('add-field-button')).toBeInTheDocument();
    });
  });

  it('shows the add field form when Add Field is clicked', async () => {
    mockEmptyCustomFields();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => expect(screen.getByTestId('add-field-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-field-button'));

    expect(screen.getByTestId('add-field-form')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-type-select')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-submit')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-cancel')).toBeInTheDocument();
  });

  it('hides the add form when cancel is clicked', async () => {
    mockEmptyCustomFields();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => expect(screen.getByTestId('add-field-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-field-button'));
    expect(screen.getByTestId('add-field-form')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('add-field-cancel'));
    expect(screen.queryByTestId('add-field-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-field-button')).toBeInTheDocument();
  });

  it('shows validation error when submitting with empty name', async () => {
    mockEmptyCustomFields();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => expect(screen.getByTestId('add-field-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-field-button'));
    fireEvent.click(screen.getByTestId('add-field-submit'));

    expect(screen.getByTestId('add-field-error')).toBeInTheDocument();
  });

  it('shows options textarea when field type is select', async () => {
    mockEmptyCustomFields();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => expect(screen.getByTestId('add-field-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-field-button'));

    fireEvent.change(screen.getByTestId('add-field-type-select'), { target: { value: 'select' } });

    expect(screen.getByTestId('add-field-options-input')).toBeInTheDocument();
  });

  it('shows success feedback after successfully adding a field', async () => {
    mockEmptyCustomFields();
    server.use(
      http.post('/api/v1/custom-fields/definitions', async () =>
        HttpResponse.json(
          {
            id: FIELD_ID,
            entity_type: 'contact',
            name: 'New Field',
            field_type: 'text',
            options: null,
            sort_order: 0,
          },
          { status: 201 },
        ),
      ),
    );

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => expect(screen.getByTestId('add-field-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-field-button'));
    fireEvent.change(screen.getByTestId('add-field-name-input'), {
      target: { value: 'New Field' },
    });
    fireEvent.click(screen.getByTestId('add-field-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('custom-fields-feedback')).toBeInTheDocument();
    });
  });

  it('shows name conflict error when server returns CUSTOM_FIELD_NAME_CONFLICT', async () => {
    mockEmptyCustomFields();
    server.use(
      http.post('/api/v1/custom-fields/definitions', async () =>
        HttpResponse.json(
          { error: { code: 'CUSTOM_FIELD_NAME_CONFLICT', message: 'conflict' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => expect(screen.getByTestId('add-field-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-field-button'));
    fireEvent.change(screen.getByTestId('add-field-name-input'), {
      target: { value: 'Dup Field' },
    });
    fireEvent.click(screen.getByTestId('add-field-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('add-field-error')).toBeInTheDocument();
    });
  });

  it('renders the fields table when definitions exist', async () => {
    mockCustomFieldsWithOne();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('custom-fields-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId(`custom-field-row-${FIELD_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`custom-field-edit-${FIELD_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`custom-field-delete-${FIELD_ID}`)).toBeInTheDocument();
  });

  it('shows delete confirm dialog when delete is clicked', async () => {
    mockCustomFieldsWithOne();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`custom-field-delete-${FIELD_ID}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`custom-field-delete-${FIELD_ID}`));

    expect(screen.getByTestId('delete-field-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('delete-field-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('delete-field-cancel')).toBeInTheDocument();
  });

  it('dismisses delete dialog when cancel is clicked', async () => {
    mockCustomFieldsWithOne();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`custom-field-delete-${FIELD_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`custom-field-delete-${FIELD_ID}`));
    expect(screen.getByTestId('delete-field-confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('delete-field-cancel'));
    expect(screen.queryByTestId('delete-field-confirm-dialog')).not.toBeInTheDocument();
  });

  it('shows success feedback after deleting a field', async () => {
    mockCustomFieldsWithOne();
    server.use(
      http.delete(`/api/v1/custom-fields/definitions/${FIELD_ID}`, () =>
        HttpResponse.json({ id: FIELD_ID }),
      ),
    );

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`custom-field-delete-${FIELD_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`custom-field-delete-${FIELD_ID}`));
    await waitFor(() => expect(screen.getByTestId('delete-field-confirm')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-field-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('custom-fields-feedback')).toBeInTheDocument();
    });
  });

  it('shows edit inputs when edit button is clicked', async () => {
    mockCustomFieldsWithOne();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`custom-field-edit-${FIELD_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`custom-field-edit-${FIELD_ID}`));

    expect(screen.getByTestId(`custom-field-name-input-${FIELD_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`custom-field-save-${FIELD_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`custom-field-cancel-${FIELD_ID}`)).toBeInTheDocument();
  });

  it('cancels edit and restores row view when cancel is clicked', async () => {
    mockCustomFieldsWithOne();

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`custom-field-edit-${FIELD_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`custom-field-edit-${FIELD_ID}`));
    expect(screen.getByTestId(`custom-field-name-input-${FIELD_ID}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`custom-field-cancel-${FIELD_ID}`));
    expect(screen.queryByTestId(`custom-field-name-input-${FIELD_ID}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`custom-field-edit-${FIELD_ID}`)).toBeInTheDocument();
  });

  it('changes entity type when a different option is selected', async () => {
    server.use(
      http.get('/api/v1/custom-fields/definitions', ({ request }) => {
        const url = new URL(request.url);
        const entityType = url.searchParams.get('entity_type');
        if (entityType === 'deal') {
          return HttpResponse.json({
            definitions: [
              {
                id: 'deal-field-1',
                entity_type: 'deal',
                name: 'Deal Priority',
                field_type: 'text',
                options: null,
                sort_order: 0,
              },
            ],
          });
        }
        return HttpResponse.json({ definitions: [] });
      }),
    );

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId('custom-fields-entity-select')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByTestId('custom-fields-entity-select'), {
      target: { value: 'deal' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('custom-field-row-deal-field-1')).toBeInTheDocument();
    });
  });

  // ── AI field exclusion toggle (MINCRM-461) ─────────────────────────────────

  it('shows the AI-excluded badge when pii_excluded is true', async () => {
    mockCustomFieldsWithOne(true);

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`custom-field-pii-excluded-badge-${FIELD_ID}`)).toBeInTheDocument();
    });
  });

  it('does not show the AI-excluded badge when pii_excluded is false', async () => {
    mockCustomFieldsWithOne(false);

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`custom-field-row-${FIELD_ID}`)).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(`custom-field-pii-excluded-badge-${FIELD_ID}`),
    ).not.toBeInTheDocument();
  });

  it('shows the pii_excluded checkbox pre-checked when editing an excluded field', async () => {
    mockCustomFieldsWithOne(true);

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`custom-field-edit-${FIELD_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`custom-field-edit-${FIELD_ID}`));

    const checkbox = screen.getByTestId(
      `custom-field-pii-excluded-toggle-${FIELD_ID}`,
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('sends pii_excluded in the save request when the checkbox is toggled', async () => {
    mockCustomFieldsWithOne(false);
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/v1/custom-fields/definitions/:id', async ({ request, params }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: params['id'],
          entity_type: 'contact',
          name: 'NPS Score',
          field_type: 'text',
          options: null,
          sort_order: 0,
          pii_excluded: true,
        });
      }),
    );

    renderWithProviders(<CustomisationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`custom-field-edit-${FIELD_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`custom-field-edit-${FIELD_ID}`));
    fireEvent.click(screen.getByTestId(`custom-field-pii-excluded-toggle-${FIELD_ID}`));
    fireEvent.click(screen.getByTestId(`custom-field-save-${FIELD_ID}`));

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });
    expect(capturedBody).toMatchObject({ pii_excluded: true });
  });
});
