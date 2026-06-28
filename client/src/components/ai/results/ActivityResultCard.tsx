/**
 * Renders a single activity as a timeline item in the NLI result block. (MINCRM-431)
 */
import { useTranslation } from 'react-i18next';

interface ActivityCardData {
  id: string;
  type?: string | null;
  subject?: string | null;
  notes?: string | null;
  activity_date?: string | null;
  contact_name?: string | null;
}

interface ActivityResultCardProps {
  activity: ActivityCardData;
}

export default function ActivityResultCard({ activity }: ActivityResultCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-start gap-3 py-2 px-3 rounded-lg border border-gray-100 bg-gray-50"
      data-testid={`nli-activity-card-${activity.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {activity.type && (
            <span className="text-xs font-medium text-gray-600 bg-gray-200 rounded px-1.5 py-0.5">
              {activity.type}
            </span>
          )}
          <span className="text-sm text-gray-800 truncate">
            {activity.subject ?? t('ai.results.noSubject')}
          </span>
        </div>
        {activity.contact_name && (
          <p className="text-xs text-gray-500 mt-0.5">{activity.contact_name}</p>
        )}
        {activity.notes && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{activity.notes}</p>
        )}
      </div>
      {activity.activity_date && (
        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
          {activity.activity_date.slice(0, 10)}
        </span>
      )}
    </div>
  );
}
