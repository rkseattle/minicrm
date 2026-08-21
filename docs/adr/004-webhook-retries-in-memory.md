# ADR-004: Webhook retries stay in memory, and the limit is documented

## Status

Accepted

## Context

`webhookService.ts` retries a failed webhook delivery up to five times, on a fixed
schedule of 5 minutes, 30 minutes, 2 hours, and 6 hours. The schedule spans roughly eight
and a half hours from the first attempt.

Each retry is scheduled with an in-process `setTimeout`. Nothing about a waiting retry is
written down: no queue table, no job row, no startup recovery pass. A restart or crash
therefore drops every retry still pending, and a deploy inside that eight-hour window is
the ordinary case rather than the exceptional one.

The drop is quiet by construction. Every attempt that _runs_ is written to
`webhook_delivery_logs`, so the abandoned event's last row records the failure that
scheduled the retry — but no row is ever written for the attempt that never happened. The
subscription also stays `active`, because the `failed` transition only fires after a fifth
attempt actually executes. From the outside, an abandoned event looks like an event whose
retry is still pending.

This was found while correcting `docs/webhooks.md`, which described the retry schedule in
terms that implied durable delivery.

## Decision

**Document the limitation; do not make retries durable.**

`docs/webhooks.md` section 6 now states that retries are in-memory, that a restart drops
them, what the drop looks like in the delivery log, and that integrators should reconcile
against `GET /api/v1/admin/webhooks/:id/logs` rather than treat the retry schedule as a
delivery guarantee.

Durable retry was considered and deliberately not built here. It requires a persistence
mechanism — an outbox table drained by a worker, or a job queue — plus a recovery pass at
startup, leader election or locking so two instances do not double-deliver, and a policy
for retries whose subscription changed while they waited. That is a design change of a
different kind and size from a documentation correction, and doing it inside a docs branch
would have shipped a new subsystem with no design review of its own.

## Consequences

**Accepted:** events can be lost silently across a deploy. An integrator who follows the
documentation and reconciles will notice; one who trusts the retry schedule will not. This
is a real correctness gap, recorded here rather than resolved.

**Easier:** the delivery path stays a single function with no infrastructure behind it, and
no operational surface — no queue to monitor, drain, or fail over.

**Harder:** the fix gets more expensive the longer it waits, because integrators will build
against the documented behaviour. Anyone adding delivery guarantees later should expect to
revisit the delivery-log contract at the same time, since the "no row for the abandoned
attempt" shape is what makes reconciliation necessary in the first place.

**Revisit when:** a subscriber needs at-least-once delivery as a contractual guarantee, or
the retry window materially exceeds the deploy interval.
