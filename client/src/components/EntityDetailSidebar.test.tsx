import { screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import EntityDetailSidebar from './EntityDetailSidebar.js';

// Mock sub-components so tests focus on EntityDetailSidebar's own logic.
vi.mock('@/hooks/useAuth.js', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'admin', name: 'Admin' } }),
}));
vi.mock('@/components/ActivityTimeline.js', () => ({
  default: ({ contactId, accountId, dealId }: Record<string, unknown>) => (
    <div data-testid="activity-timeline">{String(contactId ?? accountId ?? dealId)}</div>
  ),
}));
vi.mock('@/components/AttachmentsSection.js', () => ({
  default: ({ recordType }: { recordType: string }) => (
    <div data-testid="attachments-section">{recordType}</div>
  ),
}));
vi.mock('@/components/NotesSection.js', () => ({
  default: ({ entityType }: { entityType: string }) => (
    <div data-testid="notes-section">{entityType}</div>
  ),
}));
vi.mock('@/components/ChangeHistory.js', () => ({
  default: ({ recordType }: { recordType: string }) => (
    <div data-testid="change-history">{recordType}</div>
  ),
}));
vi.mock('@/components/TagInput.js', () => ({
  ConnectedTagInput: ({ entityType }: { entityType: string }) => (
    <div data-testid="tag-input">{entityType}</div>
  ),
}));
vi.mock('@/components/GdprPrivacySection.js', () => ({
  default: () => <div data-testid="gdpr-section" />,
}));

const BASE_PROPS = {
  entityType: 'contact' as const,
  entityId: 'entity-123',
  entityQueryKey: ['contacts', 'entity-123'] as const,
  isEditing: false,
};

describe('EntityDetailSidebar', () => {
  it('renders nothing while isEditing is true', () => {
    const { container } = renderWithProviders(
      <EntityDetailSidebar {...BASE_PROPS} isEditing={true} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders all default sections for a contact', () => {
    renderWithProviders(<EntityDetailSidebar {...BASE_PROPS} />);

    expect(screen.getByTestId('contact-tags-section')).toBeInTheDocument();
    expect(screen.getByTestId('activity-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('attachments-section')).toBeInTheDocument();
    expect(screen.getByTestId('notes-section')).toBeInTheDocument();
    expect(screen.getByTestId('change-history')).toBeInTheDocument();
  });

  it('renders GDPR section only when showGdpr=true and user is admin', () => {
    renderWithProviders(
      <EntityDetailSidebar {...BASE_PROPS} showGdpr={true} onGdprErased={vi.fn()} />,
    );
    expect(screen.getByTestId('gdpr-section')).toBeInTheDocument();
  });

  it('does not render GDPR section when showGdpr is false', () => {
    renderWithProviders(<EntityDetailSidebar {...BASE_PROPS} showGdpr={false} />);
    expect(screen.queryByTestId('gdpr-section')).not.toBeInTheDocument();
  });

  it('hides tags, timeline, attachments, and changeHistory when all show* flags are false', () => {
    renderWithProviders(
      <EntityDetailSidebar
        {...BASE_PROPS}
        entityType="lead"
        showTags={false}
        showTimeline={false}
        showAttachments={false}
        showChangeHistory={false}
      />,
    );
    expect(screen.queryByTestId('contact-tags-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-timeline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('attachments-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('change-history')).not.toBeInTheDocument();
    // Notes are always shown
    expect(screen.getByTestId('notes-section')).toBeInTheDocument();
  });

  it('renders children after shared sections', () => {
    renderWithProviders(
      <EntityDetailSidebar {...BASE_PROPS}>
        <div data-testid="custom-child">extra</div>
      </EntityDetailSidebar>,
    );
    expect(screen.getByTestId('custom-child')).toBeInTheDocument();
  });

  it('passes accountId to ActivityTimeline for account entity type', () => {
    renderWithProviders(
      <EntityDetailSidebar
        {...BASE_PROPS}
        entityType="account"
        entityQueryKey={['accounts', 'entity-123']}
      />,
    );
    expect(screen.getByTestId('activity-timeline')).toHaveTextContent('entity-123');
  });

  it('uses entity-specific data-testid for tags section', () => {
    renderWithProviders(
      <EntityDetailSidebar
        {...BASE_PROPS}
        entityType="deal"
        entityQueryKey={['deals', 'entity-123']}
      />,
    );
    expect(screen.getByTestId('deal-tags-section')).toBeInTheDocument();
  });
});
