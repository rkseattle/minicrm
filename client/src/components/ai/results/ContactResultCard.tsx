/**
 * Renders a single contact as a summary card in the NLI result block.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import TagBadge from '@/components/TagBadge.js';

interface ContactCardData {
  id: string;
  first_name: string;
  last_name: string | null;
  email?: string | null;
  title?: string | null;
  account_name?: string | null;
  tags?: Array<{ id: string; name: string }>;
  last_activity_at?: string | null;
}

interface ContactResultCardProps {
  contact: ContactCardData;
}

export default function ContactResultCard({ contact }: ContactResultCardProps) {
  const { t } = useTranslation();
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');

  return (
    <div
      className="flex items-start gap-3 py-2 px-3 rounded-lg border border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors"
      data-testid={`nli-contact-card-${contact.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/contacts/${contact.id}`}
            className="text-sm font-medium text-primary-600 hover:underline truncate"
            data-testid={`nli-contact-card-link-${contact.id}`}
          >
            {fullName}
          </Link>
          {contact.tags?.map((tag) => (
            <TagBadge key={tag.id} tag={tag} />
          ))}
        </div>
        {contact.title && <p className="text-xs text-gray-500 truncate mt-0.5">{contact.title}</p>}
        {contact.account_name && (
          <p className="text-xs text-gray-500 truncate">{contact.account_name}</p>
        )}
        {contact.email && <p className="text-xs text-gray-400 truncate">{contact.email}</p>}
      </div>
      {contact.last_activity_at && (
        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
          {t('ai.results.lastActivity', { date: contact.last_activity_at.slice(0, 10) })}
        </span>
      )}
    </div>
  );
}
