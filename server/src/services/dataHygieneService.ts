/**
 * Data hygiene assistant service — nightly scan for stale, incomplete, and
 * potentially invalid contact/account/opportunity records.
 *
 * runDataHygieneScan() is the cron entry point (server/src/server.ts) and is
 * also reused directly by the manual "run scan now" admin endpoint, following
 * retentionService.ts's purgeAiSessions() precedent (same function, no
 * separate code path). Every signal gatherer is a single SQL aggregate query
 * (no AI call anywhere in this feature) — findings are upserted into
 * data_hygiene_findings and any finding the scan no longer detects is deleted,
 * so the queue always reflects current state rather than accumulating stale
 * rows.
 *
 * Findings ARE exposed as an NLI tool (server/src/ai/tools/adminTools.ts),
 * per the ticket's explicit requirement — unlike rep coaching insights, which
 * are deliberately excluded from NLI for privacy.
 */

import dns from 'dns';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { SYSTEM_ACTOR, writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import { mergeContacts } from './contactService.js';
import { assertUrlIsFetchSafe, UrlNotSafeError } from '../utils/urlSafetyUtils.js';
import { scoreDuplicateMatch } from './duplicateMatchService.js';
import type {
  DataHygieneEntityType,
  DataHygieneIssueType,
  DataHygieneFinding,
  DataHygieneConfigResponse,
} from '@minicrm/shared/schemas/dataHygieneSchema.js';
import type { SetDataHygieneConfigInput } from '@minicrm/shared/schemas/dataHygieneSchema.js';

export interface HygieneConfig {
  contact_inactivity_days: number;
  account_inactivity_days: number;
  title_staleness_days: number;
  opportunity_inactivity_days: number;
  dismiss_suppression_days: number;
  weekly_digest_enabled: boolean;
}

export async function getHygieneConfig(): Promise<HygieneConfig> {
  const result = await pool.query<HygieneConfig>(
    `SELECT contact_inactivity_days, account_inactivity_days, title_staleness_days,
            opportunity_inactivity_days, dismiss_suppression_days, weekly_digest_enabled
     FROM data_hygiene_scoring_config
     LIMIT 1`,
  );
  // Safe: singleton row seeded by migration 155, id = true is a NOT NULL PK.
  return result.rows[0]!;
}

/** One raw finding gathered by a signal query, before persistence. */
export interface RawFinding {
  entityType: DataHygieneEntityType;
  entityId: string;
  issueType: DataHygieneIssueType;
  ownerId: string;
  lastActivityAt: Date | null;
  suggestedAction: string;
  /** Only set for 'contact_duplicate' findings — the matched counterpart contact's ID. */
  relatedEntityId?: string;
}

// ── Contact signal gatherers ─────────────────────────────────────────────────

async function gatherContactNoActivity(inactivityDays: number): Promise<RawFinding[]> {
  const result = await pool.query<{
    id: string;
    owner_id: string;
    last_activity_at: Date | null;
  }>(
    `SELECT c.id, c.owner_id, MAX(a.created_at) AS last_activity_at
     FROM contacts c
     LEFT JOIN activities a ON a.contact_id = c.id
     GROUP BY c.id, c.owner_id
     HAVING MAX(a.created_at) IS NULL OR MAX(a.created_at) < now() - ($1 || ' days')::interval`,
    [inactivityDays],
  );
  return result.rows.map((row) => ({
    entityType: 'contact',
    entityId: row.id,
    issueType: 'contact_no_activity',
    ownerId: row.owner_id,
    lastActivityAt: row.last_activity_at,
    suggestedAction: 'Log a call or email, or archive if no longer relevant.',
  }));
}

async function gatherContactMissingContactInfo(): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id FROM contacts
     WHERE (email IS NULL OR email = '') OR (phone IS NULL OR phone = '')`,
  );
  return result.rows.map((row) => ({
    entityType: 'contact',
    entityId: row.id,
    issueType: 'contact_missing_contact_info',
    ownerId: row.owner_id,
    lastActivityAt: null,
    suggestedAction: 'Add the missing email or phone number.',
  }));
}

async function gatherContactStaleTitle(titleStalenessDays: number): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id FROM contacts
     WHERE title IS NOT NULL
       AND COALESCE(title_updated_at, created_at) < now() - ($1 || ' days')::interval`,
    [titleStalenessDays],
  );
  return result.rows.map((row) => ({
    entityType: 'contact',
    entityId: row.id,
    issueType: 'contact_stale_title',
    ownerId: row.owner_id,
    lastActivityAt: null,
    suggestedAction: 'Confirm the contact’s current job title.',
  }));
}

/** Bounds every network probe; without one a lookup can hang for tens of seconds. */
const NETWORK_SIGNAL_TIMEOUT_MS = 5000;

/** Codes proving the domain takes no mail. Any other error means unknown, not absent. */
const DEFINITIVE_DNS_FAILURE_CODES = new Set(['ENOTFOUND', 'ENODATA']);

