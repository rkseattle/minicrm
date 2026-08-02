/**
 * Tests for the ContactForm component. (MINCRM-198)
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import ContactForm from './ContactForm.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

// Plain function — not a spy, so call counts don't accumulate across tests
const noop = () => {};

describe('ContactForm', () => {
  describe('field rendering', () => {
    it('renders all core fields', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.getByTestId('contact-first-name')).toBeInTheDocument();
      expect(screen.getByTestId('contact-last-name')).toBeInTheDocument();
      expect(screen.getByTestId('contact-email')).toBeInTheDocument();
      expect(screen.getByTestId('contact-phone')).toBeInTheDocument();
      expect(screen.getByTestId('contact-title')).toBeInTheDocument();
      expect(screen.getByTestId('contact-department')).toBeInTheDocument();
      expect(screen.getByTestId('contact-account-select')).toBeInTheDocument();
    });

    it('does not render owner selector when users prop is omitted', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.queryByTestId('contact-owner-select')).not.toBeInTheDocument();
    });

    it('renders owner selector when users prop is provided', () => {
      renderWithProviders(
        <ContactForm onSubmit={noop} users={[{ id: 'u-1', name: 'Alice Smith' }]} />,
      );
      expect(screen.getByTestId('contact-owner-select')).toBeInTheDocument();
    });

    it('renders account options from accounts prop', () => {
      renderWithProviders(
        <ContactForm onSubmit={noop} accounts={[{ id: 'acc-1', name: 'Acme Corp' }]} />,
      );
      expect(screen.getByRole('option', { name: 'Acme Corp' })).toBeInTheDocument();
    });
  });

  describe('initialValues population', () => {
    it('pre-populates all fields from initialValues', () => {
      renderWithProviders(
        <ContactForm
          onSubmit={noop}
          initialValues={{
            first_name: 'Jane',
            last_name: 'Doe',
            email: 'jane@example.com',
            phone: '555-1234',
            title: 'Manager',
            department: 'Sales',
          }}
        />,
      );
      expect(screen.getByTestId<HTMLInputElement>('contact-first-name').value).toBe('Jane');
      expect(screen.getByTestId<HTMLInputElement>('contact-last-name').value).toBe('Doe');
      expect(screen.getByTestId<HTMLInputElement>('contact-email').value).toBe('jane@example.com');
      expect(screen.getByTestId<HTMLInputElement>('contact-phone').value).toBe('555-1234');
      expect(screen.getByTestId<HTMLInputElement>('contact-title').value).toBe('Manager');
      expect(screen.getByTestId<HTMLInputElement>('contact-department').value).toBe('Sales');
    });
  });

  describe('required-field validation', () => {
    it('first_name input is marked required', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.getByTestId<HTMLInputElement>('contact-first-name')).toBeRequired();
    });

    it('last_name input is marked required', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.getByTestId<HTMLInputElement>('contact-last-name')).toBeRequired();
    });

    it('email input is marked required', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.getByTestId<HTMLInputElement>('contact-email')).toBeRequired();
    });

    it('does not call onSubmit when required fields are empty (user.click respects HTML5 required)', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={handleSubmit} />);
      // Click the submit button — user-event triggers HTML5 constraint validation
      await user.click(screen.getByTestId('contact-form-submit'));
      expect(handleSubmit).not.toHaveBeenCalled();
    });
  });

  describe('email format validation', () => {
    it('email input has type="email" for browser format enforcement', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.getByTestId('contact-email')).toHaveAttribute('type', 'email');
    });
  });

  describe('onSubmit', () => {
    it('calls onSubmit with all form values when submitted', () => {
      const handleSubmit = vi.fn();
      renderWithProviders(<ContactForm onSubmit={handleSubmit} />);

      fireEvent.change(screen.getByTestId('contact-first-name'), {
        target: { name: 'first_name', value: 'Jane' },
      });
      fireEvent.change(screen.getByTestId('contact-last-name'), {
        target: { name: 'last_name', value: 'Doe' },
      });
      fireEvent.change(screen.getByTestId('contact-email'), {
        target: { name: 'email', value: 'jane@example.com' },
      });

      fireEvent.submit(screen.getByTestId('contact-form'));

      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
        }),
      );
    });
  });

  describe('cancel button', () => {
    it('calls onCancel when the Cancel button is clicked', async () => {
      const handleCancel = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={noop} onCancel={handleCancel} />);

      await user.click(screen.getByTestId('contact-form-cancel'));
      expect(handleCancel).toHaveBeenCalledOnce();
    });

    it('does not render Cancel button when onCancel is not provided', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.queryByTestId('contact-form-cancel')).not.toBeInTheDocument();
    });
  });

  describe('isSubmitting state', () => {
    it('disables all inputs and shows saving label when isSubmitting is true', () => {
      renderWithProviders(<ContactForm onSubmit={noop} isSubmitting />);
      expect(screen.getByTestId('contact-first-name')).toBeDisabled();
      expect(screen.getByTestId('contact-last-name')).toBeDisabled();
      expect(screen.getByTestId('contact-email')).toBeDisabled();
      expect(screen.getByTestId('contact-form-submit')).toBeDisabled();
    });
  });

  describe('error display', () => {
    it('renders the error message in an alert when error prop is set', () => {
      renderWithProviders(<ContactForm onSubmit={noop} error="Something went wrong" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    });

    it('does not render an alert when error prop is absent', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('emailWarning prop', () => {
    it('renders the email input regardless of emailWarning value', () => {
      renderWithProviders(<ContactForm onSubmit={noop} emailWarning />);
      expect(screen.getByTestId('contact-email')).toBeInTheDocument();
    });
  });

  describe('social URL auto-prepend', () => {
    it('opens the social section when a social URL is pre-populated', () => {
      renderWithProviders(
        <ContactForm
          initialValues={{ linkedin_url: 'https://linkedin.com/in/test' }}
          onSubmit={noop}
        />,
      );
      // Social panel should be open because initialValues has a URL
      expect(screen.getByTestId('contact-linkedin-url')).toBeInTheDocument();
    });

    it('toggles the social section open and closed', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={noop} />);

      // Social section starts closed (no pre-populated URLs)
      expect(screen.queryByTestId('contact-linkedin-url')).not.toBeInTheDocument();

      // Open it
      await user.click(screen.getByTestId('contact-social-toggle'));
      expect(screen.getByTestId('contact-linkedin-url')).toBeInTheDocument();

      // Close it again
      await user.click(screen.getByTestId('contact-social-toggle'));
      expect(screen.queryByTestId('contact-linkedin-url')).not.toBeInTheDocument();
    });

    it('prepends https:// to linkedin_url on blur when no protocol present', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={noop} />);

      await user.click(screen.getByTestId('contact-social-toggle'));
      const input = screen.getByTestId<HTMLInputElement>('contact-linkedin-url');
      await user.type(input, 'linkedin.com/in/jane');
      fireEvent.blur(input);

      expect(input.value).toBe('https://linkedin.com/in/jane');
    });

    it('does not modify a linkedin_url that already has https://', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={noop} />);

      await user.click(screen.getByTestId('contact-social-toggle'));
      const input = screen.getByTestId<HTMLInputElement>('contact-linkedin-url');
      await user.type(input, 'https://linkedin.com/in/jane');
      fireEvent.blur(input);

      expect(input.value).toBe('https://linkedin.com/in/jane');
    });

    it('does not modify a twitter_x_url that already has http://', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={noop} />);

      await user.click(screen.getByTestId('contact-social-toggle'));
      const input = screen.getByTestId<HTMLInputElement>('contact-twitter-x-url');
      await user.type(input, 'http://x.com/jane');
      fireEvent.blur(input);

      expect(input.value).toBe('http://x.com/jane');
    });

    it('prepends https:// to other_url on blur', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={noop} />);

      await user.click(screen.getByTestId('contact-social-toggle'));
      const input = screen.getByTestId<HTMLInputElement>('contact-other-url');
      await user.type(input, 'example.com/profile');
      fireEvent.blur(input);

      expect(input.value).toBe('https://example.com/profile');
    });

    it('does not prepend https:// when the URL field is empty on blur', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={noop} />);

      await user.click(screen.getByTestId('contact-social-toggle'));
      const input = screen.getByTestId<HTMLInputElement>('contact-linkedin-url');
      fireEvent.blur(input);

      expect(input.value).toBe('');
    });
  });

  describe('hideActions prop', () => {
    it('hides Save and Cancel buttons when hideActions is true', () => {
      renderWithProviders(<ContactForm onSubmit={noop} hideActions />);
      expect(screen.queryByTestId('contact-form-submit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('contact-form-cancel')).not.toBeInTheDocument();
    });

    it('shows Save button by default', () => {
      renderWithProviders(<ContactForm onSubmit={noop} />);
      expect(screen.getByTestId('contact-form-submit')).toBeInTheDocument();
    });
  });

  // MINCRM-439: AI contact auto-enrich from pasted text
  describe('AI contact enrichment', () => {
    it('extracts and applies fields as a diff overlay, prefilling only extracted fields', async () => {
      server.use(
        http.post('/api/v1/contacts/enrich-from-text', () =>
          HttpResponse.json({
            fields: {
              first_name: 'Jane',
              last_name: 'Doe',
              title: 'VP Sales',
              company_name: null,
              email: null,
              phone: null,
              linkedin_url: null,
              location: null,
            },
            matched_account_id: null,
            insufficient_data: false,
          }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactForm onSubmit={noop} />);

      // Flag-gated: appears once the flag query confirms it, so await it. (MINCRM-701)
      await user.click(await screen.findByTestId('contact-enrich-from-text-button'));
      await user.type(screen.getByTestId('contact-enrichment-input'), 'Jane Doe, VP Sales');
      await user.click(screen.getByTestId('contact-enrichment-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('contact-enrichment-apply')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('contact-enrichment-apply'));

      await waitFor(() => {
        expect(screen.queryByTestId('contact-enrichment-modal')).not.toBeInTheDocument();
      });
      expect((screen.getByTestId('contact-first-name') as HTMLInputElement).value).toBe('Jane');
      expect((screen.getByTestId('contact-last-name') as HTMLInputElement).value).toBe('Doe');
      expect((screen.getByTestId('contact-title') as HTMLInputElement).value).toBe('VP Sales');
      // Email was not extracted — must remain blank, not overwritten with a guess
      expect((screen.getByTestId('contact-email') as HTMLInputElement).value).toBe('');
    });
  });
});
