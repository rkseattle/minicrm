/**
 * ConnectRPC client for AuditService.
 *
 * Uses the Connect protocol (JSON over HTTP/1.1) so that the Vite dev-server
 * proxy can forward requests without binary-framing issues. The httpOnly session
 * cookie is forwarded automatically by the browser (credentials: 'include').
 */

import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { AuditService } from '@shared/generated/audit_connect.js';

const transport = createConnectTransport({
  // Prefixed with /api so the Vite dev-server proxy forwards these requests to Express.
  baseUrl: '/api',
  credentials: 'include',
});

export const auditClient = createClient(AuditService, transport);
