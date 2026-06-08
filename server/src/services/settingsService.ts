/**
 * Settings service — all database operations related to system settings.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import pool from '../db.js';
import logger from '../logger.js';
import {
  SUPPORTED_LOCALES,
  NAV_LAYOUTS,
  SUPPORTED_CURRENCIES,
} from '@minicrm/shared/schemas/settingsSchema.js';
import type {
  SupportedLocale,
  NavLayout,
  SupportedCurrency,
} from '@minicrm/shared/schemas/settingsSchema.js';
import type { AuditActor } from './auditService.js';
import { SYSTEM_ACTOR, actorIdOrNull } from './auditService.js';
import { withRlsQuery } from './rlsContextService.js';

/** A row from the system_settings table */
interface SystemSettingRow {
  key: string;
  value: string;
  updated_at: Date;
}

/** The key used to store the default language setting */
const DEFAULT_LANGUAGE_KEY = 'default_language';

/** The key used to store the navigation layout setting (MINCRM-133) */
const NAV_LAYOUT_KEY = 'nav_layout';

/** The key used to store the global email notifications enabled setting (MINCRM-163) */
const EMAIL_NOTIFICATIONS_ENABLED_KEY = 'email_notifications_enabled';

/** The key used to store the default currency setting (MINCRM-189) */
const DEFAULT_CURRENCY_KEY = 'default_currency';

/** The key used to store the tag creation restriction setting (MINCRM-263) */
const TAGS_RESTRICT_CREATION_KEY = 'tags_restrict_creation';

/** The key used to track that the admin reviewed/saved pipeline stages (MINCRM-379) */
const PIPELINE_STAGES_REVIEWED_KEY = 'pipeline_stages_reviewed';

/**
 * Retrieves the current system-wide default language.
 * Falls back to 'en' if the row is somehow missing.
 *
 * @returns The stored default language code.
 */
export async function getDefaultLanguage(): Promise<SupportedLocale> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [DEFAULT_LANGUAGE_KEY],
  );
  if (!result.rows[0]) {
    logger.warn('system_settings row for default_language is missing — falling back to en');
    return 'en';
  }
  const raw = result.rows[0].value;
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    logger.warn(`system_settings default_language '${raw}' is unsupported — falling back to en`);
    return 'en';
  }
  return raw as SupportedLocale;
}

/**
 * Persists a new system-wide default language.
 *
 * @param language - One of the supported locale codes.
 * @returns The updated language code.
 */
export async function setDefaultLanguage(
  language: SupportedLocale,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SupportedLocale> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [DEFAULT_LANGUAGE_KEY, language, actorIdOrNull(actor)],
  );
  return language;
}

/**
 * Retrieves the current system-wide navigation layout.
 * Falls back to 'top' if the row is somehow missing. (MINCRM-133)
 *
 * @returns The stored nav layout value.
 */
export async function getNavLayout(): Promise<NavLayout> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [NAV_LAYOUT_KEY],
  );
  if (!result.rows[0]) {
    logger.warn('system_settings row for nav_layout is missing — falling back to top');
    return 'top';
  }
  const raw = result.rows[0].value;
  if (!(NAV_LAYOUTS as readonly string[]).includes(raw)) {
    logger.warn(`system_settings nav_layout '${raw}' is unsupported — falling back to top`);
    return 'top';
  }
  return raw as NavLayout;
}

/**
 * Persists a new system-wide navigation layout. (MINCRM-133)
 *
 * @param layout - One of the supported nav layout values.
 * @returns The updated layout value.
 */
export async function setNavLayout(
  layout: NavLayout,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<NavLayout> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [NAV_LAYOUT_KEY, layout, actorIdOrNull(actor)],
  );
  return layout;
}

// ── Email notifications global toggle (MINCRM-163) ───────────────────────────

/**
 * Returns whether the system-wide email notifications are enabled.
 * Defaults to true if the setting row is missing.
 *
 * @returns True when notifications are globally enabled.
 */
export async function getEmailNotificationsEnabled(): Promise<boolean> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [EMAIL_NOTIFICATIONS_ENABLED_KEY],
  );
  if (!result.rows[0]) {
    logger.warn(
      'system_settings row for email_notifications_enabled is missing — defaulting to true',
    );
    return true;
  }
  return result.rows[0].value === 'true';
}

/**
 * Sets whether the system-wide email notifications are enabled. Admin only.
 *
 * @param enabled - Whether to enable or disable email notifications globally.
 * @returns The persisted value.
 */
export async function setEmailNotificationsEnabled(
  enabled: boolean,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<boolean> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [EMAIL_NOTIFICATIONS_ENABLED_KEY, String(enabled), actorIdOrNull(actor)],
  );
  return enabled;
}

// ── Default currency (MINCRM-189) ─────────────────────────────────────────────

/**
 * Retrieves the current system-wide default currency.
 * Falls back to 'USD' if the row is missing.
 *
 * @returns The stored default currency code.
 */
