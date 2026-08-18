/**
 * SubPageNav — adaptive sub-page navigation chrome.
 *
 * Renders navigation items in one of three modes based on viewport and nav layout:
 *   - Mobile (isMobile): native <select> picker
 *   - Desktop + left sidebar nav: horizontal scrollable tab bar (avoids double sidebar)
 *   - Desktop + top/hamburger nav: vertical tab list on the left
 *
 * The parent is responsible for rendering the active panel content;
 * SubPageNav renders only the navigation chrome.
 */

import { useBreakpoint } from '@/context/BreakpointContext.js';
import { useNavLayout } from '@/components/NavLayoutContext.js';

export interface SubPageNavItem {
  key: string;
  label: string;
  disabled?: boolean;
  'data-testid'?: string;
}

interface SubPageNavProps {
  items: SubPageNavItem[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Accessible label for the nav region (e.g. page title) */
  ariaLabel: string;
  /** data-testid for the wrapping tab list / select element */
  'data-testid'?: string;
  /** Prefix used to build per-item testids: `{itemTestidPrefix}-{item.key}` */
  itemTestidPrefix?: string;
  /** Prefix used to build panel testids: `{panelTestidPrefix}-{key}` */
  panelTestidPrefix?: string;
}

export default function SubPageNav({
  items,
  activeKey,
  onChange,
  ariaLabel,
  'data-testid': listTestId,
  itemTestidPrefix,
  panelTestidPrefix,
}: SubPageNavProps) {
  const { isMobile } = useBreakpoint();
  const { layout: navLayout } = useNavLayout();

  // Desktop + left sidebar → horizontal tab bar (avoids a second left-side list).
  // Desktop + top/hamburger → vertical tab list beside content.
  // Mobile → native <select> picker (single line, OS-native scroll wheel).
  const useHorizontalTabs = !isMobile && navLayout === 'left';
  const useVerticalTabs = !isMobile && navLayout !== 'left';

  function itemTestId(item: SubPageNavItem): string | undefined {
    if (item['data-testid']) return item['data-testid'];
    if (itemTestidPrefix) return `${itemTestidPrefix}-${item.key}`;
    return undefined;
  }

  if (isMobile) {
    return (
      <div className="mb-6" data-testid={listTestId}>
        <select
          value={activeKey}
          onChange={(e) => {
            if (e.target.value !== activeKey) onChange(e.target.value);
          }}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          aria-label={ariaLabel}
          data-testid={listTestId ? `${listTestId}-select` : undefined}
        >
          {items.map((item) => (
            <option
              key={item.key}
              value={item.key}
              disabled={item.disabled}
              data-testid={itemTestId(item)}
            >
              {item.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (useHorizontalTabs) {
    return (
      <div
        className="flex overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-6"
        role="tablist"
        aria-label={ariaLabel}
        data-testid={listTestId}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={activeKey === item.key}
            aria-disabled={item.disabled}
            aria-controls={panelTestidPrefix ? `${panelTestidPrefix}-${item.key}` : undefined}
            id={itemTestidPrefix ? `${itemTestidPrefix}-${item.key}` : undefined}
            data-testid={itemTestId(item)}
            disabled={item.disabled}
            onClick={() => {
              if (item.key !== activeKey && !item.disabled) onChange(item.key);
            }}
            className={[
              'px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500',
              item.disabled
                ? 'border-transparent text-gray-300 cursor-not-allowed'
                : activeKey === item.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  if (useVerticalTabs) {
    return (
      <div
        className="w-48 flex-shrink-0"
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="vertical"
        data-testid={listTestId}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={activeKey === item.key}
            aria-disabled={item.disabled}
            aria-controls={panelTestidPrefix ? `${panelTestidPrefix}-${item.key}` : undefined}
            id={itemTestidPrefix ? `${itemTestidPrefix}-${item.key}` : undefined}
            data-testid={itemTestId(item)}
            disabled={item.disabled}
            onClick={() => {
              if (item.key !== activeKey && !item.disabled) onChange(item.key);
            }}
            className={[
              'w-full text-start px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 mb-0.5',
              item.disabled
                ? 'text-gray-300 cursor-not-allowed'
                : activeKey === item.key
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            ].join(' ')}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  // Should never reach here — one of the three modes is always true
  return null;
}
