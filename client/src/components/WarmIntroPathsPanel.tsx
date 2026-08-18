/**
 * WarmIntroPathsPanel component.
 *
 * "Find warm path" action + results panel showing ranked introduction paths
 * (Rep -> Known Contact -> Target Contact) through the rep's own contact
 * network. Query fires only when the rep clicks the button (click-to-reveal,
 * matching ObjectionInsights' shape) — not eagerly on page load, since
 * traversal is more expensive than a passive badge read.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { getWarmIntroPaths, warmIntroPathsQueryKey } from '@/api/warmIntro.js';

interface WarmIntroPathsPanelProps {
  contactId: string;
}

export default function WarmIntroPathsPanel({ contactId }: WarmIntroPathsPanelProps) {
  const { t } = useTranslation();
  const [showPaths, setShowPaths] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: warmIntroPathsQueryKey(contactId),
    queryFn: () => getWarmIntroPaths(contactId),
    enabled: showPaths,
  });

  return (
    <div data-testid={`warm-intro-paths-${contactId}`}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-testid={`find-warm-path-${contactId}`}
        onClick={() => setShowPaths(true)}
      >
        {t('warmIntro.findWarmPathButton')}
      </Button>

      {showPaths && (
        <div className="mt-3" data-testid={`warm-intro-paths-results-${contactId}`}>
          {isLoading && (
            <p className="text-sm text-gray-500" data-testid="warm-intro-loading">
              {t('warmIntro.loading')}
            </p>
          )}
          {isError && (
            <p role="alert" className="text-sm text-red-600" data-testid="warm-intro-error">
              {t('warmIntro.loadFailed')}
            </p>
          )}
          {data && data.paths.length === 0 && (
            <p className="text-sm text-gray-500" data-testid="warm-intro-empty">
              {t('warmIntro.noPathsFound')}
            </p>
          )}
          {data && data.paths.length > 0 && (
            <ul className="space-y-3" data-testid="warm-intro-path-list">
              {data.paths.map((path, index) => (
                <li
                  key={path.links.map((l) => l.contact_id).join('-')}
                  className="rounded-md border border-gray-200 p-3"
                  data-testid={`warm-intro-path-${index}`}
                >
                  <p className="text-sm font-medium text-gray-900">
                    {t('warmIntro.pathLabel', {
                      known: `${path.links[0].first_name} ${path.links[0].last_name}`,
                      target: `${path.links[1].first_name} ${path.links[1].last_name}`,
                    })}
                  </p>
                  {path.links[0].title && (
                    <p className="text-xs text-gray-500">{path.links[0].title}</p>
                  )}
                  <p className="mt-2 text-sm text-gray-700">
                    {path.suggested_introduction_message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