/** `unknown` is not `no-mail`: a resolver that fails to answer is not evidence. */
export type MailDomainStatus = 'accepts-mail' | 'no-mail' | 'unknown';

/** Reserved domains (RFC 2606/6761) never resolve; flagging seed data is noise. */
const RESERVED_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
  'example.edu',
  'test',
  'invalid',
  'localhost',
]);

/**
 * RFC 2606/6761 reserve these names *and everything under them*, so this must match
 * on suffix. Exact-set membership alone misses the seed data it exists to protect:
 * the demo fixtures use `acme-demo.example.com`, whose MX lookup answers ENODATA —
 * which is definitive, so every demo contact would be flagged as having a dead domain.
 *
 * Guards both network signals. A reserved name is guaranteed not to resolve, so treating
 * NXDOMAIN as proof of a dead site reports our own fixtures as a customer's defect.
 */
function isReservedDomain(domain: string): boolean {
  return [...RESERVED_DOMAINS].some(
    (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
  );
}

export async function resolveMailDomainStatus(email: string): Promise<MailDomainStatus> {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) return 'no-mail';
  if (isReservedDomain(domain)) return 'accepts-mail';
  try {
    const records = await withTimeout(dns.promises.resolveMx(domain), NETWORK_SIGNAL_TIMEOUT_MS);
    // RFC 7505 null MX: an empty exchange means the domain takes no mail,
    // so a record count alone would report it as healthy.
    const acceptsMail = records.some((record) => record.exchange.trim() !== '');
    return acceptsMail ? 'accepts-mail' : 'no-mail';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && DEFINITIVE_DNS_FAILURE_CODES.has(code)) return 'no-mail';
    logger.warn({ err, domain }, 'dataHygiene: MX lookup inconclusive — not flagging');
    return 'unknown';
  }
}

