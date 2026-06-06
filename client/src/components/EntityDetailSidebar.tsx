/**
 * EntityDetailSidebar — shared sidebar sections for entity detail pages.
 * Renders tags, activity timeline, attachments, notes, change history,
 * and optionally GDPR & privacy controls. (MINCRM-405)
 *
 * Each section is guarded by isEditing so nothing renders while the edit
 * form is open. The children slot accepts entity-specific sections
 * (e.g. linked deals, linked contacts) that follow the shared sections.
 */

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import ActivityTimeline from '@/components/ActivityTimeline.js';
import AttachmentsSection from '@/components/AttachmentsSection.js';
import NotesSection from '@/components/NotesSection.js';
import ChangeHistory from '@/components/ChangeHistory.js';
import { ConnectedTagInput } from '@/components/TagInput.js';
import GdprPrivacySection from '@/components/GdprPrivacySection.js';

type SupportedEntityType = 'contact' | 'account' | 'deal' | 'lead';

// ConnectedTagInput and ChangeHistory don't support 'lead' — callers must pass
// showTags={false} / showChangeHistory={false} for lead entities.
type TagEntityType = 'contact' | 'account' | 'deal';
type ChangeHistoryEntityType = 'contact' | 'account' | 'deal';

// ActivityTimeline accepts individual id props; derive the right one from entityType.
type ActivityTimelineEntityProp =
  | { contactId: string }
  | { accountId: string }
  | { dealId: string };

function resolveTimelineProp(
  entityType: SupportedEntityType,
  entityId: string,
): ActivityTimelineEntityProp {
  if (entityType === 'contact') return { contactId: entityId };
  if (entityType === 'account') return { accountId: entityId };
  // deal falls through; lead is guarded by showTimeline=false at call site
  return { dealId: entityId };
}

interface EntityDetailSidebarProps {
  entityType: SupportedEntityType;
  entityId: string;
  entityQueryKey: readonly unknown[];
  isEditing: boolean;
  /** Show the tags section (default: true). Must be false for lead — ConnectedTagInput does not support lead. */
  showTags?: boolean;
  /** Show the activity timeline section (default: true) */
  showTimeline?: boolean;
  /** Show the attachments section (default: true) */
  showAttachments?: boolean;
  /** Show the change history section (default: true). Must be false for lead — ChangeHistory does not support lead. */
  showChangeHistory?: boolean;
  /** When true and the current user is admin, renders GdprPrivacySection */
  showGdpr?: boolean;
  /** Called after a successful GDPR erasure so the parent can refresh its data */
  onGdprErased?: () => void;
  /** Entity-specific sections rendered after the shared sections */
  children?: React.ReactNode;
}

export default function EntityDetailSidebar({
  entityType,
  entityId,
  entityQueryKey,
  isEditing,
  showTags = true,
  showTimeline = true,
  showAttachments = true,
  showChangeHistory = true,
  showGdpr = false,
  onGdprErased,
  children,
}: EntityDetailSidebarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { enabled: tagsEnabled, isLoading: tagsLoading } = useFeatureFlag('tags');
  const { enabled: activitiesEnabled, isLoading: activitiesLoading } = useFeatureFlag('activities');
  const { enabled: notesEnabled, isLoading: notesLoading } = useFeatureFlag('notes');

  if (isEditing) return null;

  const timelineProp = resolveTimelineProp(entityType, entityId);

  return (
    <>
      {/* Tags (MINCRM-186) — not supported for lead */}
      {showTags && tagsLoading && (
        <div className="mt-8 h-20 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
      )}
      {showTags && !tagsLoading && tagsEnabled && (
        <section
          className="mt-8"
          aria-labelledby={`${entityType}-tags-heading`}
          data-testid={`${entityType}-tags-section`}
        >
          <h2
            id={`${entityType}-tags-heading`}
            className="text-sm font-semibold text-gray-900 mb-3"
            data-testid={`${entityType}-tags-heading`}
          >
            {t('tags.sectionTitle')}
          </h2>
          <ConnectedTagInput
            entityId={entityId}
            entityType={entityType as TagEntityType}
            entityQueryKey={entityQueryKey}
          />
        </section>
      )}

      {/* Activity timeline */}
      {showTimeline && activitiesLoading && (
        <div className="mt-8 h-32 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
      )}
      {showTimeline && !activitiesLoading && activitiesEnabled && (
        <ActivityTimeline {...timelineProp} />
      )}

      {/* Attachments (MINCRM-167) */}
      {showAttachments && <AttachmentsSection recordType={entityType} recordId={entityId} />}

      {/* Notes (MINCRM-352) */}
      {notesLoading && (
        <div className="mt-8 h-24 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
      )}
      {!notesLoading && notesEnabled && (
        <NotesSection entityType={entityType} entityId={entityId} />
      )}

      {/* Change history (MINCRM-171) — not supported for lead */}
      {showChangeHistory && (
        <ChangeHistory recordType={entityType as ChangeHistoryEntityType} recordId={entityId} />
      )}

      {/* GDPR & Privacy (MINCRM-364) — admin only */}
      {showGdpr && user?.role === 'admin' && onGdprErased && (
        <GdprPrivacySection
          recordType={entityType as 'contact' | 'lead'}
          recordId={entityId}
          onErased={onGdprErased}
        />
      )}

      {children}
    </>
  );
}
