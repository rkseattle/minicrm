/**
 * Concurrency behaviors — helpers for choreographed optimistic locking tests.
 *
 * These are not "user journey" behaviors like contacts.behaviors.ts. They are
 * test-utility functions that simulate the background API write that causes a
 * version mismatch, and assertion helpers for the resulting conflict UI.
 *
 * MINCRM-350
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { ConflictBannerWidget } from '@pages/minicrm/ConflictBannerWidget.js';

// ---------------------------------------------------------------------------
// Entity types supported by simulateConcurrentEdit
// ---------------------------------------------------------------------------

export type ConcurrentEditEntityType = 'contact' | 'account' | 'deal' | 'activity';

const ENTITY_API_PATH: Record<ConcurrentEditEntityType, string> = {
  contact: '/api/v1/contacts',
  account: '/api/v1/accounts',
  deal: '/api/v1/deals',
  activity: '/api/v1/activities',
};

// ---------------------------------------------------------------------------
// simulateConcurrentEdit
// ---------------------------------------------------------------------------

export interface SimulateConcurrentEditResult {
  /** The new version after the background write succeeds. */
  newVersion: number;
}

/**
 * Performs a background PATCH on the given entity, simulating a concurrent
 * write by another user. The caller supplies the current `version` so the
 * write succeeds and increments the version in the database.
 *
 * This is the "User B writes" step in the choreographed concurrency sequence.
 * Call this AFTER the UI has loaded the record (so the browser holds a stale
 * version) but BEFORE the UI submits its save.
 *
 * @param restClient - Authenticated REST client (User B's session).
 * @param entityType - The entity type to patch.
 * @param id - The entity UUID.
 * @param version - The current version the entity is at (write will succeed at this version).
 * @param fields - Field overrides to apply in the background write.
 * @returns The new version number after the background write.
 */
export async function simulateConcurrentEdit(
  restClient: RestClient,
  entityType: ConcurrentEditEntityType,
  id: string,
  version: number,
  fields: Record<string, unknown>,
): Promise<SimulateConcurrentEditResult> {
  const path = `${ENTITY_API_PATH[entityType]}/${id}`;
  const response = await restClient.patch<{ [key: string]: { version: number } }>(path, {
    ...fields,
    version,
  });

  const entityKey = entityType; // response envelope key matches entity type name
  const newVersion = response.body[entityKey]?.version;
  if (typeof newVersion !== 'number') {
    throw new Error(
      `[simulateConcurrentEdit] Unexpected response shape — could not read version from ` +
        `${entityType} PATCH response. Body: ${JSON.stringify(response.body)}`,
    );
  }

  return { newVersion };
}

// ---------------------------------------------------------------------------
// assertConflictModal
// ---------------------------------------------------------------------------

export interface AssertConflictModalResult {
  /** Whether the conflict modal was visible. */
  isVisible: boolean;
}

/**
 * Asserts that the conflict resolution modal (FieldMergeModal) is visible on
 * the current page. Returns a result object for the calling test to assert on.
 *
 * This is a thin behavior wrapper so tests keep assertions in the spec layer
 * while the locator strategy lives in ConflictBannerWidget.
 *
 * @param context - Context object containing the PageFacade.
 * @returns Whether the conflict modal was found visible.
 */
export async function assertConflictModal(context: {
  page: PageFacade;
}): Promise<AssertConflictModalResult> {
  const widget = new ConflictBannerWidget(context);
  const isVisible = await widget.isVisible();
  return { isVisible };
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap ConflictBannerWidget
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/** Fixture context for concurrency UI behaviors. */
export interface ConcurrencyBehaviorContext {
  page: PageFacade;
}

/** Returns true when the conflict resolution modal is visible. */
export async function isConflictModalVisible(
  context: ConcurrencyBehaviorContext,
): Promise<boolean> {
  return new ConflictBannerWidget(context).isVisible();
}

/** Returns a resolved locator for the conflict modal container. */
export async function getConflictModalLocator(context: ConcurrencyBehaviorContext) {
  return new ConflictBannerWidget(context).modalLocator();
}

/** Returns a resolved locator for the conflict modal title. */
export async function getConflictModalTitleLocator(context: ConcurrencyBehaviorContext) {
  return new ConflictBannerWidget(context).titleLocator();
}

/** Returns a resolved locator for the "Save resolved" button. */
export async function getConflictSaveResolvedButtonLocator(context: ConcurrencyBehaviorContext) {
  return new ConflictBannerWidget(context).saveResolvedButtonLocator();
}

/** Returns a resolved locator for the "Discard my changes" button. */
export async function getConflictDiscardButtonLocator(context: ConcurrencyBehaviorContext) {
  return new ConflictBannerWidget(context).discardButtonLocator();
}

/** Clicks "Save resolved" in the conflict modal. */
export async function clickConflictSaveResolved(
  context: ConcurrencyBehaviorContext,
): Promise<void> {
  return new ConflictBannerWidget(context).clickSaveResolved();
}

/** Clicks "Discard my changes" in the conflict modal. */
export async function clickConflictDiscard(context: ConcurrencyBehaviorContext): Promise<void> {
  return new ConflictBannerWidget(context).clickDiscard();
}

/** Selects "theirs" for the given field key in the conflict merge UI. */
export async function selectConflictTheirs(
  fieldKey: string,
  context: ConcurrencyBehaviorContext,
): Promise<void> {
  return new ConflictBannerWidget(context).selectTheirs(fieldKey);
}

/** Selects "mine" for the given field key in the conflict merge UI. */
export async function selectConflictMine(
  fieldKey: string,
  context: ConcurrencyBehaviorContext,
): Promise<void> {
  return new ConflictBannerWidget(context).selectMine(fieldKey);
}
