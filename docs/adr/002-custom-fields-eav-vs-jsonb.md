# ADR-002: Custom fields — EAV storage with documented query ceiling

**Status:** Accepted
**Date:** 2026-06-08
**Ticket:** MINCRM-524
**Blocks:** MINCRM-419 (AI natural-language filtering on custom fields)

---

## Context

MiniCRM supports admin-defined custom fields on contacts, accounts, and deals. The current
implementation uses an Entity-Attribute-Value (EAV) model across two tables:

```
custom_field_definitions  (id, entity_type, name, field_type, options, sort_order)
custom_field_values       (id, definition_id, record_id, value text)
```

All values are stored as `text` regardless of the declared `field_type`
(`text`, `number`, `date`, `boolean`, `select`). This works correctly for display use
cases — values are read, formatted, and shown to the user — but it introduces hard limits
for query-time use cases that will become acute when AI-driven filtering (MINCRM-419) is
implemented.

### Query limitations of the current EAV design

**1. Type-aware filtering cannot use B-tree indexes.**

A query such as _"contacts where Annual Revenue > 50000"_ must be expressed as:

```sql
WHERE CAST(cfv.value AS numeric) > 50000
```

PostgreSQL cannot use the B-tree index on `custom_field_values.record_id` for a CAST
expression. Every such filter is a full `custom_field_values` table scan. At 10,000
contacts × 5 custom fields = 50,000 rows, this is tolerable; at 100,000 contacts × 10
fields the scan takes hundreds of milliseconds without a functional index.

_Workaround_: a functional index `CREATE INDEX ON custom_field_values ((value::numeric))`
is definition-specific — one index per numeric field — and only helps if the query
filters on exactly that field with no CAST variation. It does not compose across fields.

**2. Cross-field queries require self-joins.**

A query such as _"contacts where Industry = 'Enterprise' AND Annual Revenue > 100000"_
requires two separate joins onto `custom_field_values`:

```sql
JOIN custom_field_values cfv1 ON cfv1.record_id = c.id AND cfv1.definition_id = $industry_def_id
JOIN custom_field_values cfv2 ON cfv2.record_id = c.id AND cfv2.definition_id = $revenue_def_id
WHERE cfv1.value = 'Enterprise'
  AND CAST(cfv2.value AS numeric) > 100000
```

Each additional custom-field filter adds another self-join. Three or more custom field
conditions produce a query plan that is likely slower than a full contacts scan for
typical contact volumes.

**3. Custom-field sorting cannot be indexed.**

`ORDER BY CAST(cfv.value AS numeric)` for a paginated result set of 10,000+ contacts
requires materializing the full join result and sorting it in-memory. Pagination on
custom fields is therefore O(n) per page rather than O(log n) with a sorted index.

### The JSONB alternative

A JSONB column on each entity table — e.g. `contacts.custom_data jsonb` — stores all
custom field values for a contact in a single row. Advantages:

- **GIN index**: `CREATE INDEX ON contacts USING GIN (custom_data)` supports
  `@>` (containment) and `jsonb_path_exists` queries efficiently.
- **Type-native storage**: numeric fields stored as JSON numbers, not text — no CAST
  required. `WHERE (custom_data->>'annual_revenue')::numeric > 50000` can use a partial
  functional index on a specific path.
- **Single-row access**: reading all custom fields for a contact requires no join.
- **Cross-field queries**: all conditions apply to the same row — no self-join.

Drawbacks of JSONB:

- Field enumeration requires either a separate definitions table or scanning the JSONB
  keys across rows. The existing `custom_field_definitions` table is still needed to
  render the field list in the UI.
- Field-level constraints (required, allowed values for `select` type) are harder to
  enforce at the DB level — they remain application-enforced.
- Schema evolution (renaming a field) requires a backfill across all entity rows.
- GIN indexes are larger and slower to update than B-tree indexes.

### Benchmark: EAV vs JSONB for type-aware filter + sort (10,000 contacts × 5 fields)

The following analysis is based on PostgreSQL query plan characteristics for the current
schema, not a live pgbench run (no production data at this stage of the project).

**EAV — type-aware numeric filter + sort:**

```sql
SELECT c.id, c.first_name, c.last_name, cfv.value::numeric AS annual_revenue
FROM contacts c
JOIN custom_field_values cfv ON cfv.record_id = c.id AND cfv.definition_id = $def_id
WHERE cfv.value::numeric > 50000
ORDER BY cfv.value::numeric DESC
LIMIT 20 OFFSET 0;
```

Expected plan: index scan on `custom_field_values(record_id)` to narrow to the target
definition, then a sequential scan with CAST for the filter, then an in-memory sort.
For 10,000 contacts the sort input is ≤10,000 rows — acceptable. For 100,000 contacts
with no functional index, the sort input grows proportionally. The CAST also prevents any
page-0 optimization: every page of results re-sorts the full unfiltered set.

**JSONB — equivalent query:**

