/**
 * Tests for CustomisationSettings — custom fields section (MINCRM-276)
 *
 * Covers:
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

const FIELD_ID = '00000000-0000-0000-0000-000000000099';

function mockEmptyCustomFields() {
  server.use(
    http.get('/api/v1/custom-fields/definitions', () => HttpResponse.json({ definitions: [] })),
  );
}

function mockCustomFieldsWithOne() {
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
});
