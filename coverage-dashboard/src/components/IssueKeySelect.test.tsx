import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import IssueKeySelect from './IssueKeySelect.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';

describe('IssueKeySelect', () => {
  it('renders nothing when commitSha is empty', () => {
    renderWithProviders(
      <IssueKeySelect
        id="x"
        label="Issues"
        testId="issue-select"
        commitSha=""
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('issue-select')).not.toBeInTheDocument();
  });

  it('shows a loading state while issue keys are being fetched', () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/issue-keys', () => new Promise(() => {})),
    );
    renderWithProviders(
      <IssueKeySelect
        id="x"
        label="Issues"
        testId="issue-select"
        commitSha="abc123"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('issue-select-loading')).toBeInTheDocument();
  });

  it('renders nothing when the commit has no recorded issue keys', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/issue-keys', () =>
        HttpResponse.json({ issueKeys: [] }),
      ),
    );
    renderWithProviders(
      <IssueKeySelect
        id="x"
        label="Issues"
        testId="issue-select"
        commitSha="abc123"
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByTestId('issue-select-loading')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('issue-select')).not.toBeInTheDocument();
  });

  it('calls onSelect with the chosen issue key', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/issue-keys', () =>
        HttpResponse.json({ issueKeys: ['MINCRM-1', 'MINCRM-2'] }),
      ),
    );
    const onSelect = vi.fn();
    renderWithProviders(
      <IssueKeySelect
        id="x"
        label="Issues"
        testId="issue-select"
        commitSha="abc123"
        onSelect={onSelect}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('issue-select')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByTestId('issue-select'), 'MINCRM-2');

    expect(onSelect).toHaveBeenCalledWith('MINCRM-2');
  });
});
