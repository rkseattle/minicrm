/**
 * Tests for the WarmIntroPathsPanel component. (MINCRM-468)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import WarmIntroPathsPanel from './WarmIntroPathsPanel.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';

const CONTACT_ID = '00000000-0000-0000-0000-000000000101';

describe('WarmIntroPathsPanel', () => {
  it('does not fetch paths until the button is clicked', () => {
    renderWithProviders(<WarmIntroPathsPanel contactId={CONTACT_ID} />);
    expect(screen.queryByTestId('warm-intro-paths-results-' + CONTACT_ID)).not.toBeInTheDocument();
  });

  it('shows a no-paths-found message when the response is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WarmIntroPathsPanel contactId={CONTACT_ID} />);

    await user.click(screen.getByTestId(`find-warm-path-${CONTACT_ID}`));

    await waitFor(() => {
      expect(screen.getByTestId('warm-intro-empty')).toBeInTheDocument();
    });
  });

  it('renders ranked paths with the suggested introduction message', async () => {
    server.use(
      http.get(`/api/v1/contacts/${CONTACT_ID}/warm-paths`, () =>
        HttpResponse.json({
          target_contact_id: CONTACT_ID,
          paths: [
            {
              links: [
                {
                  contact_id: '00000000-0000-0000-0000-000000000201',
                  first_name: 'Alex',
                  last_name: 'Rivera',
                  title: 'VP Sales',
                  relationship_strength: 0.8,
                },
                {
                  contact_id: CONTACT_ID,
                  first_name: 'Jane',
                  last_name: 'Doe',
                  title: null,
                  relationship_strength: 1,
                },
              ],
              path_strength: 0.8,
              suggested_introduction_message: 'Would you introduce me to Jane?',
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<WarmIntroPathsPanel contactId={CONTACT_ID} />);

    await user.click(screen.getByTestId(`find-warm-path-${CONTACT_ID}`));

    await waitFor(() => {
      expect(screen.getByTestId('warm-intro-path-0')).toBeInTheDocument();
    });
    expect(screen.getByText('Would you introduce me to Jane?')).toBeInTheDocument();
    expect(screen.getByText('VP Sales')).toBeInTheDocument();
  });

  it('shows an error message when the request fails', async () => {
    server.use(
      http.get(`/api/v1/contacts/${CONTACT_ID}/warm-paths`, () =>
        HttpResponse.json({ error: { code: 'SERVER_ERROR', message: 'boom' } }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<WarmIntroPathsPanel contactId={CONTACT_ID} />);

    await user.click(screen.getByTestId(`find-warm-path-${CONTACT_ID}`));

    await waitFor(() => {
      expect(screen.getByTestId('warm-intro-error')).toBeInTheDocument();
    });
  });
});
