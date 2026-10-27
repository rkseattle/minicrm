/**
 * Who performs a write. Dependency-free, so scripts that must not load the database pool or
 * .env can import it; auditService re-exports it for everyone else.
 */

/**
 * Identity of the user performing a write operation.
 * Shared across all write services, through auditService's re-export or this module.
 */
export interface AuditActor {
  id: string;
  name: string;
  /** If set, audit entries written on behalf of this actor carry this source tag */
  source?: 'AI (NLI)' | 'AI (context)';
}

/** System actor used as default for seeding, migrations, and automation triggers. */
export const SYSTEM_ACTOR: AuditActor = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'System',
};

/**
 * Returns the actor's UUID for use as system_settings.updated_by.
 * SYSTEM_ACTOR writes are not attributable to a real user row, so NULL is stored
 * rather than the synthetic all-zeros UUID (which would violate the FK constraint).
 */
export function actorIdOrNull(actor: AuditActor): string | null {
  return actor.id === SYSTEM_ACTOR.id ? null : actor.id;
}
