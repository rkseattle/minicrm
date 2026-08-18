/**
 * Renders a single account as a summary row in the NLI result block.
 */
import { Link } from 'react-router-dom';

interface AccountCardData {
  id: string;
  name: string;
  account_type?: string | null;
  industry?: string | null;
  website?: string | null;
}

interface AccountResultCardProps {
  account: AccountCardData;
}

export default function AccountResultCard({ account }: AccountResultCardProps) {
  return (
    <div
      className="flex items-center gap-3 py-2 px-3 rounded-lg border border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors"
      data-testid={`nli-account-card-${account.id}`}
    >
      <div className="min-w-0 flex-1">
        <Link
          to={`/accounts/${account.id}`}
          className="text-sm font-medium text-primary-600 hover:underline truncate block"
          data-testid={`nli-account-card-link-${account.id}`}
        >
          {account.name}
        </Link>
        <div className="flex gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
          {account.account_type && <span>{account.account_type}</span>}
          {account.industry && <span>· {account.industry}</span>}
        </div>
      </div>
    </div>
  );
}
