/**
 * NavBar — layout-aware navigation dispatcher.
 * Reads the active nav layout from NavLayoutContext and renders the
 * appropriate layout component. Page components import NavBar without
 * needing to know which layout is active. (MINCRM-133)
 *
 * The layout setting is a desktop-only concept. On mobile viewports (< 1024 px)
 * NavTop always renders regardless of the stored layout — its built-in hamburger
 * toggle and mobile drawer are the canonical mobile navigation UI.
 *
 * For the top layout: renders NavTop (includes GlobalSearch in its header row).
 * For the left layout: NavLeft owns its own full-width header; NavBar returns null.
 * For the hamburger layout: renders NavHamburger (includes GlobalSearch in its top bar).
 */

import { useNavLayout } from './NavLayoutContext.js';
import { useIsMobile } from '@/hooks/useIsMobile.js';
import NavTop from './NavTop.js';
import NavHamburger from './NavHamburger.js';

/**
 * Renders the active navigation component based on the system layout setting.
 * Used by all page components to include navigation without caring about layout style.
 *
 * On mobile (< 1024 px) NavTop is always rendered — the layout setting only applies
 * at desktop breakpoints.
 *
 * - top: renders NavTop (search in the header row)
 * - hamburger: renders NavHamburger (search in the top bar)
 * - left: returns null — NavLeft owns its header; sidebar injected by LayoutShell
 */
export default function NavBar() {
  const { layout } = useNavLayout();
  const isMobile = useIsMobile();

  // Mobile always uses NavTop — the desktop layout setting does not apply.
  if (isMobile) {
    return <NavTop />;
  }

  if (layout === 'left') {
    // NavLeft renders its own full-width header (logo, search, user controls).
    return null;
  }

  if (layout === 'hamburger') {
    // NavHamburger renders its own full-width header (logo, search, user controls).
    return <NavHamburger />;
  }

  return <NavTop />;
}
