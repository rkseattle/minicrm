/**
 * ActivityForm component.
 * Used for both creating and editing activities.
 * When a due date is set and type has not been manually overridden,
 * the type defaults to "Task"; otherwise it defaults to "Note".
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Button } from '@/components/ui/Button.js';
import { ACTIVITY_TYPES, ACTIVITY_DIRECTIONS } from '@shared/schemas/activitySchema.js';
import type { ActivityType, ActivityDirection } from '@shared/schemas/activitySchema.js';

/** Values managed by the activity form */
export interface ActivityFormValues {
  type: ActivityType;
  subject: string;
  notes: string;
  due_date: string;
  direction: ActivityDirection | '';
  outcome: string;
}

export interface ActivityFormProps {
  /** Pre-populated values for edit mode; omit for create mode */
  initialValues?: Partial<ActivityFormValues>;
  /** Called when the form is submitted with valid values */
  onSubmit: (values: ActivityFormValues) => void;
  /** Called when the user cancels */
  onCancel: () => void;
  /** Disables the submit button while a mutation is in-flight */
  isSubmitting: boolean;
  /** Label for the submit button */
  submitLabel: string;
  /** Server-side error message to display below the form */
  error?: string;
}

/** Map of activity type values to their i18n key suffixes. Exported for use in ActivityTimeline. */
export const TYPE_KEY_MAP: Record<ActivityType, string> = {
  Note: 'typeNote',
  Call: 'typeCall',
  Email: 'typeEmail',
  Meeting: 'typeMeeting',
  Task: 'typeTask',
};

/**
 * Derives the default activity type from the presence of a due date.
 *
 * @param dueDate - The current due_date field value
 * @returns 'Task' if due date is set, 'Note' otherwise
 */
function defaultTypeForDueDate(dueDate: string): ActivityType {
  return dueDate ? 'Task' : 'Note';
}

/**
 * Form for creating or editing an activity.
 */
export default function ActivityForm({
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel,
  error,
}: ActivityFormProps) {
  const { t } = useTranslation();

  // When the user has not explicitly chosen a type, the effective type is derived from due_date.
  // manualType holds the user's explicit choice; null means "use the auto-derived default".
  const [manualType, setManualType] = useState<ActivityType | null>(initialValues?.type ?? null);
  const [subject, setSubject] = useState(initialValues?.subject ?? '');
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [dueDate, setDueDate] = useState(initialValues?.due_date ?? '');
  const [direction, setDirection] = useState<ActivityDirection | ''>(
    initialValues?.direction ?? '',
  );
  const [outcome, setOutcome] = useState(initialValues?.outcome ?? '');

  // Derive the current type without synchronizing state in an effect
  const type: ActivityType = manualType ?? defaultTypeForDueDate(dueDate);

  /** Whether the selected type requires direction (Call or Email) */
  const isCommunicationType = type === 'Call' || type === 'Email';

  const handleTypeChange = (value: ActivityType): void => {
    setManualType(value);
    // Clear direction when switching away from a communication type
    if (value !== 'Call' && value !== 'Email') {
      setDirection('');
      setOutcome('');
    }
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    onSubmit({ type, subject, notes, due_date: dueDate, direction, outcome });
  };

  return (
    <form onSubmit={handleSubmit} noValidate data-testid="activity-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Type */}
        <div>
          <label htmlFor="activity-type" className="block text-xs font-medium text-gray-700 mb-1">
            {t('activities.typeLabel')}
          </label>
          <Select
            id="activity-type"
            data-testid="activity-type-select"
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as ActivityType)}
          >
            {ACTIVITY_TYPES.map((actType) => (
              <option key={actType} value={actType}>
                {t(`activities.${TYPE_KEY_MAP[actType]}`)}
              </option>
            ))}
          </Select>
        </div>

        {/* Due date */}
        <div>
          <label
            htmlFor="activity-due-date"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            {t('activities.dueDateLabel')}
          </label>
          <Input
            id="activity-due-date"
            type="date"
            data-testid="activity-due-date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>

      {/* Direction + Outcome — shown only for Call and Email types */}
      {isCommunicationType && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label
              htmlFor="activity-direction"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              {t('activities.directionLabel')} <span aria-hidden="true">*</span>
            </label>
            <Select
              id="activity-direction"
              data-testid="activity-direction-select"
              value={direction}
              onChange={(e) => setDirection(e.target.value as ActivityDirection | '')}
              required
            >
              <option value="">— {t('activities.directionLabel')} —</option>
              {ACTIVITY_DIRECTIONS.map((dir) => (
                <option key={dir} value={dir}>
                  {t(`activities.direction${dir}`)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              htmlFor="activity-outcome"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              {t('activities.outcomeLabel')}
            </label>
            <Input
              id="activity-outcome"
              type="text"
              data-testid="activity-outcome"
              placeholder={t('activities.outcomePlaceholder')}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Subject */}
      <div className="mt-4">
        <label htmlFor="activity-subject" className="block text-xs font-medium text-gray-700 mb-1">
          {t('activities.subjectLabel')}
        </label>
        <Input
          id="activity-subject"
          type="text"
          data-testid="activity-subject"
          placeholder={t('activities.subjectPlaceholder')}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
      </div>

      {/* Notes */}
      <div className="mt-4">
        <label htmlFor="activity-notes" className="block text-xs font-medium text-gray-700 mb-1">
          {t('activities.notesLabel')}
        </label>
        <textarea
          id="activity-notes"
          data-testid="activity-notes"
          placeholder={t('activities.notesPlaceholder')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900
                     placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500
                     focus:border-primary-500 resize-none"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600" data-testid="activity-form-error">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          data-testid="activity-form-submit"
          disabled={isSubmitting || !subject.trim() || (isCommunicationType && !direction)}
          className="min-h-[44px] sm:min-h-0"
        >
          {isSubmitting ? t('activities.saving') : submitLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="activity-form-cancel"
          onClick={onCancel}
          disabled={isSubmitting}
          className="min-h-[44px] sm:min-h-0"
        >
          {t('activities.cancel')}
        </Button>
      </div>
    </form>
  );
}
