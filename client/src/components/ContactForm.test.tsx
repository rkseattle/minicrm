/**
 * Tests for the ContactForm component.
 */

import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ContactForm from './ContactForm.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const noop = vi.fn();

describe('ContactForm', () => {
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
});
