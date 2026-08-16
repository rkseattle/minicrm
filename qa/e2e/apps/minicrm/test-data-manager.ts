/**
 * TestDataManager — surgical test data lifecycle tracking.
 *
 * Tracks entity IDs created during a test's setup phase and deletes them in
 * reverse registration order during teardown. Only registered records are
 * touched — pre-existing data is never modified or deleted.
 *
 * Never issues bulk deletes, table truncations, or any operation that could
 * affect unregistered records. One REST DELETE per registered entity, in
 * reverse order, with isolated error handling so a single failure cannot
 * prevent remaining cleanup.
 *
 * Scoped per test — one instance per test, created in the app-level fixture
 * and passed to setup helpers. Not safe for concurrent use within a single
 * test.
 *
 * MINCRM-129
 */

import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single registered entity entry.
 */
interface EntityEntry {
  kind: 'delete';
  /** Human-readable label for log output (e.g. 'contact', 'deal'). */
  entityType: string;
  /** The entity's primary key. */
  id: string | number;
  /**
   * The REST path used to delete this entity (e.g. `/api/contacts/42`).
   * Helpers are responsible for constructing the correct path — TestDataManager
   * never infers routes from entity types.
   */
  deletePath: string;
}

/**
 * A custom teardown action registered via registerCustomTeardown.
 * Used for operations that are not simple REST DELETEs — e.g. user deactivation
 * via PATCH, or multi-step cleanup sequences.
 */
interface CustomEntry {
  kind: 'custom';
  /** Human-readable label for log output (e.g. 'user-deactivate'). */
  label: string;
  /**
   * Async teardown callback. Throwing is how it reports failure: `teardown()`
   * catches per entry, records `success: false`, logs, and continues with the
   * remaining entries. Swallow only the errors that mean cleanup already
   * happened — anything else hides a leaked record. (MINCRM-668)
   */
  fn: () => Promise<void>;
}

/**
 * Result record from a single teardown delete attempt.
 */
export interface TeardownResult {
  /** Entity type label. */
  entityType: string;
  /** Entity ID. */
  id: string | number;
  /** true if the delete succeeded (2xx), false on any error. */
  success: boolean;
  /** Error message if success is false. */
  error?: string;
}

// ---------------------------------------------------------------------------
// TestDataManager
// ---------------------------------------------------------------------------

/**
 * Manages test data lifecycle: register during setup, delete during teardown.
 *
 * Usage:
 * ```ts
 * // In a setup helper:
 * const contact = await restClient.post<Contact>('/api/contacts', payload);
 * testData.register('contact', contact.body.id, `/api/contacts/${contact.body.id}`);
 * return contact.body;
 *
 * // Teardown is wired automatically by the app-level fixture.
 * ```
 */
export class TestDataManager {
  /** Entities and custom callbacks registered for cleanup, in insertion order. */
  private readonly entries: Array<EntityEntry | CustomEntry> = [];

  /**
   * Registers an entity for cleanup during teardown.
   *
   * Must be called immediately after an entity is successfully created so that
   * teardown can clean it up even if the test fails before setup completes.
   *
   * @param entityType - Human-readable label (e.g. 'contact', 'deal').
   * @param id - Primary key of the created entity.
   * @param deletePath - REST path for the DELETE request (e.g. `/api/contacts/42`).
   */
  register(entityType: string, id: string | number, deletePath: string): void {
    this.entries.push({ kind: 'delete', entityType, id, deletePath });
  }

  /**
   * Registers an async cleanup callback to run during teardown.
   *
   * Use this for cleanup that cannot be expressed as a simple REST DELETE —
   * for example, deactivating a user via PATCH /api/v1/users/:id/deactivate.
   * Callbacks are executed in reverse registration order, interleaved with
   * standard entity deletes.
   *
   * Throwing is how the callback reports failure: errors are caught per entry,
   * recorded as `success: false`, logged, and do not abort subsequent cleanup
   * steps. A callback that swallows its own errors reports successful cleanup
   * while the record leaks — swallow only what means the record is already
   * gone. (MINCRM-668)
   *
   * @param label - Human-readable label for log output (e.g. 'user-deactivate').
   * @param fn - Async teardown callback.
   */
  registerCustomTeardown(label: string, fn: () => Promise<void>): void {
    this.entries.push({ kind: 'custom', label, fn });
  }

  /**
   * Number of entities currently registered for teardown.
   */
  get count(): number {
    return this.entries.length;
  }

  /**
   * Deletes all registered entities in reverse registration order.
   *
   * Iterates the entries in reverse so that dependents (created later) are
   * deleted before their dependencies (created earlier). A failure on any
   * single delete is logged to stderr and does not prevent the remaining
   * deletes from running. Partial failure is the expected behavior when a
   * cascade has already removed a child entity.
   *
   * After teardown completes (successfully or not), the internal registry is
   * cleared so that a second call is a safe no-op.
   *
   * @param client - RestClient instance authenticated as a user with delete
   *   permission for all registered entities.
   * @returns Array of TeardownResult, one per registered entity, in the order
   *   they were deleted (reverse of registration).
   */
  async teardown(client: RestClient): Promise<TeardownResult[]> {
    // Snapshot and clear immediately so re-entrant calls are no-ops.
    const toDelete = [...this.entries].reverse();
    this.entries.length = 0;

    const results: TeardownResult[] = [];

    for (const entry of toDelete) {
      if (entry.kind === 'custom') {
        try {
          await entry.fn();
          results.push({ entityType: entry.label, id: '(custom)', success: true });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[TestDataManager] custom teardown failed for "${entry.label}": ${message}`,
          );
          results.push({ entityType: entry.label, id: '(custom)', success: false, error: message });
        }
      } else {
        try {
          await client.delete(entry.deletePath);
          results.push({ entityType: entry.entityType, id: entry.id, success: true });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          // Log but do not rethrow — partial failure must not abort remaining cleanup.
          console.error(
            `[TestDataManager] teardown failed for ${entry.entityType} id=${entry.id} ` +
              `path=${entry.deletePath}: ${message}`,
          );
          results.push({
            entityType: entry.entityType,
            id: entry.id,
            success: false,
            error: message,
          });
        }
      }
    }

    return results;
  }
}
