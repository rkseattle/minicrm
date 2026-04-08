/**
 * Locale map contract for E2E text-based locator strategies.
 *
 * Provides a flat, dotted-key lookup (e.g. "login.submitButton") that mirrors
 * the shape of the application's i18n JSON files without pulling in i18next.
 * The active locale is controlled by the E2E_LOCALE environment variable and
 * defaults to "en".
 *
 * Unknown keys throw at test time so typos surface immediately rather than
 * silently producing empty selectors.
 *
 * MINCRM-126
 */

/**
 * Locale codes with registered maps in this module.
 * Extend this union and add a matching entry in LOCALE_MAPS when adding a new locale.
 */
export type LocaleCode = 'en' | 'es';

/**
 * A flat map from dotted key to translated string.
 * Keys mirror the nested path in the application's locale JSON files
 * (e.g. "nav.contacts" → "Contacts").
 */
export type LocaleMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Built-in locale maps (E2E selector subset — not a full app translation)
// ---------------------------------------------------------------------------

/**
 * English strings used in E2E text-based strategies.
 * Add keys here as new text selectors are written.
 */
const EN: LocaleMap = {
  // Navigation
  'nav.dashboard': 'Dashboard',
  'nav.contacts': 'Contacts',
  'nav.accounts': 'Accounts',
  'nav.deals': 'Deals',
  'nav.pipeline': 'Pipeline',
  'nav.myTasks': 'My Tasks',
  'nav.users': 'Users',
  'nav.logout': 'Log out',

  // Auth — login
  'login.submitButton': 'Sign in',
  'login.emailLabel': 'Email address',
  'login.passwordLabel': 'Password',

  // Auth — change password
  'changePassword.currentPasswordLabel': 'Current password',
  'changePassword.newPasswordLabel': 'New password',
  'changePassword.confirmPasswordLabel': 'Confirm new password',
  'changePassword.submitButton': 'Change password',

  // Contacts
  'contacts.saveChanges': 'Save changes',
  'contacts.save': 'Save',
  'contacts.cancel': 'Cancel',
  'contacts.delete': 'Delete',
  'contacts.empty': 'No contacts yet. Add one to get started.',

  // Accounts
  'accounts.save': 'Save',
  'accounts.saveChanges': 'Save changes',
  'accounts.cancel': 'Cancel',
  'accounts.delete': 'Delete',
  'accounts.edit': 'Edit',
  'accounts.newAccount': 'New Account',
  'accounts.empty': 'No accounts yet. Add one to get started.',
  'accounts.linkedContactsEmpty': 'No contacts linked to this account.',

  // Common actions
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.search': 'Search',
};

/**
 * Spanish strings used in E2E text-based strategies.
 * Must cover every key defined in EN.
 */
const ES: LocaleMap = {
  // Navigation
  'nav.dashboard': 'Panel',
  'nav.contacts': 'Contactos',
  'nav.accounts': 'Cuentas',
  'nav.deals': 'Negocios',
  'nav.pipeline': 'Canal',
  'nav.myTasks': 'Mis tareas',
  'nav.users': 'Usuarios',
  'nav.logout': 'Cerrar sesión',

  // Auth — login
  'login.submitButton': 'Iniciar sesión',
  'login.emailLabel': 'Correo electrónico',
  'login.passwordLabel': 'Contraseña',

  // Auth — change password
  'changePassword.currentPasswordLabel': 'Contraseña actual',
  'changePassword.newPasswordLabel': 'Nueva contraseña',
  'changePassword.confirmPasswordLabel': 'Confirmar nueva contraseña',
  'changePassword.submitButton': 'Cambiar contraseña',

  // Contacts
  'contacts.saveChanges': 'Guardar cambios',
  'contacts.save': 'Guardar',
  'contacts.cancel': 'Cancelar',
  'contacts.delete': 'Eliminar',
  'contacts.empty': 'Aún no hay contactos. Agrega uno para empezar.',

  // Accounts
  'accounts.save': 'Guardar',
  'accounts.saveChanges': 'Guardar cambios',
  'accounts.cancel': 'Cancelar',
  'accounts.delete': 'Eliminar',
  'accounts.edit': 'Editar',
  'accounts.newAccount': 'Nueva cuenta',
  'accounts.empty': 'Aún no hay cuentas. Agrega una para empezar.',
  'accounts.linkedContactsEmpty': 'No hay contactos vinculados a esta cuenta.',

  // Common actions
  'common.save': 'Guardar',
  'common.cancel': 'Cancelar',
  'common.delete': 'Eliminar',
  'common.edit': 'Editar',
  'common.add': 'Agregar',
  'common.search': 'Buscar',
};

/** All registered locale maps indexed by locale code. */
const LOCALE_MAPS: Partial<Record<LocaleCode, LocaleMap>> = {
  en: EN,
  es: ES,
};

// ---------------------------------------------------------------------------
// Active locale resolution
// ---------------------------------------------------------------------------

/**
 * Returns the active locale code from the E2E_LOCALE environment variable.
 * Falls back to "en" if the variable is absent or empty.
 */
export function activeLocale(): LocaleCode {
  const envLocale = process.env['E2E_LOCALE'];
  if (envLocale && envLocale in LOCALE_MAPS) {
    return envLocale as LocaleCode;
  }
  return 'en';
}

// ---------------------------------------------------------------------------
// t() helper
// ---------------------------------------------------------------------------

/**
 * Resolves a dotted key to its translated string in the given locale.
 *
 * Throws a `RangeError` if:
 * - The locale has no registered map.
 * - The key does not exist in that map.
 *
 * This ensures typos surface at test time, not as empty selectors that
 * silently match nothing.
 *
 * @param key - Dotted locale key (e.g. "login.submitButton").
 * @param locale - Locale code to resolve against. Defaults to `activeLocale()`.
 * @returns The translated string for the key.
 * @throws {RangeError} If the locale or key is unknown.
 *
 * @example
 * ```ts
 * const label = t('login.submitButton');           // uses E2E_LOCALE
 * const labelEs = t('login.submitButton', 'es');   // explicit locale
 * ```
 */
export function t(key: string, locale?: LocaleCode): string {
  const resolvedLocale = locale ?? activeLocale();
  const map = LOCALE_MAPS[resolvedLocale];

  if (map === undefined) {
    throw new RangeError(
      `t(): no locale map registered for locale "${resolvedLocale}". ` +
        `Registered locales: ${Object.keys(LOCALE_MAPS).join(', ')}`,
    );
  }

  const value = map[key];
  if (value === undefined) {
    throw new RangeError(
      `t(): unknown key "${key}" in locale "${resolvedLocale}". ` +
        `Available keys: ${Object.keys(map).join(', ')}`,
    );
  }

  return value;
}
