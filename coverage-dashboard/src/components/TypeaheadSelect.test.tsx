import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TypeaheadSelect from './TypeaheadSelect.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';

function renderTypeahead(overrides: Partial<Parameters<typeof TypeaheadSelect>[0]> = {}) {
  const onSelect = vi.fn();
  const search = vi.fn().mockResolvedValue([{ value: 'v1', label: 'Result One' }]);
  renderWithProviders(
    <TypeaheadSelect
      id="x"
      label="Search"
      testId="ta"
      placeholder="type…"
      queryKey={['test', 'typeahead']}
      search={search}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect, search };
}

describe('TypeaheadSelect', () => {
  it('is disabled with a title reason when disabled=true', () => {
    renderTypeahead({ disabled: true, disabledReason: 'Pick a build first' });
    const input = screen.getByTestId('ta');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('title', 'Pick a build first');
  });

  it('shows a hint instead of searching when the term is below the minimum length', async () => {
    const { search } = renderTypeahead();
    await userEvent.type(screen.getByTestId('ta'), 'a');

    await waitFor(() => expect(screen.getByTestId('ta-hint')).toBeInTheDocument());
    expect(search).not.toHaveBeenCalled();
  });

  it('debounces and searches once the term reaches the minimum length', async () => {
    const { search } = renderTypeahead();
    await userEvent.type(screen.getByTestId('ta'), 'ab');

    await waitFor(() => expect(search).toHaveBeenCalledWith('ab'));
    await waitFor(() => expect(screen.getByTestId('ta-results')).toBeInTheDocument());
    expect(screen.getByTestId('ta-option-v1')).toHaveTextContent('Result One');
  });

  it('calls onSelect and clears the input when a result is chosen', async () => {
    const { onSelect } = renderTypeahead();
    await userEvent.type(screen.getByTestId('ta'), 'ab');
    await waitFor(() => expect(screen.getByTestId('ta-option-v1')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('ta-option-v1'));

    expect(onSelect).toHaveBeenCalledWith('v1');
    expect(screen.getByTestId('ta')).toHaveValue('');
  });

  it('shows a no-results message when the search resolves empty', async () => {
    renderTypeahead({ search: vi.fn().mockResolvedValue([]) });
    await userEvent.type(screen.getByTestId('ta'), 'zz');

    await waitFor(() => expect(screen.getByTestId('ta-no-results')).toBeInTheDocument());
  });

  it('shows an error message when the search rejects', async () => {
    renderTypeahead({ search: vi.fn().mockRejectedValue(new Error('boom')) });
    await userEvent.type(screen.getByTestId('ta'), 'zz');

    await waitFor(() => expect(screen.getByTestId('ta-error')).toBeInTheDocument());
  });
});
