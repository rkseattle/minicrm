/**
 * MiniCRM app-domain locale extension.
 *
 * Defines translation keys for all MiniCRM UI text across all supported
 * locales and registers them with the framework's t() function via
 * registerLocaleExtension(). This includes both infrastructure strings
 * (auth, nav, common actions) and CRM-specific strings (contacts, deals, etc.).
 *
 * This module is imported as a side-effect by apps/minicrm/fixtures.ts so
 * the extension is registered before any fixture creates a Page Object.
 */

import { registerLocaleExtension } from '@framework/i18n/locale.js';
import type { LocaleMap } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------

const MINICRM_EN: LocaleMap = {
  // Navigation — shared infrastructure
  'nav.dashboard': 'Dashboard',
  'nav.myTasks': 'My Tasks',
  'nav.users': 'Users',
  'nav.logout': 'Log out',

  // Navigation — CRM-specific sections
  'nav.contacts': 'Contacts',
  'nav.accounts': 'Accounts',
  'nav.deals': 'Deals',
  'nav.pipeline': 'Pipeline',

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

  // Contacts
  'contacts.saveChanges': 'Save changes',
  'contacts.save': 'Save',
  'contacts.cancel': 'Cancel',
  'contacts.delete': 'Delete',
  'contacts.empty': 'No contacts yet. Add one to get started.',

  // Activities — AI call/note summarizer (MINCRM-436)
  'activities.summarize.action': 'Summarize',

  // AI email draft generation (MINCRM-437)
  'emailDraft.draftEmailButton': 'Draft Email',
  'emailDraft.panelTitle': 'Email Draft',
  'emailDraft.copyToClipboard': 'Copy to clipboard',
  'emailDraft.dismiss': 'Dismiss',

  // AI contact auto-enrich from text (MINCRM-439)
  'contactEnrichment.action': 'Enrich from text',

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
  'leads.edit': 'Edit',
  'leads.save': 'Save',
  'leads.cancel': 'Cancel',
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

  // Tags
  'tags.pageTitle': 'Tag Management',
  'tags.empty': 'No tags yet.',
  'tags.delete': 'Delete',
  'tags.save': 'Save',
  'tags.renameInputLabel': 'New tag name',
  'tags.inputLabel': 'Add tags',
};

// ---------------------------------------------------------------------------
// Spanish
// ---------------------------------------------------------------------------

const MINICRM_ES: LocaleMap = {
  // Navigation — shared infrastructure
  'nav.dashboard': 'Panel',
  'nav.myTasks': 'Mis tareas',
  'nav.users': 'Usuarios',
  'nav.logout': 'Cerrar sesión',

  // Navigation — CRM-specific sections
  'nav.contacts': 'Contactos',
  'nav.accounts': 'Cuentas',
  'nav.deals': 'Negocios',
  'nav.pipeline': 'Canal',

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

  // Contacts
  'contacts.saveChanges': 'Guardar cambios',
  'contacts.save': 'Guardar',
  'contacts.cancel': 'Cancelar',
  'contacts.delete': 'Eliminar',
  'contacts.empty': 'Aún no hay contactos. Agrega uno para empezar.',

  // Activities — AI call/note summarizer (MINCRM-436)
  'activities.summarize.action': 'Resumir',

  // AI email draft generation (MINCRM-437)
  'emailDraft.draftEmailButton': 'Redactar correo',
  'emailDraft.panelTitle': 'Borrador de correo',
  'emailDraft.copyToClipboard': 'Copiar al portapapeles',
  'emailDraft.dismiss': 'Descartar',

  // AI contact auto-enrich from text (MINCRM-439)
  'contactEnrichment.action': 'Enriquecer desde texto',

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
  'leads.edit': 'Editar',
  'leads.save': 'Guardar',
  'leads.cancel': 'Cancelar',
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

  // Tags
  'tags.pageTitle': 'Gestión de etiquetas',
  'tags.empty': 'Aún no hay etiquetas.',
  'tags.delete': 'Eliminar',
  'tags.save': 'Guardar',
  'tags.renameInputLabel': 'Nuevo nombre de etiqueta',
  'tags.inputLabel': 'Añadir etiquetas',
};

// ---------------------------------------------------------------------------
// French
// ---------------------------------------------------------------------------

