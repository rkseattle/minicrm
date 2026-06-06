/**
 * Tests for the AutomationRulesPage component.
 * Covers page structure, rule list, create form, enable/disable toggle,
 * delete confirmation, and execution logs drawer.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import AutomationRulesPage from './AutomationRulesPage.js';

// Resolve feature flags synchronously so the page's own loading/error/empty states are testable.
vi.mock('@/hooks/useFeatureFlag.js', () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  useFeatureFlags: () => ({ flags: {}, isLoading: false }),
}));
import { renderWithProviders } from '../test/renderWithProviders.js';
import { AUTOMATION_RULE_1, AUTOMATION_LOG_1 } from '../test/msw/handlers.js';
import { server } from '../test/setup.js';

describe('AutomationRulesPage', () => {
  describe('page structure', () => {
    it('renders the page heading', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('automation-rules-heading')).toBeInTheDocument();
      });
    });

    it('renders the NavBar', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByText('MiniCRM')).toBeInTheDocument();
      });
    });

    it('renders the "New rule" button', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows a loading message while fetching', () => {
      server.use(http.get('/api/v1/automation/rules', () => new Promise(() => {})));
      renderWithProviders(<AutomationRulesPage />);
      expect(screen.getByTestId('rules-loading')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows an error message when the request fails', async () => {
      server.use(
        http.get('/api/v1/automation/rules', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
            { status: 500 },
          ),
        ),
      );
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('rules-error')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows an empty state when there are no rules', async () => {
      server.use(
        http.get('/api/v1/automation/rules', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
        ),
      );
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('rules-empty-state')).toBeInTheDocument();
      });
    });

    it('shows pagination controls even when there are no rules (MINCRM-345)', async () => {
      server.use(
        http.get('/api/v1/automation/rules', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
        ),
      );
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('pagination')).toBeInTheDocument();
      });
    });
  });

  describe('rules list', () => {
    it('renders the rules list when rules exist', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('rules-list')).toBeInTheDocument();
      });
    });

    it('renders a row for the rule with its name', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`rule-name-${AUTOMATION_RULE_1.id}`)).toHaveTextContent(
          AUTOMATION_RULE_1.name,
        );
      });
    });

    it('renders the trigger description for the rule', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`rule-trigger-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });
    });

    it('renders the action description for the rule', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`rule-action-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });
    });

    it('renders a toggle switch for the rule', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`rule-toggle-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });
    });

    it('toggle switch is checked when rule is enabled', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        const toggle = screen.getByTestId(`rule-toggle-${AUTOMATION_RULE_1.id}`);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('toggle switch is unchecked when rule is disabled', async () => {
      const disabledRule = { ...AUTOMATION_RULE_1, enabled: false };
      server.use(
        http.get('/api/v1/automation/rules', () =>
          HttpResponse.json({ data: [disabledRule], total: 1, page: 1, limit: 25 }),
        ),
      );
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        const toggle = screen.getByTestId(`rule-toggle-${disabledRule.id}`);
        expect(toggle).toHaveAttribute('aria-checked', 'false');
      });
    });
  });

  describe('enable/disable toggle', () => {
    it('calls the update endpoint when the toggle is clicked', async () => {
      const user = userEvent.setup();
      let patchCalled = false;

      server.use(
        http.patch('/api/v1/automation/rules/:id', async ({ params, request }) => {
          if (params.id === AUTOMATION_RULE_1.id) {
            patchCalled = true;
            const body = (await request.json()) as { enabled: boolean };
            return HttpResponse.json({
              rule: { ...AUTOMATION_RULE_1, enabled: body.enabled },
            });
          }
          return HttpResponse.json({ rule: AUTOMATION_RULE_1 });
        }),
      );

      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`rule-toggle-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`rule-toggle-${AUTOMATION_RULE_1.id}`));
      expect(patchCalled).toBe(true);
    });
  });

  describe('delete rule', () => {
    it('shows a delete button for each rule', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`delete-rule-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });
    });

    it('shows confirm/cancel buttons after clicking delete', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`delete-rule-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`delete-rule-${AUTOMATION_RULE_1.id}`));

      expect(screen.getByTestId(`confirm-delete-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`cancel-delete-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
    });

    it('dismisses confirm state when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`delete-rule-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`delete-rule-${AUTOMATION_RULE_1.id}`));
      await user.click(screen.getByTestId(`cancel-delete-${AUTOMATION_RULE_1.id}`));

      expect(
        screen.queryByTestId(`confirm-delete-${AUTOMATION_RULE_1.id}`),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId(`delete-rule-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
    });

    it('calls the delete endpoint when confirm delete is clicked', async () => {
      const user = userEvent.setup();
      let deleteCalled = false;

      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`delete-rule-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      // Override handlers after initial load so the list renders first
      server.use(
        http.delete('/api/v1/automation/rules/:id', ({ params }) => {
          if (params.id === AUTOMATION_RULE_1.id) {
            deleteCalled = true;
          }
          return new HttpResponse(null, { status: 204 });
        }),
        http.get('/api/v1/automation/rules', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
        ),
      );

      await user.click(screen.getByTestId(`delete-rule-${AUTOMATION_RULE_1.id}`));
      await user.click(screen.getByTestId(`confirm-delete-${AUTOMATION_RULE_1.id}`));

      expect(deleteCalled).toBe(true);
    });
  });

  describe('create rule form', () => {
    it('shows the create form when "New rule" is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      expect(screen.getByTestId('create-rule-form')).toBeInTheDocument();
    });

    it('hides the "New rule" button when the form is open', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      expect(screen.queryByTestId('new-rule-button')).not.toBeInTheDocument();
    });

    it('closes the form when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      await user.click(screen.getByTestId('create-rule-cancel'));

      expect(screen.queryByTestId('create-rule-form')).not.toBeInTheDocument();
    });

    it('shows a validation error when name is empty', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      await user.click(screen.getByTestId('create-rule-submit'));

      expect(screen.getByTestId('form-error')).toBeInTheDocument();
    });

    it('shows task subject field when action type is create_task', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      // Default action_type is create_task
      expect(screen.getByTestId('task-subject-input')).toBeInTheDocument();
    });

    it('shows notification message field when action type is send_notification', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      await userEvent.selectOptions(screen.getByTestId('action-type-select'), 'send_notification');

      expect(screen.getByTestId('notification-message-input')).toBeInTheDocument();
      expect(screen.queryByTestId('task-subject-input')).not.toBeInTheDocument();
    });

    it('shows the server-log-only hint when action type is send_notification', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      await userEvent.selectOptions(screen.getByTestId('action-type-select'), 'send_notification');

      expect(screen.getByTestId('send-notification-hint')).toBeInTheDocument();
    });

    it('does not show the server-log-only hint when action type is create_task', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      // Default action_type is create_task

      expect(screen.queryByTestId('send-notification-hint')).not.toBeInTheDocument();
    });

    it('shows stage selector when trigger type is deal_stage_changed', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      await userEvent.selectOptions(
        screen.getByTestId('trigger-type-select'),
        'deal_stage_changed',
      );

      expect(screen.getByTestId('trigger-stage-select')).toBeInTheDocument();
    });

    it('hides stage selector for non-stage-change triggers', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      // Default is deal_created — no stage selector
      expect(screen.queryByTestId('trigger-stage-select')).not.toBeInTheDocument();
    });

    it('shows specific user dropdown when assignee_type is specific', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      await userEvent.selectOptions(screen.getByTestId('assignee-type-select'), 'specific');

      expect(screen.getByTestId('assignee-user-select')).toBeInTheDocument();
    });

    it('submits the form with valid data and calls the create endpoint', async () => {
      const user = userEvent.setup();
      let postCalled = false;

      server.use(
        http.post('/api/v1/automation/rules', async () => {
          postCalled = true;
          return HttpResponse.json({ rule: AUTOMATION_RULE_1 }, { status: 201 });
        }),
      );

      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      await user.type(screen.getByTestId('rule-name-input'), 'My Test Rule');
      await user.type(screen.getByTestId('task-subject-input'), 'Follow up');
      await user.click(screen.getByTestId('create-rule-submit'));

      await waitFor(() => {
        expect(postCalled).toBe(true);
      });
    });

    it('closes the form after successful submission', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('new-rule-button')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('new-rule-button'));
      await user.type(screen.getByTestId('rule-name-input'), 'My Test Rule');
      await user.type(screen.getByTestId('task-subject-input'), 'Follow up');
      await user.click(screen.getByTestId('create-rule-submit'));

      await waitFor(() => {
        expect(screen.queryByTestId('create-rule-form')).not.toBeInTheDocument();
      });
    });
  });

  describe('execution logs drawer', () => {
    it('opens the logs drawer when "View logs" is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));
      expect(screen.getByTestId('logs-drawer')).toBeInTheDocument();
    });

    it('shows the rule name in the logs drawer header', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));
      expect(screen.getByTestId('logs-drawer-rule-name')).toHaveTextContent(AUTOMATION_RULE_1.name);
    });

    it('renders log entries after loading', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));

      await waitFor(() => {
        expect(screen.getByTestId('logs-list')).toBeInTheDocument();
        expect(screen.getByTestId(`log-row-${AUTOMATION_LOG_1.id}`)).toBeInTheDocument();
      });
    });

    it('shows the outcome badge for each log', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));

      await waitFor(() => {
        const outcomeBadge = screen.getByTestId(`log-outcome-${AUTOMATION_LOG_1.id}`);
        expect(outcomeBadge).toBeInTheDocument();
      });
    });

    it('shows empty state when there are no logs', async () => {
      const user = userEvent.setup();
      server.use(
        http.get('/api/v1/automation/rules/:id/logs', () => HttpResponse.json({ logs: [] })),
      );
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));

      await waitFor(() => {
        expect(screen.getByTestId('logs-empty')).toBeInTheDocument();
      });
    });

    it('closes the logs drawer when the close button is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));
      expect(screen.getByTestId('logs-drawer')).toBeInTheDocument();

      await user.click(screen.getByTestId('logs-drawer-close'));
      expect(screen.queryByTestId('logs-drawer')).not.toBeInTheDocument();
    });

    it('closes the logs drawer when the overlay is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));
      expect(screen.getByTestId('logs-drawer')).toBeInTheDocument();

      await user.click(screen.getByTestId('logs-drawer-overlay'));
      expect(screen.queryByTestId('logs-drawer')).not.toBeInTheDocument();
    });
  });

  describe('execution logs drawer — locale timestamp (MINCRM-114)', () => {
    it('renders the log timestamp formatted with the active locale', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));

      const expectedText = new Date(AUTOMATION_LOG_1.triggered_at).toLocaleString('en');
      await waitFor(() => {
        expect(screen.getByTestId(`log-timestamp-${AUTOMATION_LOG_1.id}`)).toHaveTextContent(
          expectedText,
        );
      });
    });
  });

  describe('execution logs drawer — Escape key (MINCRM-109)', () => {
    it('closes the drawer when Escape is pressed', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));
      expect(screen.getByTestId('logs-drawer')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByTestId('logs-drawer')).not.toBeInTheDocument();
    });
  });

  describe('nav link visibility', () => {
    it('shows the Automation nav link for admin users', async () => {
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId('nav-top-automation')).toBeInTheDocument();
      });
    });
  });

  describe('execution logs drawer — focus trap (MINCRM-280)', () => {
    it('moves focus to the close button when the drawer opens', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));

      await waitFor(() => {
        expect(screen.getByTestId('logs-drawer-close')).toHaveFocus();
      });
    });

    it('returns focus to the trigger button when the drawer closes', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      const triggerButton = screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`);
      await user.click(triggerButton);
      await waitFor(() => {
        expect(screen.getByTestId('logs-drawer-close')).toHaveFocus();
      });

      await user.click(screen.getByTestId('logs-drawer-close'));

      await waitFor(() => {
        expect(triggerButton).toHaveFocus();
      });
    });

    it('wraps Tab from the last focusable element back to the first', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));
      await waitFor(() => {
        expect(screen.getByTestId('logs-drawer-close')).toHaveFocus();
      });

      // The close button is the only focusable element; Tab should wrap back to it
      await user.tab();
      expect(screen.getByTestId('logs-drawer-close')).toHaveFocus();
    });

    it('wraps Shift+Tab from the first focusable element back to the last', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AutomationRulesPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`view-logs-${AUTOMATION_RULE_1.id}`));
      await waitFor(() => {
        expect(screen.getByTestId('logs-drawer-close')).toHaveFocus();
      });

      // Shift+Tab from the only focusable element should wrap back to it
      await user.tab({ shift: true });
      expect(screen.getByTestId('logs-drawer-close')).toHaveFocus();
    });
  });
});