/** Stops waiting after ms. The work itself is not cancellable — DNS has no abort signal. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function gatherContactUnresolvableEmailDomain(): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string; email: string }>(
    `SELECT id, owner_id, email FROM contacts WHERE email IS NOT NULL AND email != ''`,
  );

  // One lookup per domain, not per contact — cost tracks domains, not rows.
  const statusByDomain = new Map<string, Promise<MailDomainStatus>>();
  const lookup = (email: string): Promise<MailDomainStatus> => {
    const domain = email.split('@')[1]?.trim().toLowerCase() ?? '';
    const cached = statusByDomain.get(domain);
    if (cached) return cached;
    const pending = resolveMailDomainStatus(email);
    statusByDomain.set(domain, pending);
    return pending;
  };

  const findings: RawFinding[] = [];
  for (const row of result.rows) {
    try {
      // Only 'no-mail' is evidence; 'unknown' must never reach a rep as fact.
      if ((await lookup(row.email)) === 'no-mail') {
        findings.push({
          entityType: 'contact',
          entityId: row.id,
          issueType: 'contact_unresolvable_email_domain',
          ownerId: row.owner_id,
          lastActivityAt: null,
          suggestedAction: 'Verify the email address — its domain no longer accepts mail.',
        });
      }
    } catch (err) {
      // Per-record error isolation — one bad lookup must not abort the whole scan.
      logger.warn({ err, contactId: row.id }, 'dataHygiene: MX lookup failed for contact');
    }
  }
  return findings;
}

/** Groups contacts by normalized (name, company) and flags any group with more than one member. */
async function gatherContactDuplicates(): Promise<RawFinding[]> {
  const result = await pool.query<{
    id: string;
    owner_id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    company_name: string | null;
  }>(
    `SELECT c.id, c.owner_id, c.first_name, c.last_name, c.email, c.phone, a.name AS company_name
     FROM contacts c
     LEFT JOIN accounts a ON a.id = c.account_id`,
  );

  // Pre-filter by normalized (name, company) key so the O(n^2) pairwise score
  // is only ever run within a small candidate group, not across the whole table —
  // this is the difference between an occasional-name-collision-sized comparison
  // and a genuinely quadratic scan of every contact against every other contact.
  const groups = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    const key = `${row.first_name.trim().toLowerCase()}|${row.last_name.trim().toLowerCase()}|${(row.company_name ?? '').trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    // Safe: the line above guarantees `key` is present before this lookup.
    groups.get(key)!.push(row);
  }

  // The unique constraint on (entity_type, entity_id, issue_type) means each
  // contact can only ever have one contact_duplicate finding row, so once a
  // contact is flagged its related_entity_id is fixed to whichever match was
  // found first — good enough for "review and merge," which is a manual,
  // one-pair-at-a-time action regardless of how many other near-matches exist.
  //
  // Threshold is 30 (similar_name + company_match, per scoreDuplicateMatch's
  // weights), deliberately lower than duplicateExplanationService's 60+ bar for
  // a strong "likely duplicate" claim — this queue is advisory/review-only
  // (nothing auto-merges), so it should surface the AC's literal "duplicate
  // name+company combinations" signal even without a corroborating email/phone
  // match, and let the reviewer decide.
  const DUPLICATE_SCORE_THRESHOLD = 30;
  const findings: RawFinding[] = [];
  const flaggedIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const { score } = scoreDuplicateMatch(a, b);
        if (score >= DUPLICATE_SCORE_THRESHOLD) {
          for (const [record, counterpart] of [
            [a, b],
            [b, a],
          ] as const) {
            if (flaggedIds.has(record.id)) continue;
            flaggedIds.add(record.id);
            findings.push({
              entityType: 'contact',
              entityId: record.id,
              issueType: 'contact_duplicate',
              ownerId: record.owner_id,
              lastActivityAt: null,
              suggestedAction: 'Review and merge with the matching contact.',
              relatedEntityId: counterpart.id,
            });
          }
        }
      }
    }
  }
  return findings;
}

// ── Account signal gatherers ─────────────────────────────────────────────────

async function gatherAccountNoContacts(): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string }>(
    `SELECT a.id, a.owner_id FROM accounts a
     WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.account_id = a.id)`,
  );
  return result.rows.map((row) => ({
    entityType: 'account',
    entityId: row.id,
    issueType: 'account_no_contacts',
    ownerId: row.owner_id,
    lastActivityAt: null,
    suggestedAction: 'Add a primary contact for this account.',
  }));
}

async function gatherAccountNoActivity(inactivityDays: number): Promise<RawFinding[]> {
  const result = await pool.query<{
    id: string;
    owner_id: string;
    last_activity_at: Date | null;
  }>(
    `SELECT a.id, a.owner_id, MAX(act.created_at) AS last_activity_at
     FROM accounts a
     LEFT JOIN activities act ON act.account_id = a.id
     GROUP BY a.id, a.owner_id
     HAVING MAX(act.created_at) IS NULL OR MAX(act.created_at) < now() - ($1 || ' days')::interval`,
    [inactivityDays],
  );
  return result.rows.map((row) => ({
    entityType: 'account',
    entityId: row.id,
    issueType: 'account_no_activity',
    ownerId: row.owner_id,
    lastActivityAt: row.last_activity_at,
    suggestedAction: 'Log a call or email, or archive if no longer relevant.',
  }));
}

/** Mirrors MailDomainStatus: a probe that never completed is not a broken URL. */
export type WebsiteStatus = 'reachable' | 'unreachable' | 'unknown';

/**
 * Checks whether an account's website returns a non-404 response. Never throws.
 *
 * Exported for the same reason resolveMailDomainStatus is: the transport failures
 * that decide reachable/unknown cannot be produced on demand against a real network,
 * so the classification is only testable through a mocked fetch.
 */
export async function checkWebsiteStatus(url: string): Promise<WebsiteStatus> {
  // A reserved name cannot resolve by definition, so NXDOMAIN here proves nothing about
  // the site. Without this, every demo account's *.example.com website is reported as
  // broken — the same false positive isReservedDomain already prevents for mail.
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // 'unknown', not 'reachable': the name was never probed, and only 'unreachable' is
    // ever reported, so an unprobed site must not assert it is alive.
    if (isReservedDomain(hostname)) return 'unknown';
  } catch {
    // A URL the parser rejects is handled below, where invalid_url is already classified.
  }

  try {
    await assertUrlIsFetchSafe(url);
  } catch (err) {
    if (err instanceof UrlNotSafeError) {
      // A malformed or non-HTTPS URL is a defect in the stored data, and a hostname
      // that definitively does not resolve is a defect in the site — both are worth
      // reporting. Reuses the MX signal's DEFINITIVE_DNS_FAILURE_CODES so the two
      // cannot drift apart on what counts as proof that a name is gone.
      if (
        err.reason === 'invalid_url' ||
        err.reason === 'insecure_protocol' ||
        (err.dnsCode !== undefined && DEFINITIVE_DNS_FAILURE_CODES.has(err.dnsCode))
      ) {
        return 'unreachable';
      }
      // Everything else is our own uncertainty: a resolver that failed to answer, or
      // 'blocked_address', which describes where the name points rather than whether
      // the site is alive.
      logger.warn(
        { url, reason: err.reason, dnsCode: err.dnsCode },
        'dataHygiene: website safety check inconclusive — not flagging',
      );
      return 'unknown';
    }
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_SIGNAL_TIMEOUT_MS);
  try {
    // redirect: 'manual' so a 3xx response can't bypass assertUrlIsFetchSafe's
    // check by redirecting to a blocked/internal address after validation.
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });
    return response.status === 404 ? 'unreachable' : 'reachable';
  } catch (err) {
    // Only a name that does not resolve proves the site is gone. undici wraps every
    // transport failure — refused connection, TLS error, resolver outage — as the same
    // `TypeError: fetch failed`, distinguishable only by `cause.code`, so matching on
    // the error name would report our own network trouble as the customer's dead site.
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn({ url }, 'dataHygiene: website check timed out — not flagging');
      return 'unknown';
    }
    const code = (err as { cause?: NodeJS.ErrnoException }).cause?.code;
    if (code && DEFINITIVE_DNS_FAILURE_CODES.has(code)) return 'unreachable';
    logger.warn({ err, url }, 'dataHygiene: website check inconclusive — not flagging');
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}

async function gatherAccountWebsiteUnreachable(): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string; website: string }>(
    `SELECT id, owner_id, website FROM accounts WHERE website IS NOT NULL AND website != ''`,
  );

  const findings: RawFinding[] = [];
  for (const row of result.rows) {
    try {
      // Only a definite 'unreachable' is reported; see checkWebsiteStatus.
      if ((await checkWebsiteStatus(row.website)) === 'unreachable') {
        findings.push({
          entityType: 'account',
          entityId: row.id,
          issueType: 'account_website_unreachable',
          ownerId: row.owner_id,
          lastActivityAt: null,
          suggestedAction: 'Verify the account’s website URL.',
        });
      }
    } catch (err) {
      logger.warn({ err, accountId: row.id }, 'dataHygiene: website check failed for account');
    }
  }
  return findings;
}

async function gatherAccountMissingFirmographics(): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id FROM accounts
     WHERE (industry IS NULL OR industry = '') OR (employee_range IS NULL OR employee_range = '')`,
  );
  return result.rows.map((row) => ({
    entityType: 'account',
    entityId: row.id,
    issueType: 'account_missing_firmographics',
    ownerId: row.owner_id,
    lastActivityAt: null,
    suggestedAction: 'Add the missing industry or company size.',
  }));
}

