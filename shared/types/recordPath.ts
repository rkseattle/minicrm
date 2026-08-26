/**
 * Client route paths for linkable records.
 *
 * Both workspaces build links to record detail pages — the server for
 * notification emails and in-app notification rows, the client for every list
 * and detail view. Before this module each site wrote the path by hand, and one
 * of them (a bulk-reassignment notification) pointed at `/activities/:id`, which
 * the router does not declare: the catch-all silently redirected the recipient
 * to the dashboard, so the link looked like it worked.
 *
 * Nothing can be wrong about a `string`, so the path is derived from a union
 * instead, and recordPath.test.ts asserts every member resolves to a route
 * App.tsx actually declares.
 *
 * Lives here rather than in shared/schemas/ because it is not a Zod schema —
 * see CLAUDE.md's Project Layout table for what shared/types/ is for.
 */

/** Record types that have a client route to link to. */
export const RECORD_LINK_TYPES = ['contact', 'account', 'deal', 'lead', 'activity'] as const;

export type RecordLinkType = (typeof RECORD_LINK_TYPES)[number];

/**
 * Route per record type, and whether it addresses the record or its collection.
 *
 * `activity` is the odd one out: no activity detail route exists, so its link
 * lands on the filtered list. `/activities/:id/brief` does exist but renders an
 * AI pre-meeting brief behind a feature flag, which is not where "your activity
 * was reassigned" should land. One structure rather than a prefix map plus a
 * separate exception set, so the two cannot disagree about a type.
 */
const ROUTE: Readonly<Record<RecordLinkType, { prefix: string; takesId: boolean }>> = {
  contact: { prefix: '/contacts', takesId: true },
  account: { prefix: '/accounts', takesId: true },
  deal: { prefix: '/deals', takesId: true },
  lead: { prefix: '/leads', takesId: true },
  activity: { prefix: '/activities', takesId: false },
};

/**
 * The client route for one record.
 *
 * @param type - The record's type.
 * @param id - The record's UUID.
 * @returns A path the router declares.
 */
export function recordPath(type: RecordLinkType, id: string): string {
  const route = ROUTE[type];
  // Only reachable when an unvalidated runtime value was cast into the union.
  if (!route) throw new Error(`recordPath: no route for record type '${String(type)}'`);
  return route.takesId ? `${route.prefix}/${id}` : route.prefix;
}

/** Narrows an arbitrary string to a linkable record type. */
export function isRecordLinkType(value: string | null | undefined): value is RecordLinkType {
  return (RECORD_LINK_TYPES as readonly (string | null | undefined)[]).includes(value);
}

/**
 * The client route for one record, or null when there is nothing to link to.
 *
 * Read paths take the type and id from a nullable join, so the absent case is
 * ordinary rather than exceptional and belongs here instead of at each caller.
 *
 * @param type - The record's type, or null.
 * @param id - The record's UUID, or null.
 * @returns A path the router declares, or null.
 */
export function recordPathOrNull(
  type: string | null | undefined,
  id: string | null | undefined,
): string | null {
  // Accepts `string`, not the union: every caller reads a text column whose type is
  // asserted by a pool.query generic, not checked, so the narrowing belongs here
  // rather than at each call site where it can be omitted.
  if (!id || !isRecordLinkType(type)) return null;
  return recordPath(type, id);
}
