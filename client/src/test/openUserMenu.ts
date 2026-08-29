/**
 * Opens the header's user menu, which holds Profile Settings, the language
 * preference, and Log out.
 *
 * Shared because every nav layout's suite reaches those controls the same way, and
 * the trigger only exists once the auth query has resolved a user.
 */

import { screen, fireEvent } from '@testing-library/react';

export async function openUserMenu(): Promise<void> {
  const trigger = await screen.findByTestId('nav-user-menu-button');
  fireEvent.click(trigger);
}