// ── Opportunity (deal) signal gatherers ──────────────────────────────────────

const OPEN_STAGES_CONDITION = `d.stage NOT IN ('Closed Won', 'Closed Lost')`;

async function gatherOpportunityNoActivity(inactivityDays: number): Promise<RawFinding[]> {
  const result = await pool.query<{
    id: string;
    owner_id: string;
    last_activity_at: Date | null;
  }>(
    `SELECT d.id, d.owner_id, MAX(act.created_at) AS last_activity_at
     FROM deals d
     LEFT JOIN activities act ON act.deal_id = d.id
     WHERE ${OPEN_STAGES_CONDITION}
     GROUP BY d.id, d.owner_id
     HAVING MAX(act.created_at) IS NULL OR MAX(act.created_at) < now() - ($1 || ' days')::interval`,
    [inactivityDays],
  );
  return result.rows.map((row) => ({
    entityType: 'opportunity',
    entityId: row.id,
    issueType: 'opportunity_no_activity',
    ownerId: row.owner_id,
    lastActivityAt: row.last_activity_at,
    suggestedAction: 'Log a follow-up or update the stage.',
  }));
}

async function gatherOpportunityCloseDatePassed(): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string }>(
    `SELECT d.id, d.owner_id FROM deals d
     WHERE ${OPEN_STAGES_CONDITION} AND d.close_date IS NOT NULL AND d.close_date < CURRENT_DATE`,
  );
  return result.rows.map((row) => ({
    entityType: 'opportunity',
    entityId: row.id,
    issueType: 'opportunity_close_date_passed',
    ownerId: row.owner_id,
    lastActivityAt: null,
    suggestedAction: 'Update the close date or move the deal to a closed stage.',
  }));
}

async function gatherOpportunityNoContact(): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string }>(
    `SELECT d.id, d.owner_id FROM deals d
     WHERE ${OPEN_STAGES_CONDITION}
       AND NOT EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id)`,
  );
  return result.rows.map((row) => ({
    entityType: 'opportunity',
    entityId: row.id,
    issueType: 'opportunity_no_contact',
    ownerId: row.owner_id,
    lastActivityAt: null,
    suggestedAction: 'Associate at least one contact with this deal.',
  }));
}

async function gatherOpportunityZeroValue(): Promise<RawFinding[]> {
  const result = await pool.query<{ id: string; owner_id: string }>(
    `SELECT d.id, d.owner_id FROM deals d
     WHERE ${OPEN_STAGES_CONDITION} AND (d.value IS NULL OR d.value = 0)`,
  );
  return result.rows.map((row) => ({
    entityType: 'opportunity',
    entityId: row.id,
    issueType: 'opportunity_zero_value',
    ownerId: row.owner_id,
    lastActivityAt: null,
    suggestedAction: 'Add an estimated deal value.',
  }));
}

// ── Scan orchestration ───────────────────────────────────────────────────────

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Every signal that reaches only the database. Exported so a caller can exercise the
 * real predicates without DNS or outbound HTTP — a test that restates the SQL instead
 * stays green while the gatherer it copies drifts away from it.
 *
 * @param config - Thresholds the age-based signals compare against.
 * @returns Findings from the eleven offline signals, in gatherer order.
 */
