# gRPC / ConnectRPC Layer

ConnectRPC service mounted on the same port as REST via `expressConnectMiddleware` (MINCRM-377).

## Files

| Path                                                | Purpose                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `server/src/grpc/proto/audit.proto`                 | Proto definition — `ListAuditEvents` (unary) + `StreamAuditEvents` (server-streaming)          |
| `shared/generated/audit_pb.ts` + `audit_connect.ts` | Generated — committed; regenerate with `npm run generate:proto`                                |
| `server/src/grpc/auditConnectService.ts`            | Service handler — auth reads JWT from httpOnly cookie or `Authorization: Bearer`               |
| `client/src/grpc/auditClient.ts`                    | Browser client — `@connectrpc/connect-web`; cookie auth forwarded automatically on same-origin |
| `qa/e2e/apps/minicrm/grpc/auditGrpcClient.ts`       | E2E client — Connect JSON POST to `E2E_API_URL` with `Authorization: Bearer <jwt>`             |

## Mounting

In `app.ts`, before REST routes:

```ts
expressConnectMiddleware({ routes: registerAuditService, requestPathPrefix: '/api' });
```

## Audit Event Bus

`services/auditEventBus.ts` subscribes to the `audit_events` pg channel (populated by the `audit_log_after_insert` trigger via `pg_notify`). `auditEventBus.start(pool)` is called in `server.ts` before the HTTP bind and shuts down on SIGTERM.

## Regenerating Protos

```bash
npm run generate:proto
```

Requires `@bufbuild/buf` (installed as a dev dependency). Outputs to `shared/generated/`.
