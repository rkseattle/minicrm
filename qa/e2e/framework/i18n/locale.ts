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
 * App-domain keys (CRM entities, navigation specific to a product) must NOT
 * be added here. Use registerLocaleExtension() from the app fixture layer
 * to merge app-domain keys at startup.
 */

/**
 * Locale codes with registered maps in this module.
 * Extend this union and add a matching entry in LOCALE_MAPS when adding a new locale.
 */
export type LocaleCode = 'en' | 'es' | 'fr' | 'de' | 'zh-Hans';

/**
 * A flat map from dotted key to translated string.
 * Keys mirror the nested path in the application's locale JSON files
 * (e.g. "nav.dashboard" → "Dashboard").
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
  // Navigation (infrastructure — app-specific nav entries belong in app locale extensions)
  'nav.dashboard': 'Dashboard',
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

  // Auth — forgot password
  'forgotPassword.emailLabel': 'Email address',
  'forgotPassword.submitButton': 'Send Reset Link',
  'forgotPassword.backToLogin': 'Back to sign in',

  // Auth — reset password
  'resetPassword.newPasswordLabel': 'New password',
  'resetPassword.confirmPasswordLabel': 'Confirm password',
  'resetPassword.submitButton': 'Set new password',

  // Auth — set password (invite activation)
  'setPassword.newPasswordLabel': 'Password',
  'setPassword.confirmPasswordLabel': 'Confirm password',
  'setPassword.submitButton': 'Set password',

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

  // Auth — forgot password
  'forgotPassword.emailLabel': 'Correo electrónico',
  'forgotPassword.submitButton': 'Enviar enlace de restablecimiento',
  'forgotPassword.backToLogin': 'Volver a iniciar sesión',

  // Auth — reset password
  'resetPassword.newPasswordLabel': 'Nueva contraseña',
  'resetPassword.confirmPasswordLabel': 'Confirmar contraseña',
  'resetPassword.submitButton': 'Establecer nueva contraseña',

  // Auth — set password (invite activation)
  'setPassword.newPasswordLabel': 'Contraseña',
  'setPassword.confirmPasswordLabel': 'Confirmar contraseña',
  'setPassword.submitButton': 'Establecer contraseña',

  // Common actions
  'common.save': 'Guardar',
  'common.cancel': 'Cancelar',
  'common.delete': 'Eliminar',
  'common.edit': 'Editar',
  'common.add': 'Agregar',
  'common.search': 'Buscar',
};

/**
 * French strings used in E2E text-based strategies.
 * Translations sourced from client/src/locales/fr.json.
 */
const FR: LocaleMap = {
  // Navigation
  'nav.dashboard': 'Tableau de bord',
  'nav.myTasks': 'Mes tâches',
  'nav.users': 'Utilisateurs',
  'nav.logout': 'Se déconnecter',

  // Auth — login
  'login.submitButton': 'Se connecter',
  'login.emailLabel': 'Adresse e-mail',
  'login.passwordLabel': 'Mot de passe',

  // Auth — change password
  'changePassword.currentPasswordLabel': 'Mot de passe actuel',
  'changePassword.newPasswordLabel': 'Nouveau mot de passe',
  'changePassword.confirmPasswordLabel': 'Confirmer le nouveau mot de passe',
  'changePassword.submitButton': 'Changer le mot de passe',

  // Auth — forgot password
  'forgotPassword.emailLabel': 'Adresse e-mail',
  'forgotPassword.submitButton': 'Envoyer le lien de réinitialisation',
  'forgotPassword.backToLogin': 'Retour à la connexion',

  // Auth — reset password
  'resetPassword.newPasswordLabel': 'Nouveau mot de passe',
  'resetPassword.confirmPasswordLabel': 'Confirmer le mot de passe',
  'resetPassword.submitButton': 'Définir le nouveau mot de passe',

  // Auth — set password (invite activation)
  'setPassword.newPasswordLabel': 'Mot de passe',
  'setPassword.confirmPasswordLabel': 'Confirmer le mot de passe',
  'setPassword.submitButton': 'Définir le mot de passe',

  // Common actions
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.delete': 'Supprimer',
  'common.edit': 'Modifier',
  'common.add': 'Ajouter',
  'common.search': 'Rechercher',
};

/**
 * German strings used in E2E text-based strategies.
 * Translations sourced from client/src/locales/de.json.
 */
