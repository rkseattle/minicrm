/**
 * NavBar — layout-aware navigation dispatcher.
 * Reads the active nav layout from NavLayoutContext and renders the
 * appropriate layout component. Page components import NavBar without
 * needing to know which layout is active. (MINCRM-133)
 *
 * For the top layout: renders NavTop (standalone, wraps its own content).
 * For the left layout: NavLeft wraps children, so NavBar is not used in that mode —
 *   App.tsx handles wrapping when layout === 'left'.
 * For the hamburger layout: renders NavHamburger (standalone).
 */

import { useNavLayout } from './NavLayoutContext.js';
import NavTop from './NavTop.js';
import NavHamburger from './NavHamburger.js';

/**
 * Renders the active navigation component based on the system layout setting.
 * Used by all page components to include navigation without caring about layout style.
 *
 * - top: renders NavTop (tab bar)
 * - hamburger: renders NavHamburger (icon-triggered overlay)
 * - left: returns null — the sidebar is injected by LayoutShell in App.tsx
 */
export default function NavBar() {
  const { layout } = useNavLayout();

  if (layout === 'left') {
    return null;
  }

  if (layout === 'hamburger') {
    return <NavHamburger />;
  }

  return <NavTop />;
}
