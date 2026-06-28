/**
 * Renders a single note as a timeline item in the NLI result block. (MINCRM-431)
 */
import { useTranslation } from 'react-i18next';

interface NoteCardData {
  id: string;
  content?: string | null;
  entity_type?: string | null;
  entity_name?: string | null;
  created_at?: string | null;
  author_name?: string | null;
}

interface NoteResultCardProps {
  note: NoteCardData;
}

export default function NoteResultCard({ note }: NoteResultCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-start gap-3 py-2 px-3 rounded-lg border border-gray-100 bg-gray-50"
      data-testid={`nli-note-card-${note.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
          {note.entity_name && <span className="font-medium">{note.entity_name}</span>}
          {note.author_name && <span>· {note.author_name}</span>}
        </div>
        <p className="text-sm text-gray-800 break-words line-clamp-3">
          {note.content ?? t('ai.results.noContent')}
        </p>
      </div>
      {note.created_at && (
        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
          {note.created_at.slice(0, 10)}
        </span>
      )}
    </div>
  );
}
