/**
 * Settings service — all database operations related to system settings.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import pool from '../db.js';
import { upsertSystemSetting } from './systemSettingsWrite.js';
import logger from '../logger.js';
import {
  SUPPORTED_LOCALES,
  NAV_LAYOUTS,
  SUPPORTED_CURRENCIES,
  EMAIL_SYNC_BACKFILL_DAYS_DEFAULT,
  emailSyncBackfillDaysSchema,
} from '@minicrm/shared/schemas/settingsSchema.js';
import { excludedDomainListSchema } from '@minicrm/shared/schemas/emailDomainSchema.js';
import type {
  SupportedLocale,
  NavLayout,
  SupportedCurrency,
} from '@minicrm/shared/schemas/settingsSchema.js';
import type { AuditActor } from './auditService.js';
import { SYSTEM_ACTOR, writeAuditEntry } from './auditService.js';
import { withRlsQuery } from './rlsContextService.js';

/** A row from the system_settings table */
interface SystemSettingRow {
  key: string;
  value: string;
  updated_at: Date;
}

/** The key used to store the default language setting */
const DEFAULT_LANGUAGE_KEY = 'default_language';

/** The key used to store the navigation layout setting */
const NAV_LAYOUT_KEY = 'nav_layout';

/** The key used to store the global email notifications enabled setting */
const EMAIL_NOTIFICATIONS_ENABLED_KEY = 'email_notifications_enabled';

/** The key used to store the default currency setting */
const DEFAULT_CURRENCY_KEY = 'default_currency';

/** The key used to store the tag creation restriction setting */
const TAGS_RESTRICT_CREATION_KEY = 'tags_restrict_creation';

/** The key used to track that the admin reviewed/saved pipeline stages */
const PIPELINE_STAGES_REVIEWED_KEY = 'pipeline_stages_reviewed';

/** The key used to store whether synced email auto-links to a contact's open deals */
const DEAL_AUTO_LINK_KEY = 'deal_auto_link';

/** The key used to store the org-wide list of domains email sync never stores */
const EMAIL_SYNC_EXCLUDED_DOMAINS_KEY = 'email_sync_excluded_domains';

/** The key used to store how far back a never-synced mailbox reads, in days */
const EMAIL_SYNC_BACKFILL_DAYS_KEY = 'email_sync_backfill_days';

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
  await upsertSystemSetting(pool, DEFAULT_LANGUAGE_KEY, language, actor);
  return language;
}

/**
 * Retrieves the current system-wide navigation layout.
 * Falls back to 'top' if the row is somehow missing.
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
 * Persists a new system-wide navigation layout.
 *
 * @param layout - One of the supported nav layout values.
 * @returns The updated layout value.
 */
export async function setNavLayout(
  layout: NavLayout,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<NavLayout> {
  await upsertSystemSetting(pool, NAV_LAYOUT_KEY, layout, actor);
  return layout;
}

/**
 * Reads a boolean system setting, falling back when its row is missing.
 *
 * Every boolean setting is stored as the text 'true' or 'false', and every reader wants
 * the same three things: the row, a default when seeding has not run, and a warning when
 * a default that should exist does not. `warnWhenMissing` is off for settings whose
 * absence is ordinary.
 */
async function getBooleanSetting(
  key: string,
  fallback: boolean,
  warnWhenMissing = true,
): Promise<boolean> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [key],
  );
  if (!result.rows[0]) {
    if (warnWhenMissing) {
      logger.warn(`system_settings row for ${key} is missing — defaulting to ${fallback}`);
    }
    return fallback;
  }
  return result.rows[0].value === 'true';
}

// ── Email notifications global toggle ───────────────────────────

/**
 * Returns whether the system-wide email notifications are enabled.
 * Defaults to true if the setting row is missing.
 *
 * @returns True when notifications are globally enabled.
 */
export async function getEmailNotificationsEnabled(): Promise<boolean> {
  return getBooleanSetting(EMAIL_NOTIFICATIONS_ENABLED_KEY, true);
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
  await upsertSystemSetting(pool, EMAIL_NOTIFICATIONS_ENABLED_KEY, String(enabled), actor);
  return enabled;
}

// ── Deal auto-link ───────────────────────────────────────────────

/**
 * Returns whether synced email auto-links to a matched contact's open deals.
 * Defaults to true if the setting row is missing.
 *
 * @returns True when the sync engine may link messages to open deals.
 */
export async function getDealAutoLink(): Promise<boolean> {
  return getBooleanSetting(DEAL_AUTO_LINK_KEY, true);
}