export async function gatherOfflineHygieneSignals(config: HygieneConfig): Promise<RawFinding[]> {
  const gatherers: Array<() => Promise<RawFinding[]>> = [
    () => gatherContactNoActivity(config.contact_inactivity_days),
    () => gatherContactMissingContactInfo(),
    () => gatherContactStaleTitle(config.title_staleness_days),
    () => gatherContactDuplicates(),
    () => gatherAccountNoContacts(),
    () => gatherAccountNoActivity(config.account_inactivity_days),
    () => gatherAccountMissingFirmographics(),
    () => gatherOpportunityNoActivity(config.opportunity_inactivity_days),
    () => gatherOpportunityCloseDatePassed(),
    () => gatherOpportunityNoContact(),
    () => gatherOpportunityZeroValue(),
  ];

  const findings: RawFinding[] = [];
  for (const gather of gatherers) {
    try {
      findings.push(...(await gather()));
    } catch (err) {
      // Same per-signal isolation the scan applies: one failing query must not cost the
      // other ten their findings.
      logger.error({ err }, 'dataHygiene: offline signal gatherer failed');
    }
  }
  return findings;
}

/**
 * Nightly cron entry point (also reused by the manual "run now" admin
 * endpoint). Gathers every signal, per-signal error isolation, then
 * replaces the current findings set: upserts newly/still-detected findings
 * (preserving dismissed status/reason for findings still within their
 * suppression window) and deletes findings no longer detected.
 */
export async function runDataHygieneScan(): Promise<void> {
  const config = await getHygieneConfig();
  logger.info('dataHygiene: nightly scan starting');

  // The offline helper isolates its own eleven signals; only the two network gatherers
  // still need wrapping here — a DNS outage affecting every MX lookup must not prevent
  // the rest of the scan from being recorded.
  const networkGatherers: Array<() => Promise<RawFinding[]>> = [
    () => gatherContactUnresolvableEmailDomain(),
    () => gatherAccountWebsiteUnreachable(),
  ];

  const allFindings: RawFinding[] = await gatherOfflineHygieneSignals(config);
  for (const gather of networkGatherers) {
    try {
      allFindings.push(...(await gather()));
    } catch (err) {
      logger.error({ err }, 'dataHygiene: network signal gatherer failed');
    }
  }

  await withTransaction(async (client) => {
    const detectedKeys = new Set(
      allFindings.map((f) => `${f.entityType}:${f.entityId}:${f.issueType}`),
    );

    for (const finding of allFindings) {
      await client.query(
        `INSERT INTO data_hygiene_findings
           (entity_type, entity_id, issue_type, related_entity_id, owner_id, last_activity_at, suggested_action, status, detected_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', now(), now())
         ON CONFLICT (entity_type, entity_id, issue_type) DO UPDATE SET
           related_entity_id = EXCLUDED.related_entity_id,
           owner_id = EXCLUDED.owner_id,
           last_activity_at = EXCLUDED.last_activity_at,
           suggested_action = EXCLUDED.suggested_action,
           updated_at = now()`,
        [
          finding.entityType,
          finding.entityId,
          finding.issueType,
          finding.relatedEntityId ?? null,
          finding.ownerId,
          finding.lastActivityAt,
          finding.suggestedAction,
        ],
      );
    }

    // Clear findings the scan no longer detects — the queue reflects current
    // state, not history. Fetch existing keys first since a parameterized
    // "NOT IN this exact set" delete isn't practical for a dynamic-size set.
    //
    // Rows in a LIVE dismissal window are excluded: deleting one discards
    // dismissed_until and dismissed_reason, so the issue resurfaces as new and
    // suppression is lost. Once that window expires the row is swept like any
    // other — excluding it forever would strand a resolved finding that
    // listHygieneFindings surfaces again the moment the window lapses, with no
    // later scan able to clear it.
    const existingResult = await client.query<{
      id: string;
      entity_type: string;
      entity_id: string;
      issue_type: string;
    }>(`SELECT id, entity_type, entity_id, issue_type FROM data_hygiene_findings
        WHERE NOT (status = 'dismissed' AND dismissed_until IS NOT NULL AND dismissed_until > now())`);

    const staleIds = existingResult.rows
      .filter((row) => !detectedKeys.has(`${row.entity_type}:${row.entity_id}:${row.issue_type}`))
      .map((row) => row.id);

    if (staleIds.length > 0) {
      await client.query(`DELETE FROM data_hygiene_findings WHERE id = ANY($1::uuid[])`, [
        staleIds,
      ]);
    }

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordName: 'Data Hygiene Scan',
      eventType: 'updated',
      fieldName: 'nightly_scan',
      oldValue: null,
      newValue: `${allFindings.length} finding(s) detected, ${staleIds.length} cleared`,
      changedById: SYSTEM_ACTOR.id,
      changedByName: SYSTEM_ACTOR.name,
    });
  });

  logger.info({ findingCount: allFindings.length }, 'dataHygiene: nightly scan complete');
}

// ── Read path ────────────────────────────────────────────────────────────────

