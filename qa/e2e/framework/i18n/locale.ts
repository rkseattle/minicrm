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
export type LocaleCode = 'en' | 'es' | 'fr' | 'de' | 'zh-Hans';

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

  // Auth — forgot password
  'forgotPassword.emailLabel': 'Email address',
  'forgotPassword.submitButton': 'Send Reset Link',
  'forgotPassword.backToLogin': 'Back to sign in',

  // Auth — reset password
  'resetPassword.newPasswordLabel': 'New password',
  'resetPassword.confirmPasswordLabel': 'Confirm password',
  'resetPassword.submitButton': 'Set new password',

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

  // Leads
  'leads.new': 'New Lead',
  'leads.save': 'Save',
  'leads.delete': 'Delete',
  'leads.convert': 'Convert Lead',
  'leads.confirmConvert': 'Confirm',
  'leads.createAnyway': 'Create anyway',
  'leads.showDisqualified': 'Show disqualified',
  'leads.showConverted': 'Show converted',

  // Notifications / profile
  'profile.save': 'Save',

  // Admin settings — email notifications
  'settings.emailNotifications.sectionTitle': 'Email Notifications',

  // Tags (MINCRM-186)
  'tags.pageTitle': 'Tag Management',
  'tags.empty': 'No tags yet.',
  'tags.delete': 'Delete',
  'tags.save': 'Save',
  'tags.renameInputLabel': 'New tag name',
  'tags.inputLabel': 'Add tags',

  // Common actions
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
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

  // Auth — forgot password
  'forgotPassword.emailLabel': 'Correo electrónico',
  'forgotPassword.submitButton': 'Enviar enlace de restablecimiento',
  'forgotPassword.backToLogin': 'Volver a iniciar sesión',

  // Auth — reset password
  'resetPassword.newPasswordLabel': 'Nueva contraseña',
  'resetPassword.confirmPasswordLabel': 'Confirmar contraseña',
  'resetPassword.submitButton': 'Establecer nueva contraseña',

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

  // Leads
  'leads.new': 'Nuevo lead',
  'leads.save': 'Guardar',
  'leads.delete': 'Eliminar',
  'leads.convert': 'Convertir lead',
  'leads.confirmConvert': 'Confirmar',
  'leads.createAnyway': 'Crear de todas formas',
  'leads.showDisqualified': 'Mostrar descalificados',
  'leads.showConverted': 'Mostrar convertidos',

  // Notifications / profile
  'profile.save': 'Guardar',

  // Admin settings — email notifications
  'settings.emailNotifications.sectionTitle': 'Notificaciones de correo electrónico',

  // Tags (MINCRM-186)
  'tags.pageTitle': 'Gestión de etiquetas',
  'tags.empty': 'Aún no hay etiquetas.',
  'tags.delete': 'Eliminar',
  'tags.save': 'Guardar',
  'tags.renameInputLabel': 'Nuevo nombre de etiqueta',
  'tags.inputLabel': 'Añadir etiquetas',

  // Common actions
  'common.save': 'Guardar',
  'common.cancel': 'Cancelar',
  'common.delete': 'Eliminar',
  'common.edit': 'Editar',
};

/**
 * French strings used in E2E text-based strategies.
 * Translations sourced from client/src/locales/fr.json. (MINCRM-242)
 */
const FR: LocaleMap = {
  // Navigation
  'nav.dashboard': 'Tableau de bord',
  'nav.contacts': 'Contacts',
  'nav.accounts': 'Comptes',
  'nav.deals': 'Opportunités',
  'nav.pipeline': 'Pipeline',
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

  // Contacts
  'contacts.saveChanges': 'Enregistrer les modifications',
  'contacts.save': 'Enregistrer',
  'contacts.cancel': 'Annuler',
  'contacts.delete': 'Supprimer',
  'contacts.empty': "Aucun contact pour l'instant. Ajoutez-en un pour commencer.",

  // Accounts
  'accounts.save': 'Enregistrer',
  'accounts.saveChanges': 'Enregistrer les modifications',
  'accounts.cancel': 'Annuler',
  'accounts.delete': 'Supprimer',
  'accounts.edit': 'Modifier',
  'accounts.newAccount': 'Nouveau compte',
  'accounts.empty': "Aucun compte pour l'instant. Ajoutez-en un pour commencer.",
  'accounts.linkedContactsEmpty': 'Aucun contact associé à ce compte.',

  // Leads
  'leads.new': 'Nouveau prospect',
  'leads.save': 'Enregistrer',
  'leads.delete': 'Supprimer',
  'leads.convert': 'Convertir le prospect',
  'leads.confirmConvert': 'Convertir',
  'leads.createAnyway': 'Créer quand même',
  'leads.showDisqualified': 'Afficher les disqualifiés',
  'leads.showConverted': 'Afficher les convertis',

  // Notifications / profile
  'profile.save': 'Enregistrer',

  // Admin settings — email notifications
  'settings.emailNotifications.sectionTitle': 'Notifications par e-mail',

  // Tags (MINCRM-186)
  'tags.pageTitle': 'Gestion des étiquettes',
  'tags.empty': "Aucune étiquette pour l'instant.",
  'tags.delete': 'Supprimer',
  'tags.save': 'Enregistrer',
  'tags.renameInputLabel': "Nouveau nom d'étiquette",
  'tags.inputLabel': 'Ajouter des étiquettes',

  // Common actions
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.delete': 'Supprimer',
  'common.edit': 'Modifier',
};