const DE: LocaleMap = {
  // Navigation
  'nav.dashboard': 'Dashboard',
  'nav.myTasks': 'Meine Aufgaben',
  'nav.users': 'Benutzer',
  'nav.logout': 'Abmelden',

  // Auth — login
  'login.submitButton': 'Anmelden',
  'login.emailLabel': 'E-Mail-Adresse',
  'login.passwordLabel': 'Passwort',

  // Auth — change password
  'changePassword.currentPasswordLabel': 'Aktuelles Passwort',
  'changePassword.newPasswordLabel': 'Neues Passwort',
  'changePassword.confirmPasswordLabel': 'Neues Passwort bestätigen',
  'changePassword.submitButton': 'Passwort ändern',

  // Auth — forgot password
  'forgotPassword.emailLabel': 'E-Mail-Adresse',
  'forgotPassword.submitButton': 'Link zum Zurücksetzen senden',
  'forgotPassword.backToLogin': 'Zurück zur Anmeldung',

  // Auth — reset password
  'resetPassword.newPasswordLabel': 'Neues Passwort',
  'resetPassword.confirmPasswordLabel': 'Passwort bestätigen',
  'resetPassword.submitButton': 'Neues Passwort festlegen',

  // Auth — set password (invite activation)
  'setPassword.newPasswordLabel': 'Passwort',
  'setPassword.confirmPasswordLabel': 'Passwort bestätigen',
  'setPassword.submitButton': 'Passwort festlegen',

  // Common actions
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.delete': 'Löschen',
  'common.edit': 'Bearbeiten',
  'common.add': 'Hinzufügen',
  'common.search': 'Suche',
};

/**
 * Simplified Chinese strings used in E2E text-based strategies.
 * Translations sourced from client/src/locales/zh-Hans.json.
 */
const ZH_HANS: LocaleMap = {
  // Navigation
  'nav.dashboard': '仪表板',
  'nav.myTasks': '我的任务',
  'nav.users': '用户',
  'nav.logout': '退出登录',

  // Auth — login
  'login.submitButton': '登录',
  'login.emailLabel': '电子邮件地址',
  'login.passwordLabel': '密码',

  // Auth — change password
  'changePassword.currentPasswordLabel': '当前密码',
  'changePassword.newPasswordLabel': '新密码',
  'changePassword.confirmPasswordLabel': '确认新密码',
  'changePassword.submitButton': '修改密码',

  // Auth — forgot password
  'forgotPassword.emailLabel': '电子邮件地址',
  'forgotPassword.submitButton': '发送重置链接',
  'forgotPassword.backToLogin': '返回登录',

  // Auth — reset password
  'resetPassword.newPasswordLabel': '新密码',
  'resetPassword.confirmPasswordLabel': '确认密码',
  'resetPassword.submitButton': '设置新密码',

  // Auth — set password (invite activation)
  'setPassword.newPasswordLabel': '密码',
  'setPassword.confirmPasswordLabel': '确认密码',
  'setPassword.submitButton': '设置密码',

  // Common actions
  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.add': '添加',
  'common.search': '搜索',
};

/** All registered locale maps indexed by locale code. */
const LOCALE_MAPS: Partial<Record<LocaleCode, LocaleMap>> = {
  en: EN,
  es: ES,
  fr: FR,
  de: DE,
  'zh-Hans': ZH_HANS,
};

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

/**
 * Merges additional locale keys into the registered locale maps.
 *
 * Call this once at app-fixture startup to register app-domain keys that
 * do not belong in the framework layer.
 * Extension keys are merged additively — existing framework keys are never
 * removed. Calling this multiple times is safe; each call adds or overwrites
 * the keys provided.
 *
 * @param extension - Partial map of locale code → additional key/value pairs.
 */
export function registerLocaleExtension(extension: Partial<Record<LocaleCode, LocaleMap>>): void {
  for (const [code, keys] of Object.entries(extension) as [LocaleCode, LocaleMap][]) {
    const existing = LOCALE_MAPS[code];
    if (existing !== undefined) {
      Object.assign(existing, keys);
    } else {
      LOCALE_MAPS[code] = { ...keys };
    }
  }
}

// ---------------------------------------------------------------------------
// Active locale resolution
// ---------------------------------------------------------------------------

/** Overrides the active locale at runtime (e.g. from i18n E2E specs). */
let _runtimeLocale: LocaleCode | null = null;

/**
 * Sets the active locale at runtime, allowing i18n E2E tests to switch the
 * framework locale to match the language being tested.
 *
 * @param code - The locale code to activate.
 */
export function setLocale(code: LocaleCode): void {
  _runtimeLocale = code;
}

/**
 * Returns the active locale code. Priority order:
 * 1. Runtime override set via `setLocale()`.
 * 2. The `E2E_LOCALE` environment variable.
 * 3. Falls back to "en" if neither is set or the value is unregistered.
 */
export function activeLocale(): LocaleCode {
  if (_runtimeLocale !== null) {
    return _runtimeLocale;
  }
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