/** Resolves a human-readable name for a finding's entity, for display. */
async function resolveEntityNames(
  findings: Array<{ entity_type: string; entity_id: string }>,
): Promise<Map<string, string>> {
  const namesByKey = new Map<string, string>();

  const contactIds = findings.filter((f) => f.entity_type === 'contact').map((f) => f.entity_id);
  const accountIds = findings.filter((f) => f.entity_type === 'account').map((f) => f.entity_id);
  const dealIds = findings.filter((f) => f.entity_type === 'opportunity').map((f) => f.entity_id);

  if (contactIds.length > 0) {
    const result = await pool.query<{ id: string; first_name: string; last_name: string }>(
      `SELECT id, first_name, last_name FROM contacts WHERE id = ANY($1::uuid[])`,
      [contactIds],
    );
    for (const row of result.rows) {
      namesByKey.set(`contact:${row.id}`, `${row.first_name} ${row.last_name}`);
    }
  }
  if (accountIds.length > 0) {
    const result = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM accounts WHERE id = ANY($1::uuid[])`,
      [accountIds],
    );
    for (const row of result.rows) namesByKey.set(`account:${row.id}`, row.name);
  }
  if (dealIds.length > 0) {
    const result = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM deals WHERE id = ANY($1::uuid[])`,
      [dealIds],
    );
    for (const row of result.rows) namesByKey.set(`opportunity:${row.id}`, row.name);
  }

  return namesByKey;
}

function toFinding(
  row: {
    id: string;
    entity_type: string;
    entity_id: string;
    issue_type: string;
    related_entity_id: string | null;
    owner_id: string;
    last_activity_at: Date | null;
    suggested_action: string;
    status: string;
    dismissed_until: Date | null;
    dismissed_reason: string | null;
    detected_at: Date;
    updated_at: Date;
  },
  entityName: string,
  relatedEntityName: string | null,
): DataHygieneFinding {
  return {
    id: row.id,
    entity_type: row.entity_type as DataHygieneEntityType,
    entity_id: row.entity_id,
    entity_name: entityName,
    issue_type: row.issue_type as DataHygieneIssueType,
    related_entity_id: row.related_entity_id,
    related_entity_name: relatedEntityName,
    owner_id: row.owner_id,
    last_activity_at: row.last_activity_at?.toISOString() ?? null,
    suggested_action: row.suggested_action,
    status: row.status as 'open' | 'dismissed',
    dismissed_until: row.dismissed_until?.toISOString() ?? null,
    dismissed_reason: row.dismissed_reason,
    detected_at: row.detected_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Lists current hygiene findings. Pass ownerId to scope to a single rep's
 * own records (personal queue); pass null for the org-wide admin view.
 * Findings currently within their dismiss-suppression window are excluded,
 * matching the AC's "dismiss suppresses the record from the queue for 90 days."
 */
export async function listHygieneFindings(
  ownerId: string | null,
  entityType?: DataHygieneEntityType,
): Promise<DataHygieneFinding[]> {
  const conditions: string[] = [`(dismissed_until IS NULL OR dismissed_until < now())`];
  const params: unknown[] = [];

  if (ownerId !== null) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }
  if (entityType) {
    params.push(entityType);
    conditions.push(`entity_type = $${params.length}`);
  }

  const result = await pool.query<{
    id: string;
    entity_type: string;
    entity_id: string;
    issue_type: string;
    related_entity_id: string | null;
    owner_id: string;
    last_activity_at: Date | null;
    suggested_action: string;
    status: string;
    dismissed_until: Date | null;
    dismissed_reason: string | null;
    detected_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, entity_type, entity_id, issue_type, related_entity_id, owner_id, last_activity_at,
            suggested_action, status, dismissed_until, dismissed_reason, detected_at, updated_at
     FROM data_hygiene_findings
     WHERE ${conditions.join(' AND ')}
     ORDER BY detected_at DESC`,
    params,
  );

  const namesByKey = await resolveEntityNames(result.rows);
  // related_entity_id is only ever a contact (contact_duplicate is the only
  // issue type that sets it), so its name always comes from the "contact:" namespace.
  const relatedNamesByKey = await resolveEntityNames(
    result.rows
      .filter((r): r is typeof r & { related_entity_id: string } => r.related_entity_id !== null)
      .map((r) => ({ entity_type: 'contact', entity_id: r.related_entity_id })),
  );

  return result.rows.map((row) =>
    toFinding(
      row,
      namesByKey.get(`${row.entity_type}:${row.entity_id}`) ?? 'Unknown',
      row.related_entity_id
        ? (relatedNamesByKey.get(`contact:${row.related_entity_id}`) ?? null)
        : null,
    ),
  );
}

/**
 * Dismisses a finding for the admin-configured suppression window (default
 * 90 days). Requires a reason per the AC.
 *
 * Ownership-scoped: a non-admin caller may only dismiss a finding whose
 * owner_id matches their own id (WHERE ... AND (owner_id = $x OR admin), per
 * CLAUDE.md's ownership rule) — otherwise any rep could dismiss another
 * rep's finding by guessing/enumerating its id, defeating the scope=mine
 * boundary enforced on the list endpoint.
 */
export async function dismissHygieneFinding(
  findingId: string,
  reason: string,
  actor: AuditActor,
  isAdmin: boolean,
): Promise<void> {
  const config = await getHygieneConfig();

  await withTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE data_hygiene_findings
       SET status = 'dismissed',
           dismissed_until = now() + ($1 || ' days')::interval,
           dismissed_reason = $2,
           updated_at = now()
       WHERE id = $3 AND (owner_id = $4 OR $5)
       RETURNING id`,
      [config.dismiss_suppression_days, reason, findingId, actor.id, isAdmin],
    );
    if (result.rowCount === 0) {
      throw Object.assign(new Error('Hygiene finding not found'), { code: 'NOT_FOUND' });
    }

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordId: findingId,
      recordName: `Hygiene finding ${findingId}`,
      eventType: 'updated',
      fieldName: 'dismissed',
      oldValue: null,
      newValue: reason,
      changedById: actor.id,
      changedByName: actor.name,
    });
  });
}