/**
 * Sets whether synced email auto-links to a matched contact's open deals. Admin only.
 *
 * Turning this off stops future links; it does not remove links already written, which
 * remain a record of what the engine matched at the time.
 *
 * @param enabled - Whether the sync engine may link messages to open deals.
 * @returns The persisted value.
 */
export async function setDealAutoLink(
  enabled: boolean,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<boolean> {
  await upsertSystemSetting(pool, DEAL_AUTO_LINK_KEY, String(enabled), actor);
  return enabled;
}

// ── Email sync governance ────────────────────────────────────────

/**
 * Reads one email sync setting's raw value, or null when its row is missing.
 *
 * The parsers below take no fallback for a value that is present but wrong.
 * The sync engine reads them to decide what never to store, and exclusion only works
 * forward: defaulting a corrupt list to empty would store excluded mail and advance the
 * cursor past it, with no way back. Throwing instead makes the engine skip the tick.
 */
async function getEmailSyncSettingValue(key: string): Promise<string | null> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [key],
  );
  return result.rows[0]?.value ?? null;
}

/** Thrown when a stored email sync setting cannot be read as its schema says. */
function malformedSetting(key: string): Error {
  return Object.assign(new Error(`system_settings.${key} holds a malformed value`), {
    code: 'MALFORMED_SETTING',
  });
}

/**
 * Parses the stored org-wide domain list. Empty when the row is missing.
 *
 * @throws MALFORMED_SETTING when the value is not a valid domain list.
 */
export function parseEmailSyncExcludedDomains(raw: string | null): string[] {
  if (raw === null) return [];
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw malformedSetting(EMAIL_SYNC_EXCLUDED_DOMAINS_KEY);
  }
  const parsed = excludedDomainListSchema.safeParse(parsedJson);
  if (!parsed.success) throw malformedSetting(EMAIL_SYNC_EXCLUDED_DOMAINS_KEY);
  return parsed.data;
}

/**
 * Parses the stored backfill window in days. The shared default when the row is missing.
 *
 * @throws MALFORMED_SETTING when the value is not a whole number in range.
 */
export function parseEmailSyncBackfillDays(raw: string | null): number {
  if (raw === null) return EMAIL_SYNC_BACKFILL_DAYS_DEFAULT;
  // Number() accepts '' and padded text, so require bare digits first.
  if (!/^\d+$/.test(raw)) throw malformedSetting(EMAIL_SYNC_BACKFILL_DAYS_KEY);
  const parsed = emailSyncBackfillDaysSchema.safeParse({ days: Number(raw) });
  if (!parsed.success) throw malformedSetting(EMAIL_SYNC_BACKFILL_DAYS_KEY);
  return parsed.data.days;
}

/** Returns the org-wide domains email sync never stores; see parseEmailSyncExcludedDomains. */
export async function getEmailSyncExcludedDomains(): Promise<string[]> {
  return parseEmailSyncExcludedDomains(
    await getEmailSyncSettingValue(EMAIL_SYNC_EXCLUDED_DOMAINS_KEY),
  );
}

/** Returns how far back a never-synced mailbox reads; see parseEmailSyncBackfillDays. */
export async function getEmailSyncBackfillDays(): Promise<number> {
  return parseEmailSyncBackfillDays(await getEmailSyncSettingValue(EMAIL_SYNC_BACKFILL_DAYS_KEY));
}

/**
 * Writes one email sync setting and its audit entry in a single transaction, so a change is
 * never stored unaudited. Writing the value already stored changes nothing.
 */
