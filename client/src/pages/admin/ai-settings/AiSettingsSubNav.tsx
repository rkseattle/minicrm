/**
 * AiSettingsSubNav — tablist that switches between the AI panel's sub-sections.
 * (MINCRM-653)
 *
 * Follows the WAI-ARIA tabs pattern: role="tablist"/"tab", aria-selected,
 * aria-controls, roving tabindex with ArrowLeft/ArrowRight/Home/End keyboard
 * navigation. Visually modeled on SubPageNav's horizontal-tabs mode, but adds
 * the keyboard navigation SubPageNav itself does not implement — scoped to
 * this component rather than retrofitting the shared one, since SubPageNav
 * is used by several other unrelated top-level tab bars.
 */

import { useRef } from 'react';

export interface AiSettingsSubNavItem {
  key: string;
  label: string;
  'data-testid': string;
}

interface AiSettingsSubNavProps {
  items: AiSettingsSubNavItem[];
  activeKey: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}

export function AiSettingsSubNav({ items, activeKey, onChange, ariaLabel }: AiSettingsSubNavProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusTabAt(index: number): void {
    const clamped = (index + items.length) % items.length;
    tabRefs.current[clamped]?.focus();
    onChange(items[clamped].key);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusTabAt(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusTabAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTabAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusTabAt(items.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      className="flex overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-6"
      role="tablist"
      aria-label={ariaLabel}
      data-testid="ai-settings-subnav"
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={(el) => {
            tabRefs.current[index] = el;
          }}
          type="button"
          role="tab"
          aria-selected={activeKey === item.key}
          aria-controls={`ai-settings-panel-${item.key}`}
          id={`ai-settings-tab-${item.key}`}
          tabIndex={activeKey === item.key ? 0 : -1}
          data-testid={item['data-testid']}
          onClick={() => onChange(item.key)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className={[
            'px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500',
            activeKey === item.key
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
