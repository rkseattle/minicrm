/**
 * FollowUpTimingCard component. (MINCRM-470)
 *
 * Displays the AI-suggested best day/time to follow up with a contact
 * ("Best time to reach Sarah: Tuesday mornings") and a "Schedule follow-up"
 * shortcut that opens an inline, pre-populated Task creation form — editable
 * before saving, per the ticket's AC. Renders nothing when there is
 * insufficient interaction history (the suggestion is null).
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import ActivityForm from '@/components/ActivityForm.js';
import type { ActivityFormValues } from '@/components/ActivityForm.js';
import { createActivity, ACTIVITIES_QUERY_KEY } from '@/api/activities.js';
import { resolveApiError } from '@/utils/apiError.js';
import { formatHourOfDay } from '@/utils/formatHourOfDay.js';
import type { FollowUpTimingSuggestion } from '@shared/schemas/followUpTimingSchema.js';

interface FollowUpTimingCardProps {
  contactId: string;
  contactName: string;
  suggestion: FollowUpTimingSuggestion;
}

/**
 * Finds the next calendar date (today or later) that falls on the given
 * day-of-week, formatted as YYYY-MM-DD for the activity due_date field.
 *
 * `dayOfWeek` is expressed in `timezone` (the org's default display timezone,
 * per suggestion.timezone) — "today" must be computed in that same timezone,
 * not the browser's local timezone, or a suggestion near a UTC day boundary
 * can resolve to the wrong calendar date when the two timezones disagree on
 * what day it currently is.
 */
function nextDateForDayOfWeek(dayOfWeek: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayDay = WEEKDAYS.indexOf(weekdayStr);
  const daysUntil = (dayOfWeek - (todayDay >= 0 ? todayDay : 0) + 7) % 7;

  // today's date at UTC midnight, used purely as a calendar-arithmetic anchor —
  // adding daysUntil and reading back the UTC calendar fields is timezone-safe.
  const anchor = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + daysUntil));
  return anchor.toISOString().slice(0, 10);
}

export default function FollowUpTimingCard({
  contactId,
  contactName,
  suggestion,
}: FollowUpTimingCardProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const dayLabel = t(`followUpTiming.day.${suggestion.day_of_week}`);
  const timeRange = `${formatHourOfDay(suggestion.hour_start, i18n.language)}–${formatHourOfDay(suggestion.hour_end, i18n.language)}`;

  const scheduleMutation = useMutation({
    mutationFn: (values: ActivityFormValues) =>
      createActivity({
        type: values.type,
        subject: values.subject,
        notes: values.notes || undefined,
        due_date: values.due_date || undefined,
        contact_id: contactId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACTIVITIES_QUERY_KEY });
      setIsScheduling(false);
      setScheduleError(null);
    },
    onError: (error: unknown) => {
      setScheduleError(resolveApiError(error as Parameters<typeof resolveApiError>[0], t));
    },
  });

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-4"
      data-testid={`followup-timing-card-${contactId}`}
    >
      <p className="text-sm text-gray-900" data-testid={`followup-timing-suggestion-${contactId}`}>
        {t('followUpTiming.suggestion', { name: contactName, day: dayLabel, timeRange })}
      </p>
      <p className="mt-1 text-xs text-gray-500">{t('followUpTiming.aiInferredLabel')}</p>

      {!isScheduling && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          data-testid={`followup-timing-schedule-${contactId}`}
          onClick={() => setIsScheduling(true)}
        >
          {t('followUpTiming.scheduleButton')}
        </Button>
      )}

      {isScheduling && (
        <div className="mt-3" data-testid={`followup-timing-schedule-form-${contactId}`}>
          <ActivityForm
            initialValues={{
              type: 'Task',
              subject: t('followUpTiming.suggestion', {
                name: contactName,
                day: dayLabel,
                timeRange,
              }),
              due_date: nextDateForDayOfWeek(suggestion.day_of_week, suggestion.timezone),
            }}
            onSubmit={(values) => scheduleMutation.mutate(values)}
            onCancel={() => {
              setIsScheduling(false);
              setScheduleError(null);
            }}
            isSubmitting={scheduleMutation.isPending}
            submitLabel={t('activities.save')}
            error={scheduleError ?? undefined}
          />
        </div>
      )}
    </div>
  );
}