export async function getDefaultCurrency(): Promise<SupportedCurrency> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [DEFAULT_CURRENCY_KEY],
  );
  if (!result.rows[0]) {
    return 'USD';
  }
  const raw = result.rows[0].value;
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(raw)) {
    logger.warn(`system_settings default_currency '${raw}' is unsupported — falling back to USD`);
    return 'USD';
  }
  return raw as SupportedCurrency;
}

/**
 * Persists a new system-wide default currency. Admin only. (MINCRM-189)
 *
 * @param currency - One of the supported ISO 4217 currency codes.
 * @returns The updated currency code.
 */
export async function setDefaultCurrency(
  currency: SupportedCurrency,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SupportedCurrency> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [DEFAULT_CURRENCY_KEY, currency, actorIdOrNull(actor)],
  );
  return currency;
}

// ── Tag creation restriction (MINCRM-263) ─────────────────────────────────────

/**
 * Returns whether tag creation is restricted to the Tag Management page.
 * Defaults to false if the setting row is missing.
 *
 * @returns True when tag creation is restricted to admins only.
 */
export async function getTagsRestrictCreation(): Promise<boolean> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [TAGS_RESTRICT_CREATION_KEY],
  );
  if (!result.rows[0]) {
    return false;
  }
  return result.rows[0].value === 'true';
}

/**
 * Sets whether tag creation is restricted to admins on the Tag Management page. Admin only.
 *
 * @param restricted - Whether to restrict inline tag creation to admins only.
 * @returns The persisted value.
 */
export async function setTagsRestrictCreation(
  restricted: boolean,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<boolean> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [TAGS_RESTRICT_CREATION_KEY, String(restricted), actorIdOrNull(actor)],
  );
  return restricted;
}

// ── Onboarding / Setup Checklist (MINCRM-256, MINCRM-379, MINCRM-410) ────────

/** Completion status for one setup checklist task (MINCRM-379) */
export interface OnboardingTask {
  id: string;
  completed: boolean;
}

/** Shape returned by the onboarding status query */
export interface OnboardingStatus {
  is_first_run: boolean;
  onboarding_completed: boolean;
  /** Per-task completion, determined server-side (MINCRM-379) */
  tasks: OnboardingTask[];
}

/** Caller identity required for per-user onboarding status (MINCRM-410) */
export interface OnboardingCaller {
  id: string;
  role: 'admin' | 'rep';
}

/**
 * Returns admin-specific onboarding status. Task completion is based on
 * global (org-wide) counts. The onboarding_completed flag is read from the
 * caller's own user row. (MINCRM-410)
 *
 * Tasks:
 *   1. pipeline_stages_reviewed — admin reviewed/saved pipeline stages
 *   2. team_member_invited     — at least one active non-admin user exists
 *   3. first_contact_added     — any non-demo contact exists
 *   4. first_deal_created      — any non-demo deal exists
 *   5. smtp_configured         — smtp_host setting is non-empty
 *
 * @param callerId - UUID of the admin user making the request.
 * @returns The admin's onboarding status.
 */
