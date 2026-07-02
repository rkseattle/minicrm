/**
 * Tests for the RichTextField component. (MINCRM-473)
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RichTextField from './RichTextField.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

describe('RichTextField', () => {
  it('renders the initial plain-text value', async () => {
    renderWithProviders(
      <RichTextField
        value="Hello world"
        onChange={vi.fn()}
        testId="test-field"
        ariaLabel="Test field"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('test-field-content')).toHaveTextContent('Hello world');
    });
  });

  it('renders the formatting toolbar', async () => {
    renderWithProviders(
      <RichTextField value="" onChange={vi.fn()} testId="test-field" ariaLabel="Test field" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('rich-text-toolbar-bold')).toBeInTheDocument();
    });
    expect(screen.getByTestId('rich-text-toolbar-italic')).toBeInTheDocument();
    expect(screen.getByTestId('rich-text-toolbar-underline')).toBeInTheDocument();
    expect(screen.getByTestId('rich-text-toolbar-bullet-list')).toBeInTheDocument();
    expect(screen.getByTestId('rich-text-toolbar-ordered-list')).toBeInTheDocument();
  });

  it('renders a focusable, editable content area', async () => {
    renderWithProviders(
      <RichTextField value="" onChange={vi.fn()} testId="test-field" ariaLabel="Test field" />,
    );
    const editable = await screen.findByTestId('test-field-content');
    expect(editable).toHaveAttribute('contenteditable', 'true');
    expect(editable).toHaveAttribute('role', 'textbox');
  });
});