async function writeEmailSyncSetting(
  key: string,
  label: string,
  storedValue: string,
  actor: AuditActor,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query<{ value: string }>(
      'SELECT value FROM system_settings WHERE key = $1 FOR UPDATE',
      [key],
    );
    const oldValue = previous.rows[0]?.value ?? null;
    if (oldValue === storedValue) {
      await client.query('COMMIT');
      return;
    }
    await upsertSystemSetting(client, key, storedValue, actor);
    await writeAuditEntry(client, {
      recordType: 'system_settings',
      recordName: label,
      eventType: 'updated',
      fieldName: label,
      oldValue,
      newValue: storedValue,
      changedById: actor.id,
      changedByName: actor.name,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Replaces the org-wide domains email sync never stores. Admin only.
 *
 * @param domains - Already normalized by excludedDomainListSchema.
 * @returns The list as stored.
 */
export async function setEmailSyncExcludedDomains(
  domains: readonly string[],
  actor: AuditActor,
): Promise<string[]> {
  await writeEmailSyncSetting(
    EMAIL_SYNC_EXCLUDED_DOMAINS_KEY,
    'Email Sync Excluded Domains',
    JSON.stringify(domains),
    actor,
  );
  return [...domains];
}

/**
 * Sets how far back a never-synced mailbox reads, in days. Admin only.
 *
 * @param days - Already bounded by emailSyncBackfillDaysSchema.
 * @returns The window as stored.
 */
export async function setEmailSyncBackfillDays(days: number, actor: AuditActor): Promise<number> {
  await writeEmailSyncSetting(
    EMAIL_SYNC_BACKFILL_DAYS_KEY,
    'Email Sync Backfill Window (days)',
    String(days),
    actor,
  );
  return days;
}

// ── Default currency ─────────────────────────────────────────────

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
 * Persists a new system-wide default currency. Admin only.
 *
 * @param currency - One of the supported ISO 4217 currency codes.
 * @returns The updated currency code.
 */
export async function setDefaultCurrency(
  currency: SupportedCurrency,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SupportedCurrency> {
  await upsertSystemSetting(pool, DEFAULT_CURRENCY_KEY, currency, actor);
  return currency;
}

// ── Tag creation restriction ─────────────────────────────────────

/**
 * Returns whether tag creation is restricted to the Tag Management page.
 * Defaults to false if the setting row is missing.
 *
 * @returns True when tag creation is restricted to admins only.
 */
export async function getTagsRestrictCreation(): Promise<boolean> {
  // Absence is ordinary here: the row is seeded false and nothing depends on it existing.
  return getBooleanSetting(TAGS_RESTRICT_CREATION_KEY, false, false);
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
  await upsertSystemSetting(pool, TAGS_RESTRICT_CREATION_KEY, String(restricted), actor);
  return restricted;
}

// ── Default timezone ─────────────────────────────────────────────

/** The key used to store the default display timezone setting */
const DEFAULT_TIMEZONE_KEY = 'default_timezone';

/**
 * Retrieves the current system-wide default display timezone.
 * Falls back to 'UTC' if the row is missing.
 *
 * @returns The stored IANA timezone identifier.
 */
export async function getDefaultTimezone(): Promise<string> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [DEFAULT_TIMEZONE_KEY],
  );
  if (!result.rows[0]) {
    logger.warn('system_settings row for default_timezone is missing — falling back to UTC');
    return 'UTC';
  }
  return result.rows[0].value;
}

/**
 * Persists a new system-wide default display timezone. Admin only.
 *
 * @param timezone - A valid IANA timezone identifier (validated by the caller's Zod schema).
 * @returns The updated timezone identifier.
 */
export async function setDefaultTimezone(
  timezone: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<string> {
  await upsertSystemSetting(pool, DEFAULT_TIMEZONE_KEY, timezone, actor);
  return timezone;
}

// ── Onboarding / Setup Checklist ────────

/** Completion status for one setup checklist task */
export interface OnboardingTask {
  id: string;
  completed: boolean;
}

/** Shape returned by the onboarding status query */
export interface OnboardingStatus {
  is_first_run: boolean;
  onboarding_completed: boolean;
  /** Per-task completion, determined server-side */
  tasks: OnboardingTask[];
}

/** Caller identity required for per-user onboarding status */
export interface OnboardingCaller {
  id: string;
  role: 'admin' | 'rep';
}

/**
 * Returns admin-specific onboarding status. Task completion is based on
 * global (org-wide) counts. The onboarding_completed flag is read from the
 * caller's own user row.
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
      // also pre-completed after any pipeline stage save.
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
 * rep's own records (owner_id = callerId).
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
 * Sets the onboarding_completed flag on the caller's own user row.
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
 * Called after the admin saves a pipeline stage change.
 */
export async function markPipelineStagesReviewed(actor: AuditActor = SYSTEM_ACTOR): Promise<void> {
  await upsertSystemSetting(pool, PIPELINE_STAGES_REVIEWED_KEY, 'true', actor);
}

export async function resetPipelineStagesReviewed(): Promise<void> {
  await pool.query(`DELETE FROM system_settings WHERE key = $1`, [PIPELINE_STAGES_REVIEWED_KEY]);
}

/** The key used to store the org-wide MFA enforcement setting */
const REQUIRE_MFA_KEY = 'require_mfa';

/**
 * Returns whether MFA is required for all users org-wide.
 */
export async function getMfaRequired(): Promise<boolean> {
  return getBooleanSetting(REQUIRE_MFA_KEY, false, false);
}

/**
 * Sets the org-wide MFA enforcement flag. Admin only.
 *
 * @param required - Whether to require MFA for all users.
 * @returns The persisted value.
 */
export async function setMfaRequired(
  required: boolean,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<boolean> {
  await upsertSystemSetting(pool, REQUIRE_MFA_KEY, String(required), actor);
  return required;
}
