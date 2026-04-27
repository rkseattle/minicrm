/**
 * MiniCRM app-domain locale extension.
 *
 * Defines translation keys for CRM-specific UI text across all supported
 * locales and registers them with the framework's t() function via
 * registerLocaleExtension(). This keeps app-domain strings out of the
 * framework layer while allowing Page Objects to continue importing t()
 * from @framework/i18n/locale.js without modification.
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
  // Navigation — CRM-specific sections
  'nav.contacts': 'Contacts',
  'nav.accounts': 'Accounts',
  'nav.deals': 'Deals',
  'nav.pipeline': 'Pipeline',

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
  // Navigation — CRM-specific sections
  'nav.contacts': 'Contactos',
  'nav.accounts': 'Cuentas',
  'nav.deals': 'Negocios',
  'nav.pipeline': 'Canal',

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
  // Navigation — CRM-specific sections
  'nav.contacts': 'Contacts',
  'nav.accounts': 'Comptes',
  'nav.deals': 'Opportunités',
  'nav.pipeline': 'Pipeline',

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
  // Navigation — CRM-specific sections
  'nav.contacts': 'Kontakte',
  'nav.accounts': 'Konten',
  'nav.deals': 'Geschäfte',
  'nav.pipeline': 'Pipeline',

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
  // Navigation — CRM-specific sections
  'nav.contacts': '联系人',
  'nav.accounts': '客户',
  'nav.deals': '商机',
  'nav.pipeline': '管道看板',

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