async function getAdminOnboardingStatus(callerId: string): Promise<OnboardingStatus> {
  const [userResult, settingsResult, smtpResult, countsResult] = await Promise.all([
    pool.query<{ onboarding_completed: boolean }>(
      'SELECT onboarding_completed FROM users WHERE id = $1 LIMIT 1',
      [callerId],
    ),
    pool.query<SystemSettingRow>(`SELECT key, value FROM system_settings WHERE key = ANY($1)`, [
      [PIPELINE_STAGES_REVIEWED_KEY],
    ]),
    pool.query<{ host: string }>('SELECT host FROM smtp_configuration LIMIT 1'),
    withRlsQuery<{
      non_admin_count: string;
      contact_count: string;
      deal_count: string;
    }>((client) =>
      client.query(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE status = 'active' AND role != 'admin') AS non_admin_count,
           (SELECT COUNT(*) FROM contacts WHERE is_demo = false) AS contact_count,
           (SELECT COUNT(*) FROM deals WHERE is_demo = false) AS deal_count`,
      ),
    ),
  ]);

  const onboarding_completed = userResult.rows[0]?.onboarding_completed ?? false;
  const is_first_run = !onboarding_completed;

  const settingsMap = Object.fromEntries(settingsResult.rows.map((r) => [r.key, r.value]));
  const row = countsResult.rows[0];

  const nonAdminCount = parseInt(row?.non_admin_count ?? '0', 10);
  const contactCount = parseInt(row?.contact_count ?? '0', 10);
  const dealCount = parseInt(row?.deal_count ?? '0', 10);
  const smtpHost = smtpResult.rows[0]?.host ?? '';

  const tasks: OnboardingTask[] = [
    {
      id: 'pipeline_stages_reviewed',
      // Auto-completes when the admin explicitly marks it done via the checklist
      // (MINCRM-379); also pre-completed after any pipeline stage save.
      completed: settingsMap[PIPELINE_STAGES_REVIEWED_KEY] === 'true',
    },
    {
      id: 'team_member_invited',
      // At least one active non-admin user means someone has been invited.
      completed: nonAdminCount > 0,
    },
    {
      id: 'first_contact_added',
      completed: contactCount > 0,
    },
    {
      id: 'first_deal_created',
      completed: dealCount > 0,
    },
    {
      id: 'smtp_configured',
      completed: smtpHost.trim().length > 0,
    },
  ];

  return { is_first_run, onboarding_completed, tasks };
}

/**
 * Returns rep-specific onboarding status. Task completion is based on the
 * rep's own records (owner_id = callerId). (MINCRM-410)
 *
 * Tasks:
 *   1. first_contact_added   — rep has at least one contact
 *   2. first_account_created — rep has at least one account
 *   3. first_deal_created    — rep has at least one deal
 *   4. logged_first_activity — rep has at least one activity
 *
 * @param callerId - UUID of the rep user making the request.
 * @returns The rep's onboarding status.
 */
async function getRepOnboardingStatus(callerId: string): Promise<OnboardingStatus> {
  const result = await withRlsQuery<{
    onboarding_completed: boolean;
    contact_count: string;
    account_count: string;
    deal_count: string;
    activity_count: string;
  }>((client) =>
    client.query(
      `SELECT
         u.onboarding_completed,
         (SELECT COUNT(*) FROM contacts  WHERE owner_id = $1 AND is_demo = false) AS contact_count,
         (SELECT COUNT(*) FROM accounts  WHERE owner_id = $1 AND is_demo = false) AS account_count,
         (SELECT COUNT(*) FROM deals     WHERE owner_id = $1 AND is_demo = false) AS deal_count,
         (SELECT COUNT(*) FROM activities WHERE owner_id = $1 AND is_demo = false) AS activity_count
       FROM users u WHERE u.id = $1 LIMIT 1`,
      [callerId],
    ),
  );

  const row = result.rows[0];
  const onboarding_completed = row?.onboarding_completed ?? false;
  const is_first_run = !onboarding_completed;

  const contactCount = parseInt(row?.contact_count ?? '0', 10);
  const accountCount = parseInt(row?.account_count ?? '0', 10);
  const dealCount = parseInt(row?.deal_count ?? '0', 10);
  const activityCount = parseInt(row?.activity_count ?? '0', 10);

  const tasks: OnboardingTask[] = [
    { id: 'first_contact_added', completed: contactCount > 0 },
    { id: 'first_account_created', completed: accountCount > 0 },
    { id: 'first_deal_created', completed: dealCount > 0 },
    { id: 'logged_first_activity', completed: activityCount > 0 },
  ];

  return { is_first_run, onboarding_completed, tasks };
}

/**
 * Returns onboarding status for the calling user. Branches on role:
 * - admin → global org-wide task completion (5 tasks)
 * - rep   → per-user record ownership (4 tasks)
 * (MINCRM-256, MINCRM-379, MINCRM-410)
 *
 * @param caller - The authenticated user making the request.
 * @returns The caller's onboarding status.
 */
export async function getOnboardingStatus(caller: OnboardingCaller): Promise<OnboardingStatus> {
  if (caller.role === 'admin') {
    return getAdminOnboardingStatus(caller.id);
  }
  return getRepOnboardingStatus(caller.id);
}

/**
 * Sets the onboarding_completed flag on the caller's own user row. (MINCRM-256, MINCRM-410)
 *
 * @param callerId - UUID of the user whose flag to update.
 * @param completed - Whether onboarding has been completed.
 * @returns The persisted value.
 */
export async function setOnboardingCompleted(
  callerId: string,
  completed: boolean,
): Promise<boolean> {
  await pool.query(
    `UPDATE users
     SET onboarding_completed = $2,
         onboarding_completed_at = CASE WHEN $2 THEN now() ELSE NULL END,
         updated_at = now()
     WHERE id = $1`,
    [callerId, completed],
  );
  return completed;
}

/**
 * Marks the pipeline-stages-reviewed task as done in the setup checklist.
 * Called after the admin saves a pipeline stage change (MINCRM-379).
 */
export async function markPipelineStagesReviewed(actor: AuditActor = SYSTEM_ACTOR): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ($1, 'true', now(), $2)
     ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [PIPELINE_STAGES_REVIEWED_KEY, actorIdOrNull(actor)],
  );
}

export async function resetPipelineStagesReviewed(): Promise<void> {
  await pool.query(`DELETE FROM system_settings WHERE key = $1`, [PIPELINE_STAGES_REVIEWED_KEY]);
}

/** The key used to store the org-wide MFA enforcement setting (MINCRM-392) */
const REQUIRE_MFA_KEY = 'require_mfa';

/**
 * Returns whether MFA is required for all users org-wide. (MINCRM-392)
 */
export async function getMfaRequired(): Promise<boolean> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [REQUIRE_MFA_KEY],
  );
  return result.rows[0]?.value === 'true';
}

/**
 * Sets the org-wide MFA enforcement flag. Admin only. (MINCRM-392)
 *
 * @param required - Whether to require MFA for all users.
 * @returns The persisted value.
 */
export async function setMfaRequired(
  required: boolean,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<boolean> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [REQUIRE_MFA_KEY, String(required), actorIdOrNull(actor)],
  );
  return required;
}