/**
 * German strings used in E2E text-based strategies.
 * Translations sourced from client/src/locales/de.json. (MINCRM-242)
 */
const DE: LocaleMap = {
  // Navigation
  'nav.dashboard': 'Dashboard',
  'nav.contacts': 'Kontakte',
  'nav.accounts': 'Konten',
  'nav.deals': 'Geschäfte',
  'nav.pipeline': 'Pipeline',
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

  // Contacts
  'contacts.saveChanges': 'Änderungen speichern',
  'contacts.save': 'Speichern',
  'contacts.cancel': 'Abbrechen',
  'contacts.delete': 'Löschen',
  'contacts.empty': 'Noch keine Kontakte. Fügen Sie einen hinzu.',

  // Accounts
  'accounts.save': 'Speichern',
  'accounts.saveChanges': 'Änderungen speichern',
  'accounts.cancel': 'Abbrechen',
  'accounts.delete': 'Löschen',
  'accounts.edit': 'Bearbeiten',
  'accounts.newAccount': 'Neues Konto',
  'accounts.empty': 'Noch keine Konten. Fügen Sie eines hinzu.',
  'accounts.linkedContactsEmpty': 'Keine Kontakte mit diesem Konto verknüpft.',

  // Leads
  'leads.new': 'Neuer Lead',
  'leads.save': 'Speichern',
  'leads.delete': 'Löschen',
  'leads.convert': 'Lead konvertieren',
  'leads.confirmConvert': 'Konvertieren',
  'leads.createAnyway': 'Trotzdem erstellen',
  'leads.showDisqualified': 'Disqualifizierte anzeigen',
  'leads.showConverted': 'Konvertierte anzeigen',

  // Notifications / profile
  'profile.save': 'Speichern',

  // Admin settings — email notifications
  'settings.emailNotifications.sectionTitle': 'E-Mail-Benachrichtigungen',

  // Tags (MINCRM-186)
  'tags.pageTitle': 'Tag-Verwaltung',
  'tags.empty': 'Noch keine Tags.',
  'tags.delete': 'Löschen',
  'tags.save': 'Speichern',
  'tags.renameInputLabel': 'Neuer Tag-Name',
  'tags.inputLabel': 'Tags hinzufügen',

  // Common actions
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.delete': 'Löschen',
  'common.edit': 'Bearbeiten',
};

/**
 * Simplified Chinese strings used in E2E text-based strategies.
 * Translations sourced from client/src/locales/zh-Hans.json. (MINCRM-242)
 */
const ZH_HANS: LocaleMap = {
  // Navigation
  'nav.dashboard': '仪表板',
  'nav.contacts': '联系人',
  'nav.accounts': '客户',
  'nav.deals': '商机',
  'nav.pipeline': '管道看板',
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

  // Contacts
  'contacts.saveChanges': '保存更改',
  'contacts.save': '保存',
  'contacts.cancel': '取消',
  'contacts.delete': '删除',
  'contacts.empty': '暂无联系人，请添加。',

  // Accounts
  'accounts.save': '保存',
  'accounts.saveChanges': '保存更改',
  'accounts.cancel': '取消',
  'accounts.delete': '删除',
  'accounts.edit': '编辑',
  'accounts.newAccount': '新建客户',
  'accounts.empty': '暂无客户，请添加。',
  'accounts.linkedContactsEmpty': '此客户暂无关联联系人。',

  // Leads
  'leads.new': '新建潜在客户',
  'leads.save': '保存',
  'leads.delete': '删除',
  'leads.convert': '转化潜在客户',
  'leads.confirmConvert': '转化',
  'leads.createAnyway': '仍然创建',
  'leads.showDisqualified': '显示已失效',
  'leads.showConverted': '显示已转化',

  // Notifications / profile
  'profile.save': '保存',

  // Admin settings — email notifications
  'settings.emailNotifications.sectionTitle': '电子邮件通知',

  // Tags (MINCRM-186)
  'tags.pageTitle': '标签管理',
  'tags.empty': '暂无标签。',
  'tags.delete': '删除',
  'tags.save': '保存',
  'tags.renameInputLabel': '新标签名称',
  'tags.inputLabel': '添加标签',

  // Common actions
  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.edit': '编辑',
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
// Active locale resolution
// ---------------------------------------------------------------------------

/** Overrides the active locale at runtime (e.g. from i18n E2E specs). MINCRM-242 */
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
