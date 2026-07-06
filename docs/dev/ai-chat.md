# AI Chat Message-Send Lifecycle

Covers how `client/src/pages/AiPage.tsx` sends a message and renders the assistant's
reply. Relevant after MINCRM-602 replaced the previous two-round-trip handshake.

## Server side

`POST /api/v1/ai/sessions/:id/messages` (`aiSessionController.ts` → `aiSessionService.ts`)
is fully synchronous: it persists the user message, generates the reply (or the
deterministic `E2E_STUB_RESPONSE` when `E2E=true`), persists the assistant message, and
returns the assistant message in the response body — all within the one request. There is
no background job, polling, websocket, or SSE involved.

## Client side — single blocking round-trip, with a background reconciliation refetch

`sendMutation` in `AiPage.tsx` sends the POST and, in `onSuccess`, commits the reply
directly into the TanStack Query cache — synchronously, with no `await`:

```ts
queryClient.setQueryData<AiSessionWithMessagesResponse>(aiMessagesQueryKey(sessionId), (old) => {
  if (!old) return old;
  if (old.messages.some((m) => m.id === assistantMessage.id)) return old;
  return { ...old, messages: [...old.messages, optimisticUserMessage, assistantMessage] };
});
```

This is what makes the reply appear without blocking on a second round-trip.
`optimisticMessages` (local state) is still used to render the bubble immediately while the
POST is in flight, but it is cleared synchronously in the same `onSuccess` callback right
after the cache write — there is no `await`ed GET gating that clear.

The server's POST response only returns the assistant message (see above) — it does not
return the user message it just persisted. `onSuccess` therefore fabricates a placeholder
user message with an id derived from the assistant message's real id
(`optimistic-user-${assistantMessage.id}`), unique per send so that sending twice in the same
session never produces two messages sharing one id (React key collisions on
`MessageBubble`, which is keyed by message id). This placeholder is never the last word: a
plain `queryClient.invalidateQueries({ queryKey: aiMessagesQueryKey(sessionId) })` fires
un-awaited right after the cache write, letting TanStack Query silently refetch the session
in the background and replace the fabricated id with the server's real one next time the
query settles — without blocking `onSuccess` or reintroducing an awaited handshake.

Because that background refetch can occasionally settle at nearly the same instant as the
POST itself (e.g. the initial session GET on the new-session-on-demand path racing the
message POST), the cache updater also guards against appending a message whose id already
exists in the cache — otherwise the two nearly-simultaneous writes could both add the
server's assistant message and violate id uniqueness.

If the cache has no entry yet for this session (`old` is `undefined` — the initial GET
simply hasn't resolved), the updater is a no-op: there's nothing to append onto. The
messages are not lost — the un-awaited `invalidateQueries` above still fires, and the
now-enabled query populates the cache with the real, complete state once its GET resolves.

On mutation failure (`onError`), optimistic state is cleared and `sendError` is set so the
user sees a visible error instead of a silently stuck send.

## Why this replaced the previous design

The prior implementation showed the reply via `optimisticMessages` alone (never written to
the query cache), then `await`ed a **second** GET round-trip
(`queryClient.refetchQueries({ queryKey: aiMessagesQueryKey(sessionId) })`) before clearing
that state. That awaited refetch had no timeout and no error handling, so a hung or
rejected refetch left the mutation pending indefinitely with no user-visible error. Two
prior point-fixes (`4735d536`, `ca941cbc`) patched race conditions in this same handshake
without addressing the design that produced them. MINCRM-602 removed the _blocking_ nature
of the second round-trip: the reply now appears from the synchronous cache write alone, and
the reconciliation refetch (described above) happens in the background instead of gating
the UI.

## Two independent `invalidateQueries` calls

`onSuccess` fires two separate, both un-awaited, `invalidateQueries` calls — neither blocks
the UI from settling:

- `queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY })` — refreshes the
  session list sidebar, since the session's `updated_at`/ordering can change server-side.
- `queryClient.invalidateQueries({ queryKey: aiMessagesQueryKey(sessionId) })` — the
  reconciliation refetch described above, reconciling the fabricated user-message id with
  the server's real one.