/**
 * Removes hygiene findings that reference an entity being hard-deleted. Call inside the
 * deleting transaction, alongside softDeleteNotesByEntity.
 *
 * entity_id carries no foreign key, so nothing cascades. An orphan is not self-correcting:
 * the scan's sweep skips rows inside a live dismissal window, so one can outlive its
 * record by the suppression period and then surface in the queue — and to the AI tool —
 * under the placeholder name "Unknown". related_entity_id is matched for the same reason:
 * a duplicate finding on a surviving contact would keep pointing at the deleted one.
 *
 * @param client - Active DB client, inside the caller's transaction.
 * @param entityType - Type of the record being deleted.
 * @param entityId - Id of the record being deleted.
 */
export async function deleteFindingsForDeletedEntity(
  client: PoolClient,
  entityType: DataHygieneEntityType,
  entityId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM data_hygiene_findings
     WHERE (entity_type = $1 AND entity_id = $2) OR related_entity_id = $2`,
    [entityType, entityId],
  );
}

/**
 * Set-based counterpart for bulk deletes, which remove many rows in one statement.
 *
 * @param client - Active DB client, inside the caller's transaction.
 * @param entityType - Type of the records being deleted.
 * @param entityIds - Ids of the records being deleted.
 */
export async function deleteFindingsForDeletedEntities(
  client: PoolClient,
  entityType: DataHygieneEntityType,
  entityIds: string[],
): Promise<void> {
  if (entityIds.length === 0) return;
  await client.query(
    `DELETE FROM data_hygiene_findings
     WHERE (entity_type = $1 AND entity_id = ANY($2::uuid[]))
        OR related_entity_id = ANY($2::uuid[])`,
    [entityType, entityIds],
  );
}

/**
 * Removes the queue rows listed against one record. The record itself is untouched.
 *
 * Matches on entity_id only, so a duplicate finding held by the counterpart contact
 * survives — unlike deleteFindingsForDeletedEntity, which also clears related_entity_id
 * because there the record is going away and a pointer to it would dangle.
 *
 * Ownership-scoped: a non-admin caller may only clear findings for an entity
 * they own — otherwise any rep could clear (and thereby permanently hide)
 * another rep's finding by guessing the entity's id.
 *
 * @throws Error with code NOT_FOUND if no finding exists for this entity, or
 *   FORBIDDEN if a non-admin caller does not own the entity.
 */
export async function clearFindingsForEntity(
  entityType: DataHygieneEntityType,
  entityId: string,
  actorId: string,
  isAdmin: boolean,
): Promise<void> {
  if (!isAdmin) {
    const ownerResult = await pool.query<{ owner_id: string }>(
      `SELECT owner_id FROM data_hygiene_findings WHERE entity_type = $1 AND entity_id = $2 LIMIT 1`,
      [entityType, entityId],
    );
    const ownerId = ownerResult.rows[0]?.owner_id;
    if (ownerId === undefined) {
      throw Object.assign(new Error('No hygiene findings for this entity'), { code: 'NOT_FOUND' });
    }
    if (ownerId !== actorId) {
      throw Object.assign(new Error('Cannot clear another owner’s hygiene findings'), {
        code: 'FORBIDDEN',
      });
    }
  }

  await pool.query(`DELETE FROM data_hygiene_findings WHERE entity_type = $1 AND entity_id = $2`, [
    entityType,
    entityId,
  ]);
}

/**
 * Merges two duplicate contacts flagged by the hygiene scan, reusing the
 * existing contactService.mergeContacts rather than
 * reimplementing merge logic. Clears both contacts' hygiene findings —
 * the loser no longer exists, and the winner's duplicate finding is
 * resolved by the merge itself.
 *
 * Ownership-scoped: a non-admin caller may only merge a pair actually
 * flagged as a contact_duplicate finding they own (either side) — otherwise
 * this endpoint would let any rep merge arbitrary contacts org-wide, far
 * beyond what the hygiene queue's "review and merge your own duplicate" UI
 * exposes to them.
 *
 * @throws Error with code FORBIDDEN if a non-admin caller does not own a
 *   contact_duplicate finding naming this winner/loser pair (in either order).
 */
export async function mergeDuplicateContactFindings(
  winnerId: string,
  loserId: string,
  actor: AuditActor,
  isAdmin: boolean,
): Promise<void> {
  if (!isAdmin) {
    const findingResult = await pool.query<{ owner_id: string }>(
      `SELECT owner_id FROM data_hygiene_findings
       WHERE entity_type = 'contact' AND issue_type = 'contact_duplicate'
         AND owner_id = $1
         AND ((entity_id = $2 AND related_entity_id = $3) OR (entity_id = $3 AND related_entity_id = $2))
       LIMIT 1`,
      [actor.id, winnerId, loserId],
    );
    if (findingResult.rowCount === 0) {
      throw Object.assign(
        new Error('No owned contact_duplicate finding matches this winner/loser pair'),
        { code: 'FORBIDDEN' },
      );
    }
  }

  await mergeContacts({ winnerId, loserId, fieldChoices: {} }, actor);
  await pool.query(
    `DELETE FROM data_hygiene_findings WHERE entity_type = 'contact' AND entity_id = ANY($1::uuid[])`,
    [[winnerId, loserId]],
  );
}

function toConfigResponse(row: {
  contact_inactivity_days: number;
  account_inactivity_days: number;
  title_staleness_days: number;
  opportunity_inactivity_days: number;
  dismiss_suppression_days: number;
  weekly_digest_enabled: boolean;
  updated_at: Date;
  updated_by: string | null;
}): DataHygieneConfigResponse {
  return {
    contact_inactivity_days: row.contact_inactivity_days,
    account_inactivity_days: row.account_inactivity_days,
    title_staleness_days: row.title_staleness_days,
    opportunity_inactivity_days: row.opportunity_inactivity_days,
    dismiss_suppression_days: row.dismiss_suppression_days,
    weekly_digest_enabled: row.weekly_digest_enabled,
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  };
}

export async function getDataHygieneConfig(): Promise<DataHygieneConfigResponse> {
  const result = await pool.query(
    `SELECT contact_inactivity_days, account_inactivity_days, title_staleness_days,
            opportunity_inactivity_days, dismiss_suppression_days, weekly_digest_enabled,
            updated_at, updated_by
     FROM data_hygiene_scoring_config
     LIMIT 1`,
  );
  // Safe: singleton row seeded by migration 155, id = true is a NOT NULL PK.
  return toConfigResponse(result.rows[0]!);
}

export async function setDataHygieneConfig(
  params: SetDataHygieneConfigInput,
  actor: AuditActor,
): Promise<DataHygieneConfigResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeResult = await client.query<{
      contact_inactivity_days: number;
      account_inactivity_days: number;
      title_staleness_days: number;
      opportunity_inactivity_days: number;
      dismiss_suppression_days: number;
      weekly_digest_enabled: boolean;
    }>(
      `SELECT contact_inactivity_days, account_inactivity_days, title_staleness_days,
              opportunity_inactivity_days, dismiss_suppression_days, weekly_digest_enabled
       FROM data_hygiene_scoring_config
       LIMIT 1
       FOR UPDATE`,
    );
    // Safe: singleton row seeded by migration 155, id = true is a NOT NULL PK.
    const before = beforeResult.rows[0]!;

    const afterResult = await client.query(
      `UPDATE data_hygiene_scoring_config SET
         contact_inactivity_days = $1,
         account_inactivity_days = $2,
         title_staleness_days = $3,
         opportunity_inactivity_days = $4,
         dismiss_suppression_days = $5,
         weekly_digest_enabled = $6,
         updated_at = now(),
         updated_by = $7
       WHERE id = true
       RETURNING contact_inactivity_days, account_inactivity_days, title_staleness_days,
                 opportunity_inactivity_days, dismiss_suppression_days, weekly_digest_enabled,
                 updated_at, updated_by`,
      [
        params.contact_inactivity_days,
        params.account_inactivity_days,
        params.title_staleness_days,
        params.opportunity_inactivity_days,
        params.dismiss_suppression_days,
        params.weekly_digest_enabled,
        actor.id,
      ],
    );
    // Safe: UPDATE ... WHERE id = true always matches the singleton row.
    const after = afterResult.rows[0]!;

    const auditBase = {
      recordType: 'ai_settings' as const,
      recordName: 'Data Hygiene Assistant Configuration',
      changedById: actor.id,
      changedByName: actor.name,
    };

    const fieldsToCompare: Array<keyof SetDataHygieneConfigInput> = [
      'contact_inactivity_days',
      'account_inactivity_days',
      'title_staleness_days',
      'opportunity_inactivity_days',
      'dismiss_suppression_days',
      'weekly_digest_enabled',
    ];
    for (const field of fieldsToCompare) {
      const oldValue = before[field];
      const newValue = params[field];
      if (oldValue !== newValue) {
        await writeAuditEntry(client, {
          ...auditBase,
          eventType: 'updated',
          fieldName: field,
          oldValue: String(oldValue),
          newValue: String(newValue),
        });
      }
    }

    await client.query('COMMIT');
    return toConfigResponse(after);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