const MINICRM_FR: LocaleMap = {
  // Navigation — shared infrastructure
  'nav.dashboard': 'Tableau de bord',
  'nav.myTasks': 'Mes tâches',
  'nav.users': 'Utilisateurs',
  'nav.logout': 'Se déconnecter',

  // Navigation — CRM-specific sections
  'nav.contacts': 'Contacts',
  'nav.accounts': 'Comptes',
  'nav.deals': 'Opportunités',
  'nav.pipeline': 'Pipeline',

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

  // Contacts
  'contacts.saveChanges': 'Enregistrer les modifications',
  'contacts.save': 'Enregistrer',
  'contacts.cancel': 'Annuler',
  'contacts.delete': 'Supprimer',
  'contacts.empty': "Aucun contact pour l'instant. Ajoutez-en un pour commencer.",

  // Activities — AI call/note summarizer (MINCRM-436)
  'activities.summarize.action': 'Résumer',

  // AI email draft generation (MINCRM-437)
  'emailDraft.draftEmailButton': 'Rédiger un e-mail',
  'emailDraft.panelTitle': "Brouillon d'e-mail",
  'emailDraft.copyToClipboard': 'Copier dans le presse-papiers',
  'emailDraft.dismiss': 'Ignorer',

  // AI contact auto-enrich from text (MINCRM-439)
  'contactEnrichment.action': 'Enrichir à partir du texte',

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
  'leads.edit': 'Modifier',
  'leads.save': 'Enregistrer',
  'leads.cancel': 'Annuler',
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

  // Tags
  'tags.pageTitle': 'Gestion des étiquettes',
  'tags.empty': "Aucune étiquette pour l'instant.",
  'tags.delete': 'Supprimer',
  'tags.save': 'Enregistrer',
  'tags.renameInputLabel': "Nouveau nom d'étiquette",
  'tags.inputLabel': 'Ajouter des étiquettes',
};

// ---------------------------------------------------------------------------
// German
// ---------------------------------------------------------------------------

const MINICRM_DE: LocaleMap = {
  // Navigation — shared infrastructure
  'nav.dashboard': 'Dashboard',
  'nav.myTasks': 'Meine Aufgaben',
  'nav.users': 'Benutzer',
  'nav.logout': 'Abmelden',

  // Navigation — CRM-specific sections
  'nav.contacts': 'Kontakte',
  'nav.accounts': 'Konten',
  'nav.deals': 'Geschäfte',
  'nav.pipeline': 'Pipeline',

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

  // Contacts
  'contacts.saveChanges': 'Änderungen speichern',
  'contacts.save': 'Speichern',
  'contacts.cancel': 'Abbrechen',
  'contacts.delete': 'Löschen',
  'contacts.empty': 'Noch keine Kontakte. Fügen Sie einen hinzu.',

  // Activities — AI call/note summarizer (MINCRM-436)
  'activities.summarize.action': 'Zusammenfassen',

  // AI email draft generation (MINCRM-437)
  'emailDraft.draftEmailButton': 'E-Mail entwerfen',
  'emailDraft.panelTitle': 'E-Mail-Entwurf',
  'emailDraft.copyToClipboard': 'In die Zwischenablage kopieren',
  'emailDraft.dismiss': 'Verwerfen',

  // AI contact auto-enrich from text (MINCRM-439)
  'contactEnrichment.action': 'Aus Text anreichern',

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
  'leads.edit': 'Bearbeiten',
  'leads.save': 'Speichern',
  'leads.cancel': 'Abbrechen',
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

  // Tags
  'tags.pageTitle': 'Tag-Verwaltung',
  'tags.empty': 'Noch keine Tags.',
  'tags.delete': 'Löschen',
  'tags.save': 'Speichern',
  'tags.renameInputLabel': 'Neuer Tag-Name',
  'tags.inputLabel': 'Tags hinzufügen',
};

// ---------------------------------------------------------------------------
// Simplified Chinese
// ---------------------------------------------------------------------------

const MINICRM_ZH_HANS: LocaleMap = {
  // Navigation — shared infrastructure
  'nav.dashboard': '仪表板',
  'nav.myTasks': '我的任务',
  'nav.users': '用户',
  'nav.logout': '退出登录',

  // Navigation — CRM-specific sections
  'nav.contacts': '联系人',
  'nav.accounts': '客户',
  'nav.deals': '商机',
  'nav.pipeline': '管道看板',

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

  // Contacts
  'contacts.saveChanges': '保存更改',
  'contacts.save': '保存',
  'contacts.cancel': '取消',
  'contacts.delete': '删除',
  'contacts.empty': '暂无联系人，请添加。',

  // Activities — AI call/note summarizer (MINCRM-436)
  'activities.summarize.action': '生成摘要',

  // AI email draft generation (MINCRM-437)
  'emailDraft.draftEmailButton': '起草邮件',
  'emailDraft.panelTitle': '邮件草稿',
  'emailDraft.copyToClipboard': '复制到剪贴板',
  'emailDraft.dismiss': '关闭',

  // AI contact auto-enrich from text (MINCRM-439)
  'contactEnrichment.action': '从文本提取信息',

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
  'leads.edit': '编辑',
  'leads.save': '保存',
  'leads.cancel': '取消',
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

  // Tags
  'tags.pageTitle': '标签管理',
  'tags.empty': '暂无标签。',
  'tags.delete': '删除',
  'tags.save': '保存',
  'tags.renameInputLabel': '新标签名称',
  'tags.inputLabel': '添加标签',
};

// ---------------------------------------------------------------------------
// Registration (top-level side-effect — runs at module import time)
// ---------------------------------------------------------------------------

registerLocaleExtension({
  en: MINICRM_EN,
  es: MINICRM_ES,
  fr: MINICRM_FR,
  de: MINICRM_DE,
  'zh-Hans': MINICRM_ZH_HANS,
});
