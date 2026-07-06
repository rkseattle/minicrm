# AI Chat Message-Send Lifecycle

Covers how `client/src/pages/AiPage.tsx` sends a message and renders the assistant's
reply. Relevant after MINCRM-602 replaced the previous two-round-trip handshake.

## Server side

`POST /api/v1/ai/sessions/:id/messages` (`aiSessionController.ts` → `aiSessionService.ts`)
is fully synchronous: it persists the user message, generates the reply (or the
deterministic `E2E_STUB_RESPONSE` when `E2E=true`), persists the assistant message, and
returns the assistant message in the response body — all within the one request. There is
no background job, polling, websocket, or SSE involved.

## Client side — single round-trip (current design)

`sendMutation` in `AiPage.tsx` sends the POST and, in `onSuccess`, commits the reply
directly into the TanStack Query cache:

```ts
queryClient.setQueryData<AiSessionWithMessagesResponse>(aiMessagesQueryKey(sessionId), (old) => {
  if (!old) return old;
  return { ...old, messages: [...old.messages, optimisticUserMessage, assistantMessage] };
});
```

This is the only network round-trip involved in showing the reply. `optimisticMessages`
(local state) is still used to render the bubble immediately while the POST is in flight,
but it is cleared synchronously in the same `onSuccess` callback once the cache write
happens — there is no second `await`ed GET before the optimistic state is cleared.

On mutation failure (`onError`), optimistic state is cleared and `sendError` is set so the
user sees a visible error instead of a silently stuck send.

## Why this replaced the previous design

The prior implementation showed the reply via `optimisticMessages` alone (never written to
the query cache), then `await`ed a **second** GET round-trip
(`queryClient.refetchQueries({ queryKey: aiMessagesQueryKey(sessionId) })`) before clearing
that state. That awaited refetch had no timeout and no error handling, so a hung or
rejected refetch left the mutation pending indefinitely with no user-visible error. Two
prior point-fixes (`4735d536`, `ca941cbc`) patched race conditions in this same handshake
without addressing the design that produced them. MINCRM-602 removed the second round-trip
entirely rather than adding a third patch.

## Session list refresh

`queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY })` is still fired
(un-awaited) after every send, since the session's `updated_at`/ordering in the sidebar can
change server-side. This is independent of the message-thread cache write above and does
not block clearing optimistic state.
