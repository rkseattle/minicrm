/**
 * Tests for the ContactDetailPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import ContactDetailPage from './ContactDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { CONTACT_1, ACCOUNT_1, ADMIN_USER, REP_USER, DEAL_1 } from '../test/msw/handlers.js';
import * as contactsApi from '@/api/contacts.js';

describe('ContactDetailPage', () => {
  it('renders the contact name', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('contact-name')).toHaveTextContent(
        `${CONTACT_1.first_name} ${CONTACT_1.last_name}`,
      );
    });
  });

  describe('Export PDF button', () => {
    beforeEach(() => {
      vi.spyOn(contactsApi, 'exportContactPdf').mockResolvedValue(undefined);
    });

    it('renders the Export PDF button', async () => {
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('contact-detail-export-pdf-button')).toBeInTheDocument();
      });
    });

    it('calls exportContactPdf with the contact id when clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('contact-detail-export-pdf-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('contact-detail-export-pdf-button'));
      expect(contactsApi.exportContactPdf).toHaveBeenCalledWith(CONTACT_1.id);
    });

    it('shows an error message when the export fails', async () => {
      vi.spyOn(contactsApi, 'exportContactPdf').mockRejectedValue(new Error('network error'));
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('contact-detail-export-pdf-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('contact-detail-export-pdf-button'));
      await waitFor(() => {
        expect(screen.getByTestId('export-pdf-error')).toBeInTheDocument();
      });
    });

    it('hides the Export PDF button when the csv_export flag is disabled', async () => {
      server.use(
        http.get('/api/v1/feature-flags/me', () =>
          HttpResponse.json({ flags: { csv_export: false } }),
        ),
      );
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('contact-name')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('contact-detail-export-pdf-button')).not.toBeInTheDocument();
    });
  });

  // ── AI champion/blocker classification (MINCRM-466) ─────────────────────────────

  it('shows no badge for the default neutral classification', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('contact-name')).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`champion-blocker-badge-${CONTACT_1.id}`)).not.toBeInTheDocument();
  });

  it('shows the champion badge when the classification is champion', async () => {
    server.use(
      http.get('/api/v1/contacts/:id/champion-blocker', () =>
        HttpResponse.json({
          contact_id: CONTACT_1.id,
          status: 'champion',
          is_overridden: false,
          recent_signals: [
            {
              description: 'Mentioned sharing proposal with VP Finance',
              detected_at: '2026-06-28T00:00:00.000Z',
            },
          ],
          dismissed: false,
          updated_at: '2026-06-28T00:00:00.000Z',
        }),
      ),
    );
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId(`champion-blocker-badge-${CONTACT_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`champion-blocker-badge-${CONTACT_1.id}`)).toHaveTextContent(
      'Champion',
    );
  });

  it('dismisses the classification when Not accurate is clicked', async () => {
    // Stateful mock: the GET handler reflects whatever the dismiss POST last wrote, so the
    // query-invalidation refetch after dismissing sees dismissed=true, matching real backend behavior.
    let dismissed = false;
    server.use(
      http.get('/api/v1/contacts/:id/champion-blocker', () =>
        HttpResponse.json({
          contact_id: CONTACT_1.id,
          status: 'likely_blocker',
          is_overridden: false,
          recent_signals: [],
          dismissed,
          updated_at: '2026-06-28T00:00:00.000Z',
        }),
      ),
      http.post('/api/v1/contacts/:id/champion-blocker/dismiss', () => {
        dismissed = true;
        return HttpResponse.json({
          contact_id: CONTACT_1.id,
          status: 'likely_blocker',
          is_overridden: false,
          recent_signals: [],
          dismissed: true,
          updated_at: '2026-06-28T00:00:00.000Z',
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId(`champion-blocker-dismiss-${CONTACT_1.id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId(`champion-blocker-dismiss-${CONTACT_1.id}`));
    await waitFor(() => {
      expect(
        screen.queryByTestId(`champion-blocker-badge-${CONTACT_1.id}`),
      ).not.toBeInTheDocument();
    });
  });

  it('renders contact detail fields', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-email')).toHaveTextContent(CONTACT_1.email);
    });
    expect(screen.getByTestId('detail-phone')).toHaveTextContent(CONTACT_1.phone!);
    expect(screen.getByTestId('detail-title')).toHaveTextContent(CONTACT_1.title!);
    expect(screen.getByTestId('detail-department')).toHaveTextContent(CONTACT_1.department!);
  });

  it('renders edit and delete buttons', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
  });

  it('shows the edit form when Edit is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    expect(screen.getByTestId('contact-form')).toBeInTheDocument();
  });

  it('pre-populates the edit form with existing values', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    expect(screen.getByTestId<HTMLInputElement>('contact-first-name').value).toBe(
      CONTACT_1.first_name,
    );
    expect(screen.getByTestId<HTMLInputElement>('contact-email').value).toBe(CONTACT_1.email);
  });

  it('saves the edit form and returns to detail view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    });
  });

  it('cancels the edit form and returns to detail view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    await user.click(screen.getByTestId('contact-form-cancel'));

    expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('contact-name')).toBeInTheDocument();
  });

  it('shows not-found message when contact does not exist', async () => {
    server.use(
      http.get('/api/v1/contacts/:id', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: ['/contacts/nonexistent'],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('opens the confirm-delete modal when Delete is clicked', async () => {
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));

    expect(screen.getByTestId('confirm-delete-modal')).toBeInTheDocument();
  });

  it('calls delete API and navigates away when modal confirm is clicked', async () => {
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));
    await user.click(screen.getByTestId('confirm-delete-confirm'));

    // After delete the component navigates to /contacts; confirm the button is gone
    await waitFor(() => {
      expect(screen.queryByTestId('delete-contact-button')).not.toBeInTheDocument();
    });
  });

  it('renders the linked account name as a clickable link', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      const accountLink = screen.getByTestId('detail-account');
      expect(accountLink).toHaveTextContent(ACCOUNT_1.name);
    });
    expect(screen.getByTestId('detail-account').closest('a')).toHaveAttribute(
      'href',
      `/accounts/${ACCOUNT_1.id}`,
    );
  });

  it('renders "—" in the account row when no account is linked', async () => {
    server.use(
      http.get('/api/v1/contacts/:id', ({ params }) => {
        if (params.id === CONTACT_1.id) {
          return HttpResponse.json({ contact: { ...CONTACT_1, account_id: null } });
        }
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        );
      }),
    );
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-account')).toHaveTextContent('—');
    });
  });

  it('displays the owner name (not UUID) in the detail view', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-owner')).toHaveTextContent(ADMIN_USER.name);
    });
    expect(screen.getByTestId('detail-owner')).not.toHaveTextContent(CONTACT_1.owner_id!);
  });

  it('shows fallback owner text when owner is not in the active users list', async () => {
    server.use(
      http.get('/api/v1/contacts/:id', ({ params }) => {
        if (params.id === CONTACT_1.id) {
          return HttpResponse.json({
            contact: { ...CONTACT_1, owner_id: '00000000-0000-0000-0000-000000000999' },
          });
        }
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        );
      }),
    );
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-owner')).toHaveTextContent('Unknown');
    });
  });

  it('renders the owner select immediately when the edit form opens, even if the active users query is still loading', async () => {
    // Hang the active users response so it never resolves during this test.
    // The owner select must still render — the form cannot gate on this query.
    server.use(http.get('/api/v1/users/active', () => new Promise(() => {})));

    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    // Select must be present even though users haven't loaded yet
    const ownerSelect = screen.getByTestId<HTMLSelectElement>('contact-owner-select');
    expect(ownerSelect).toBeInTheDocument();
    // The current owner UUID is preserved in state (not silently replaced)
    expect(ownerSelect.value).toBe(CONTACT_1.owner_id);
  });

  it('shows the owner select in the edit form populated with active users', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    const ownerSelect = screen.getByTestId<HTMLSelectElement>('contact-owner-select');
    expect(ownerSelect).toBeInTheDocument();
    // Should be pre-populated with the current owner
    expect(ownerSelect.value).toBe(CONTACT_1.owner_id);
    // Should list both active users as options
    const options = Array.from(ownerSelect.options).map((o) => o.text);
    expect(options).toContain(ADMIN_USER.name);
    expect(options).toContain(REP_USER.name);
  });

  it('shows a disabled unknown option in the edit form when the owner is deactivated', async () => {
    const deactivatedOwnerId = '00000000-0000-0000-0000-000000000999';
    server.use(
      http.get('/api/v1/contacts/:id', ({ params }) => {
        if (params.id === CONTACT_1.id) {
          return HttpResponse.json({
            contact: { ...CONTACT_1, owner_id: deactivatedOwnerId },
          });
        }
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    const ownerSelect = screen.getByTestId<HTMLSelectElement>('contact-owner-select');
    // The unknown UUID must be preserved in the select's value, not silently replaced
    expect(ownerSelect.value).toBe(deactivatedOwnerId);
    // The disabled placeholder option should be present so the browser shows it
    const unknownOption = Array.from(ownerSelect.options).find(
      (o) => o.value === deactivatedOwnerId,
    );
    expect(unknownOption).toBeDefined();
    expect(unknownOption?.disabled).toBe(true);
  });

  it('sends updated owner_id when owner is changed and form is saved', async () => {
    const user = userEvent.setup();
    let patchedBody: Record<string, unknown> = {};
    server.use(
      http.patch('/api/v1/contacts/:id', async ({ params, request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          contact: { ...CONTACT_1, ...patchedBody, id: params.id as string },
        });
      }),
    );

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    await user.selectOptions(screen.getByTestId('contact-owner-select'), REP_USER.id);
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(patchedBody.owner_id).toBe(REP_USER.id);
    });
  });

  it('renders the linked deals section heading', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('linked-deals-heading')).toBeInTheDocument();
    });
  });

  it('shows linked deal with name and stage', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId(`linked-deal-${DEAL_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`linked-deal-${DEAL_1.id}`)).toHaveTextContent(DEAL_1.name);
    expect(screen.getByText(DEAL_1.stage)).toBeInTheDocument();
  });

  it('shows empty state when no deals are linked', async () => {
    server.use(http.get('/api/v1/contacts/:id/deals', () => HttpResponse.json({ deals: [] })));
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('linked-deals-empty')).toBeInTheDocument();
    });
  });

  it('linked deal name links to the deal detail page', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId(`linked-deal-${DEAL_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`linked-deal-${DEAL_1.id}`)).toHaveAttribute(
      'href',
      `/deals/${DEAL_1.id}`,
    );
  });

  it('does not delete when modal cancel is clicked', async () => {
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));
    await user.click(screen.getByTestId('confirm-delete-cancel'));

    // Modal dismissed, delete button still present — delete was not called
    expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
  });

  it('renders back-to-contacts link with aria-label', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      const backLink = screen.getByTestId('back-to-contacts');
      expect(backLink).toHaveAttribute('aria-label');
    });
  });

  it('shows a delete error message when the delete request fails', async () => {
    server.use(
      http.delete('/api/v1/contacts/:id', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));
    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-error')).toBeInTheDocument();
    });
  });

  it('shows an update error when saving contact changes fails', async () => {
    server.use(
      http.patch('/api/v1/contacts/:id', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Email already in use' } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-contact-button'));
    await user.click(screen.getByTestId('contact-form-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('optimistic-locking conflict resolution (MINCRM-385)', () => {
    // CONTACT_1 is at version 1; the background write bumps it to version 2 with first_name='Theirs'.
    // The UI has first_name='Mine' (user changed it) — a true conflict on first_name.
    const CONTACT_AT_V2 = { ...CONTACT_1, first_name: 'Theirs', version: 2 };
    const CONTACT_AT_V3 = { ...CONTACT_1, first_name: 'Mine', version: 3 };

    it('opens the FieldMergeModal when a PATCH returns OPTIMISTIC_LOCK_CONFLICT', async () => {
      server.use(
        http.patch('/api/v1/contacts/:id', () =>
          HttpResponse.json(
            {
              error: {
                code: 'OPTIMISTIC_LOCK_CONFLICT',
                message: 'Conflict',
                current: CONTACT_AT_V2,
              },
            },
            { status: 409 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await user.click(screen.getByTestId('contact-form-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('field-merge-modal')).toBeInTheDocument();
      });
    });

    it('re-submits with conflictTheirs.version (mine-wins) so the re-save uses the correct version', async () => {
      let patchCallCount = 0;
      let secondPatchVersion: number | undefined;

      server.use(
        http.patch('/api/v1/contacts/:id', async ({ request }) => {
          patchCallCount++;
          const body = (await request.json()) as Record<string, unknown>;

          if (patchCallCount === 1) {
            // First PATCH — simulate conflict; CONTACT_1 is at v1, server is at v2
            return HttpResponse.json(
              {
                error: {
                  code: 'OPTIMISTIC_LOCK_CONFLICT',
                  message: 'Conflict',
                  current: CONTACT_AT_V2,
                },
              },
              { status: 409 },
            );
          }

          // Second PATCH — conflict resolution re-submit
          secondPatchVersion = body.version as number;
          return HttpResponse.json({ contact: CONTACT_AT_V3 });
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });

      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      // Change first_name so mine differs from base — creates a true conflict with CONTACT_AT_V2's 'Theirs'
      await user.clear(screen.getByTestId('contact-first-name'));
      await user.type(screen.getByTestId('contact-first-name'), 'Mine');
      await user.click(screen.getByTestId('contact-form-submit'));

      // Modal should appear with first_name as a true conflict (mine='Mine', theirs='Theirs')
      await waitFor(() => {
        expect(screen.getByTestId('field-merge-modal')).toBeInTheDocument();
      });

      // Switch to "mine" for first_name and save resolved
      await user.click(screen.getByTestId('field-merge-radio-first_name-mine'));
      await user.click(screen.getByTestId('field-merge-save-button'));

      // Wait for the modal to close (re-submit succeeded)
      await waitFor(() => {
        expect(screen.queryByTestId('field-merge-modal')).not.toBeInTheDocument();
      });

      // The re-submit must have used version from conflictTheirs (v2), not the stale cache (v1)
      expect(secondPatchVersion).toBe(2);
    });

    it('seeds the cache from the conflict-resolution PATCH response so a subsequent save uses the post-resolve version (MINCRM-385)', async () => {
      let patchCallCount = 0;
      const capturedVersions: number[] = [];
      // Simulate server state: GET reflects the latest committed version after each PATCH
      let serverContact = { ...CONTACT_1 };

      server.use(
        http.get('/api/v1/contacts/:id', ({ params }) => {
          if (params.id === CONTACT_1.id) {
            return HttpResponse.json({ contact: serverContact });
          }
          return HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
            { status: 404 },
          );
        }),
        http.patch('/api/v1/contacts/:id', async ({ request }) => {
          patchCallCount++;
          const body = (await request.json()) as Record<string, unknown>;
          capturedVersions.push(body.version as number);

          if (patchCallCount === 1) {
            // Background write already bumped server to v2; return conflict
            serverContact = CONTACT_AT_V2;
            return HttpResponse.json(
              {
                error: {
                  code: 'OPTIMISTIC_LOCK_CONFLICT',
                  message: 'Conflict',
                  current: CONTACT_AT_V2,
                },
              },
              { status: 409 },
            );
          }
          if (patchCallCount === 2) {
            // Conflict resolution re-submit at v2 → server commits v3
            serverContact = CONTACT_AT_V3;
            return HttpResponse.json({ contact: CONTACT_AT_V3 });
          }
          // Third PATCH — subsequent clean edit at v3 → server commits v4
          const v4 = { ...CONTACT_AT_V3, first_name: 'PostResolve', version: 4 };
          serverContact = v4;
          return HttpResponse.json({ contact: v4 });
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });

      // --- First edit: triggers conflict ---
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      // Change first_name so it conflicts with CONTACT_AT_V2's 'Theirs'
      await user.clear(screen.getByTestId('contact-first-name'));
      await user.type(screen.getByTestId('contact-first-name'), 'Mine');
      await user.click(screen.getByTestId('contact-form-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('field-merge-modal')).toBeInTheDocument();
      });

      // Resolve with "mine" — radio buttons appear because it's a true conflict
      await user.click(screen.getByTestId('field-merge-radio-first_name-mine'));
      await user.click(screen.getByTestId('field-merge-save-button'));

      // Wait for page to return to read mode after conflict resolution
      await waitFor(() => {
        expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('field-merge-modal')).not.toBeInTheDocument();

      // --- Second edit: must save cleanly at version 3 ---
      await user.click(screen.getByTestId('edit-contact-button'));
      await user.click(screen.getByTestId('contact-form-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('field-merge-modal')).not.toBeInTheDocument();

      // The subsequent save must use the post-resolve version (3), not the stale pre-conflict version (1)
      expect(capturedVersions[2]).toBe(3);
    });
  });

  it('shows the merge button and opens the merge panel when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => expect(screen.getByTestId('merge-contact-button')).toBeInTheDocument());
    await user.click(screen.getByTestId('merge-contact-button'));
    expect(screen.getByTestId('merge-contact-panel')).toBeInTheDocument();
  });

  describe('address management (edit mode)', () => {
    it('shows the addresses section in edit mode', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      expect(screen.getByTestId('contact-addresses-section')).toBeInTheDocument();
    });

    it('shows the add address button in edit mode', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      expect(screen.getByTestId('add-address-button')).toBeInTheDocument();
    });

    it('shows the add address inline form when Add Address is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await user.click(screen.getByTestId('add-address-button'));
      expect(screen.getByTestId('add-address-form')).toBeInTheDocument();
    });

    it('hides the add form when Cancel is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await user.click(screen.getByTestId('add-address-button'));
      await user.click(screen.getByTestId('cancel-address-button'));
      expect(screen.queryByTestId('add-address-form')).not.toBeInTheDocument();
    });

    it('submits a new address and hides the form on success', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await user.click(screen.getByTestId('add-address-button'));
      await user.type(screen.getByTestId('new-address-line1'), '123 Main St');
      await user.click(screen.getByTestId('save-address-button'));
      await waitFor(() => {
        expect(screen.queryByTestId('add-address-form')).not.toBeInTheDocument();
      });
    });

    it('shows existing addresses when the address list is non-empty', async () => {
      const addressId = '00000000-0000-0000-0000-000000000501';
      server.use(
        http.get('/api/v1/contacts/:id/addresses', () =>
          HttpResponse.json({
            addresses: [
              {
                id: addressId,
                contact_id: CONTACT_1.id,
                label: 'Work',
                address_line1: '100 Office Blvd',
                address_line2: null,
                city: 'Seattle',
                state_region: 'WA',
                postal_code: '98101',
                country: 'US',
                is_default: true,
                created_at: '2025-01-01T00:00:00.000Z',
              },
            ],
          }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await waitFor(() => {
        expect(screen.getByTestId(`address-row-${addressId}`)).toBeInTheDocument();
      });
      expect(screen.getByTestId(`address-default-badge-${addressId}`)).toBeInTheDocument();
    });

    it('removes an address when Remove is clicked', async () => {
      const addressId = '00000000-0000-0000-0000-000000000502';
      let deleted = false;
      server.use(
        http.get('/api/v1/contacts/:id/addresses', () =>
          HttpResponse.json({
            addresses: deleted
              ? []
              : [
                  {
                    id: addressId,
                    contact_id: CONTACT_1.id,
                    label: null,
                    address_line1: '42 Delete Me',
                    address_line2: null,
                    city: null,
                    state_region: null,
                    postal_code: null,
                    country: null,
                    is_default: false,
                    created_at: '2025-01-01T00:00:00.000Z',
                  },
                ],
          }),
        ),
        http.delete('/api/v1/contacts/:id/addresses/:addressId', () => {
          deleted = true;
          return HttpResponse.json({ success: true });
        }),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await waitFor(() => {
        expect(screen.getByTestId(`remove-address-${addressId}`)).toBeInTheDocument();
      });
      await user.click(screen.getByTestId(`remove-address-${addressId}`));
      // After successful delete the query is invalidated; address row should disappear
      await waitFor(() => {
        expect(screen.queryByTestId(`address-row-${addressId}`)).not.toBeInTheDocument();
      });
    });

    it('sets an address as default when Set as Default is clicked', async () => {
      const addressId = '00000000-0000-0000-0000-000000000503';
      server.use(
        http.get('/api/v1/contacts/:id/addresses', () =>
          HttpResponse.json({
            addresses: [
              {
                id: addressId,
                contact_id: CONTACT_1.id,
                label: null,
                address_line1: '99 Non-Default St',
                address_line2: null,
                city: null,
                state_region: null,
                postal_code: null,
                country: null,
                is_default: false,
                created_at: '2025-01-01T00:00:00.000Z',
              },
            ],
          }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await waitFor(() => {
        expect(screen.getByTestId(`set-default-address-${addressId}`)).toBeInTheDocument();
      });
      await user.click(screen.getByTestId(`set-default-address-${addressId}`));
      // Mutation fires; no error expected
    });

    it('shows an error message when saving an address fails', async () => {
      server.use(
        http.post('/api/v1/contacts/:id/addresses', () =>
          HttpResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Address is invalid' } },
            { status: 400 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await user.click(screen.getByTestId('add-address-button'));
      await user.type(screen.getByTestId('new-address-line1'), '123 Bad St');
      await user.click(screen.getByTestId('save-address-button'));
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('resets address state when edit is cancelled', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-contact-button'));
      await user.click(screen.getByTestId('add-address-button'));
      expect(screen.getByTestId('add-address-form')).toBeInTheDocument();

      await user.click(screen.getByTestId('contact-form-cancel'));
      // Back in view mode — add-address form should be gone
      expect(screen.queryByTestId('add-address-form')).not.toBeInTheDocument();
    });
  });

  describe('social profile display', () => {
    it('shows other_url as a clickable link when set', async () => {
      server.use(
        http.get('/api/v1/contacts/:id', ({ params }) => {
          if (params.id === CONTACT_1.id) {
            return HttpResponse.json({
              contact: { ...CONTACT_1, other_url: 'https://example.com/profile' },
            });
          }
          return HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: 'Not found' } },
            { status: 404 },
          );
        }),
      );
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('detail-other-link')).toBeInTheDocument();
      });
      expect(screen.getByTestId('detail-other-link')).toHaveAttribute(
        'href',
        'https://example.com/profile',
      );
    });
  });

  // ── AI email draft generation (MINCRM-437) ──────────────────────────────────────

  describe('email draft generation', () => {
    it('shows the Draft Email button when the flag is enabled', async () => {
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('draft-email-button')).toBeInTheDocument();
      });
    });

    it('hides the Draft Email button when the ai_email_draft flag is disabled', async () => {
      server.use(
        http.get('/api/v1/feature-flags/me', () =>
          HttpResponse.json({ flags: { ai_email_draft: false } }),
        ),
      );
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('contact-name')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('draft-email-button')).not.toBeInTheDocument();
    });

    it('generates a draft and opens the panel on click', async () => {
      server.use(
        http.post('/api/v1/contacts/:id/email-draft', () =>
          HttpResponse.json({
            subject: 'Following up on our conversation',
            body: 'Hi there, following up on our last call.',
            tone: 'Professional',
            generated_at: '2026-07-04T00:00:00.000Z',
          }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('draft-email-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('draft-email-button'));

      await waitFor(() => {
        expect(screen.getByTestId('email-draft-panel')).toBeInTheDocument();
      });
      expect(screen.getByTestId('email-draft-subject')).toHaveValue(
        'Following up on our conversation',
      );
    });

    it('shows an error when draft generation fails', async () => {
      server.use(
        http.post('/api/v1/contacts/:id/email-draft', () =>
          HttpResponse.json(
            { error: { code: 'AI_PROVIDER_ERROR', message: 'AI provider error' } },
            { status: 502 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('draft-email-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('draft-email-button'));

      await waitFor(() => {
        expect(screen.getByTestId('email-draft-generate-error')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('email-draft-panel')).not.toBeInTheDocument();
    });

    it('dismisses the panel and returns to the contact detail view', async () => {
      server.use(
        http.post('/api/v1/contacts/:id/email-draft', () =>
          HttpResponse.json({
            subject: 'Subject',
            body: 'Body',
            tone: 'Professional',
            generated_at: '2026-07-04T00:00:00.000Z',
          }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ContactDetailPage />, {
        initialEntries: [`/contacts/${CONTACT_1.id}`],
        path: '/contacts/:id',
      });
      await waitFor(() => {
        expect(screen.getByTestId('draft-email-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('draft-email-button'));
      await waitFor(() => {
        expect(screen.getByTestId('email-draft-panel')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('email-draft-dismiss'));

      await waitFor(() => {
        expect(screen.queryByTestId('email-draft-panel')).not.toBeInTheDocument();
      });
    });
  });
});
