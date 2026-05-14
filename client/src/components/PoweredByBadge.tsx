/**
 * PoweredByBadge — shown in the nav when custom branding is active. (MINCRM-356)
 * Standard white-label attribution practice (Shopify storefronts, Intercom widget).
 */

import { useTranslation } from 'react-i18next';

export default function PoweredByBadge() {
  const { t } = useTranslation();
  return (
    <a
      href="https://minicrm.app"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('nav.poweredByMiniCRM')}
      data-testid="powered-by-badge"
      className="hidden lg:flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 select-none"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-3.5 h-3.5 text-primary-400"
        aria-hidden="true"
      >
        <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm0 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2z" />
      </svg>
      <span>{t('nav.poweredByMiniCRM')}</span>
    </a>
  );
}
