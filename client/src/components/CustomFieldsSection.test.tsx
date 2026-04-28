/**
 * Tests for CustomFieldsSection — MINCRM-276
 *
 * Covers:
 *  - Returns null when no definitions exist (read mode)
 *  - Returns null when definitions exist but all values are empty (read mode)
 *  - Renders read grid with field values when values are present
 *  - Renders edit grid with text/number/date/boolean/select inputs in edit mode
 *  - Calls onValuesChange when an input changes
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import CustomFieldsSection from './CustomFieldsSection.js';

const DEF_ID = '00000000-0000-0000-0000-000000000001';
const DEF_ID_2 = '00000000-0000-0000-0000-000000000002';
const RECORD_ID = '00000000-0000-0000-0000-000000000010';

function mockDefinitions(defs: object[]) {
  server.use(
    http.get('/api/custom-fields/definitions', () =>
      HttpResponse.json({ definitions: defs }),
    ),
  );
}

function mockValues(values: object[]) {
  server.use(
    http.get(`/api/custom-fields/contact/${RECORD_ID}/custom-fields`, () =>
      HttpResponse.json({ values }),
    ),
  );
}

describe('CustomFieldsSection — read mode', () => {
  it('renders nothing when there are no definitions', async () => {
    mockDefinitions([]);
    mockValues([]);

    const { container } = renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={false} />,
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders nothing when definitions exist but all values are empty', async () => {
    mockDefinitions([{ id: DEF_ID, name: 'Field A', field_type: 'text', options: null, sort_order: 0 }]);
    mockValues([{ definition_id: DEF_ID, value: null, definition: { id: DEF_ID, name: 'Field A', field_type: 'text' } }]);

    const { container } = renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={false} />,
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders the read grid with field values when data is present', async () => {
    mockDefinitions([{ id: DEF_ID, name: 'NPS Score', field_type: 'text', options: null, sort_order: 0 }]);
    mockValues([
      {
        definition_id: DEF_ID,
        value: 'High',
        definition: { id: DEF_ID, name: 'NPS Score', field_type: 'text' },
      },
    ]);

    renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('custom-fields-read-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId(`custom-field-label-${DEF_ID}`)).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });
});

describe('CustomFieldsSection — edit mode', () => {
  it('renders nothing when there are no definitions', async () => {
    mockDefinitions([]);
    mockValues([]);

    const { container } = renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={true} />,
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders a text input for a text field', async () => {
    mockDefinitions([{ id: DEF_ID, name: 'Field A', field_type: 'text', options: null, sort_order: 0 }]);
    mockValues([]);

    renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={true} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('custom-fields-edit-grid')).toBeInTheDocument();
    });
    const input = screen.getByTestId(`custom-field-input-${DEF_ID}`);
    expect(input).toHaveAttribute('type', 'text');
  });

  it('renders a number input for a number field', async () => {
    mockDefinitions([{ id: DEF_ID, name: 'Score', field_type: 'number', options: null, sort_order: 0 }]);
    mockValues([]);

    renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={true} />,
    );

    await waitFor(() => expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toHaveAttribute('type', 'number');
  });

  it('renders a date input for a date field', async () => {
    mockDefinitions([{ id: DEF_ID, name: 'Renewal Date', field_type: 'date', options: null, sort_order: 0 }]);
    mockValues([]);

    renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={true} />,
    );

    await waitFor(() => expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toHaveAttribute('type', 'date');
  });

  it('renders a checkbox for a boolean field', async () => {
    mockDefinitions([{ id: DEF_ID, name: 'Active', field_type: 'boolean', options: null, sort_order: 0 }]);
    mockValues([]);

    renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={true} />,
    );

    await waitFor(() => expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toHaveAttribute('type', 'checkbox');
  });

  it('renders a select for a select field with its options', async () => {
    mockDefinitions([
      { id: DEF_ID, name: 'Tier', field_type: 'select', options: ['Bronze', 'Silver', 'Gold'], sort_order: 0 },
    ]);
    mockValues([]);

    renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={true} />,
    );

    await waitFor(() => expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toBeInTheDocument());
    const select = screen.getByTestId(`custom-field-input-${DEF_ID}`);
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Bronze' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Silver' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gold' })).toBeInTheDocument();
  });

  it('seeds the text input from the existing server value', async () => {
    mockDefinitions([{ id: DEF_ID, name: 'Contract Tier', field_type: 'text', options: null, sort_order: 0 }]);
    mockValues([
      {
        definition_id: DEF_ID,
        value: 'Enterprise',
        definition: { id: DEF_ID, name: 'Contract Tier', field_type: 'text' },
      },
    ]);

    renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={true} />,
    );

    await waitFor(() => {
      const input = screen.getByTestId(`custom-field-input-${DEF_ID}`) as HTMLInputElement;
      expect(input.value).toBe('Enterprise');
    });
  });

  it('calls onValuesChange with updated values when input changes', async () => {
    mockDefinitions([{ id: DEF_ID, name: 'Note', field_type: 'text', options: null, sort_order: 0 }]);
    mockValues([]);

    const onValuesChange = vi.fn();

    renderWithProviders(
      <CustomFieldsSection
        entityType="contact"
        recordId={RECORD_ID}
        isEditing={true}
        onValuesChange={onValuesChange}
      />,
    );

    await waitFor(() => expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toBeInTheDocument());

    fireEvent.change(screen.getByTestId(`custom-field-input-${DEF_ID}`), {
      target: { value: 'Hello' },
    });

    await waitFor(() => {
      const lastCall = onValuesChange.mock.calls.at(-1)?.[0] as Array<{ definition_id: string; value: string | null }>;
      expect(lastCall).toBeDefined();
      const entry = lastCall.find((v) => v.definition_id === DEF_ID);
      expect(entry?.value).toBe('Hello');
    });
  });

  it('renders multiple fields in the edit grid', async () => {
    mockDefinitions([
      { id: DEF_ID, name: 'Field A', field_type: 'text', options: null, sort_order: 0 },
      { id: DEF_ID_2, name: 'Field B', field_type: 'number', options: null, sort_order: 1 },
    ]);
    mockValues([]);

    renderWithProviders(
      <CustomFieldsSection entityType="contact" recordId={RECORD_ID} isEditing={true} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`custom-field-input-${DEF_ID}`)).toBeInTheDocument();
      expect(screen.getByTestId(`custom-field-input-${DEF_ID_2}`)).toBeInTheDocument();
    });
  });
});