```sql
SELECT id, first_name, last_name,
       (custom_data->>'annual_revenue')::numeric AS annual_revenue
FROM contacts
WHERE (custom_data->>'annual_revenue')::numeric > 50000
ORDER BY (custom_data->>'annual_revenue')::numeric DESC
LIMIT 20 OFFSET 0;
```

With a functional index `CREATE INDEX ON contacts ((custom_data->>'annual_revenue')::numeric)`,
this query uses an index scan for the filter and an index scan for the sort — O(log n + k)
for k results rather than O(n) sort. For 100,000 contacts returning 20 rows, the
difference is 3–5× wall-clock improvement in typical benchmarks on similar query shapes.

**Verdict**: JSONB is materially faster for type-aware filter + sort at scale. The EAV
model is acceptable at current projected row counts (< 50,000 contacts) but will degrade
without remediation as the dataset grows.

---

## Decision

Retain the current EAV model (`custom_field_definitions` / `custom_field_values`) for now.
Do not migrate to JSONB columns in this story.

The EAV model is correct for the display-oriented use cases that currently consume custom
fields (rendering field values on detail pages and list views). Migrating to JSONB before
the query-heavy use case (AI filtering) is implemented would incur migration cost and risk
without immediate benefit.

Instead, document the ceiling explicitly and require the AI query generation layer
(MINCRM-419) to be built with awareness of the EAV model's constraints.

### Constraints on the AI query generation layer (MINCRM-419)

Any code that generates SQL filters on custom fields — including the AI natural-language
query engine — **must** observe the following rules:

1. **Never use bare string comparison for numeric/date fields.** Always emit an explicit
   `CAST(cfv.value AS numeric)` or `CAST(cfv.value AS date)`. String comparison on
   `'50000' > '9000'` returns false (lexicographic order).
2. **Limit cross-field custom-field joins.** More than three simultaneous custom-field
   conditions on a single query will produce a multi-self-join plan that is likely slower
   than a full contacts scan at production row counts. The AI layer must warn or refuse
   when generating such queries, or must materialize a CTE first.
3. **Custom-field sorting must be treated as O(n).** Pagination on a custom-field sort
   column must not be presented as fast. The AI layer should prefer sorting on indexed
   system columns (`created_at`, `updated_at`, owner name) unless the user explicitly
   requests a custom-field sort.
4. **No assumption of index coverage.** The AI layer must not assume that a custom field
   value is indexed. If a query plan will scan `custom_field_values` in full, the layer
   must either add query hints or surface a warning to the user about expected query time.

---

## Consequences

### What this makes easy (retaining EAV)

- No schema migration required. The existing `custom_field_definitions` and
  `custom_field_values` tables remain unchanged.
- Field enumeration, field-level metadata (label, type, sort_order, options), and
  required/validation logic remain in a first-class table queryable by the UI.
- Adding a new custom field does not require an `ALTER TABLE` on a 100,000-row entity
  table — it is a single row insert into `custom_field_definitions`.
- The E2E test suite and all existing service tests remain valid.

### What this forecloses / accepted tradeoffs

- Type-aware filtering, cross-field queries, and custom-field sorting will be slow at
  scale without per-field functional indexes, which are not currently created
  automatically.
- The AI filtering layer (MINCRM-419) must operate within the documented constraints and
  cannot naively generate arbitrary SQL filter expressions on custom fields.
- Performance-sensitive custom-field queries require manual intervention (functional
  index, materialized view, or JSONB migration) if latency thresholds are breached.

### Migration path to JSONB (if the threshold triggers are met)

1. Add `custom_data jsonb NOT NULL DEFAULT '{}'` to `contacts`, `accounts`, and `deals`
   via a three-step migration (add nullable, backfill from EAV, set NOT NULL default).
2. Create GIN indexes: `CREATE INDEX CONCURRENTLY ON contacts USING GIN (custom_data)`.
3. For each numeric or date field, add a functional index on the specific path:
   `CREATE INDEX CONCURRENTLY ON contacts (((custom_data->>'field_name')::numeric))`.
4. Update `customFieldService.ts` to read/write `custom_data` JSONB instead of
   `custom_field_values`. The definitions table is retained for field metadata.
5. Remove the `custom_field_values` table once the JSONB backfill is verified.
6. Update all service-layer queries that join `custom_field_values`. Estimated: 10–15
   query sites in `server/src/services/`.
7. Update Zod schemas and API response shapes if the serialization format changes.
8. Update E2E fixtures in `TestDataManager` to set custom fields via the new path.

### Thresholds that would trigger the migration

Supersede this ADR and begin the JSONB migration when **any** of the following is true:

- MINCRM-419 AI filtering on custom fields is actively under implementation and the
  EAV query constraints require workarounds that materially complicate the AI layer.
- A production query on `custom_field_values` for type-aware filter or sort regularly
  exceeds 500 ms at the P95 latency for the deployed dataset size.
- The `custom_field_values` table exceeds 5 million rows (proxy for > 100,000 entities
  with ≥ 5 custom fields each), causing vacuum and autovacuum pressure.
