/**
 * AI session service — creates, retrieves, and deletes multi-session AI conversations,
 * and orchestrates the send-message flow (user message → Claude → assistant response).
 *
 * All writes are transactional with audit entries. The Anthropic SDK call happens
 * inside the transaction so a failed message write rolls back the user turn too.
 *
 * In E2E environments (E2E=true) the Anthropic SDK call is replaced by a deterministic
 * stub response so that test runs never consume real API tokens.
 * (MINCRM-420, MINCRM-421)
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import { decryptVersioned } from './cryptoService.js';
import { recordTokenUsage } from './aiTokenBudgetService.js';
import type {
  AiSessionResponse,
  AiMessageResponse,
  AiSessionWithMessagesResponse,
} from '@minicrm/shared/schemas/aiSessionSchema.js';

// ── Row types ──────────────────────────────────────────────────────────────────

interface AiSessionRow {
  id: string;
  user_id: string;
  name: string | null;
  created_at: Date;
  updated_at: Date;
}

interface AiMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
}

// ── E2E stub ───────────────────────────────────────────────────────────────────

const IS_E2E = process.env.E2E === 'true';

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_RESPONSE = '[E2E stub response]';

// ── Serialisers ───────────────────────────────────────────────────────────────

function serialiseSession(row: AiSessionRow): AiSessionResponse {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function serialiseMessage(row: AiMessageRow): AiMessageResponse {
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: row.content,
    created_at: row.created_at.toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derives an auto-generated session name from the first user message.
 * Truncates to 60 characters and appends "…" when the content is longer.
 */
function deriveSessionName(firstUserContent: string): string {
  const trimmed = firstUserContent.trim();
  return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 60)}…`;
}

/**
 * Fetches the active AI configuration row needed to instantiate the SDK client.
 * Throws a descriptive error when AI is disabled or unconfigured.
 */
async function fetchActiveSdkConfig(client: PoolClient): Promise<{
  anthropicClient: Anthropic;
  model: string;
}> {
  const result = await client.query<AiConfigRow>(
    `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled
     FROM ai_configuration
     LIMIT 1`,
  );

  const row = result.rows[0];
  if (!row?.enabled) {
    throw Object.assign(new Error('AI features are not enabled'), { statusCode: 503 });
  }
  if (!row.api_key_encrypted || row.api_key_encrypted.trim() === '') {
    throw Object.assign(new Error('AI API key is not configured'), { statusCode: 503 });
  }

  let apiKey: string;
  try {
    apiKey = decryptVersioned(row.api_key_encrypted, row.api_key_key_version ?? 1);
  } catch {
    throw Object.assign(new Error('AI API key could not be decrypted — please re-enter it'), {
      statusCode: 503,
    });
  }

  const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
  if (row.base_url && row.base_url.trim() !== '') {
    clientOptions.baseURL = row.base_url;
  }

  return { anthropicClient: new Anthropic(clientOptions), model: row.model };
}

// ── Public service functions ───────────────────────────────────────────────────

/**
 * Returns all sessions for a user, ordered most-recently-updated first.
 */
export async function listSessions(userId: string): Promise<AiSessionResponse[]> {
  const result = await pool.query<AiSessionRow>(
    `SELECT id, user_id, name, created_at, updated_at
     FROM ai_sessions
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return result.rows.map(serialiseSession);
}

/**
 * Creates a new empty session for the user.
 * The name is initially null and auto-populated on the first message.
 */
export async function createSession(userId: string, actor: AuditActor): Promise<AiSessionResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<AiSessionRow>(
      `INSERT INTO ai_sessions (user_id)
       VALUES ($1)
       RETURNING id, user_id, name, created_at, updated_at`,
      [userId],
    );

    const session = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'ai_sessions',
      recordId: session.id,
      recordName: 'AI Session',
      eventType: 'created',
      fieldName: null,
      oldValue: null,
      newValue: session.id,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return serialiseSession(session);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns a single session with all its messages, enforcing ownership.
 * Throws a 404-tagged error if the session does not exist or belongs to another user.
 *
 * Messages are fetched only after ownership is confirmed — the JOIN ensures no
 * message rows are read for sessions belonging to a different user.
 */
export async function getSessionWithMessages(
  sessionId: string,
  userId: string,
): Promise<AiSessionWithMessagesResponse> {
  const sessionResult = await pool.query<AiSessionRow>(
    `SELECT id, user_id, name, created_at, updated_at
     FROM ai_sessions
     WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );

  const session = sessionResult.rows[0];
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 });
  }

  const messagesResult = await pool.query<AiMessageRow>(
    `SELECT id, session_id, role, content, created_at
     FROM ai_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId],
  );

  return {
    ...serialiseSession(session),
    messages: messagesResult.rows.map(serialiseMessage),
  };
}

/**
 * Deletes a session and all associated messages (cascade).
 * Enforces ownership — throws 404 when the session does not belong to the user.
 */
export async function deleteSession(
  sessionId: string,
  userId: string,
  actor: AuditActor,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkResult = await client.query<{ id: string; name: string | null }>(
      `SELECT id, name FROM ai_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId],
    );

    if (checkResult.rows.length === 0) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    const sessionName = checkResult.rows[0].name ?? sessionId;

    await client.query(`DELETE FROM ai_sessions WHERE id = $1`, [sessionId]);

    await writeAuditEntry(client, {
      recordType: 'ai_sessions',
      recordId: sessionId,
      recordName: sessionName,
      eventType: 'deleted',
      fieldName: null,
      oldValue: sessionId,
      newValue: null,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Appends a user message to the session, calls the AI provider with the full
 * conversation history, and persists the assistant reply.
 *
 * Returns the assistant AiMessageResponse so the client can optimistically
 * append it without a refetch.
 *
 * In E2E mode the Anthropic call is replaced by a stub — no tokens are consumed.
 */
export async function sendMessage(
  sessionId: string,
  userId: string,
  content: string,
  actor: AuditActor,
): Promise<AiMessageResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ownership + existence check.
    const sessionResult = await client.query<AiSessionRow>(
      `SELECT id, user_id, name, created_at, updated_at
       FROM ai_sessions
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [sessionId, userId],
    );

    if (sessionResult.rows.length === 0) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    const session = sessionResult.rows[0];
    const isFirstMessage = session.name === null;

    // Fetch prior messages to build the context window.
    const historyResult = await client.query<AiMessageRow>(
      `SELECT role, content
       FROM ai_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId],
    );

    // Insert user message.
    await client.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [sessionId, content],
    );

    // Build message array for the SDK (history + new user turn).
    const sdkMessages: Anthropic.MessageParam[] = [
      ...historyResult.rows.map((row) => ({
        role: row.role as 'user' | 'assistant',
        content: row.content,
      })),
      { role: 'user' as const, content },
    ];

    // ── Call the AI provider (or return the E2E stub) ──────────────────────

    let assistantContent: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (IS_E2E) {
      assistantContent = E2E_STUB_RESPONSE;
    } else {
      const { anthropicClient, model } = await fetchActiveSdkConfig(client);

      const response = await anthropicClient.messages.create({
        model,
        max_tokens: 4096,
        system:
          'You are a helpful AI assistant integrated into a CRM application. ' +
          'Help users understand and work with their CRM data.',
        messages: sdkMessages,
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      assistantContent = textBlock?.type === 'text' ? textBlock.text : '';
      if (!assistantContent) {
        throw Object.assign(new Error('AI provider returned no text content'), { statusCode: 502 });
      }
      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
    }

    // Insert assistant message.
    const assistantResult = await client.query<AiMessageRow>(
      `INSERT INTO ai_messages (session_id, role, content)
       VALUES ($1, 'assistant', $2)
       RETURNING id, session_id, role, content, created_at`,
      [sessionId, assistantContent],
    );

    // Auto-name the session from the first user message.
    if (isFirstMessage) {
      const derivedName = deriveSessionName(content);
      await client.query(`UPDATE ai_sessions SET name = $1, updated_at = now() WHERE id = $2`, [
        derivedName,
        sessionId,
      ]);
    } else {
      await client.query(`UPDATE ai_sessions SET updated_at = now() WHERE id = $1`, [sessionId]);
    }

    await writeAuditEntry(client, {
      recordType: 'ai_sessions',
      recordId: sessionId,
      recordName: session.name ?? sessionId,
      eventType: 'updated',
      fieldName: 'message_sent',
      oldValue: null,
      newValue: assistantResult.rows[0].id,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    // Record token usage fire-and-forget (outside tx, errors swallowed).
    if (!IS_E2E && (inputTokens > 0 || outputTokens > 0)) {
      void recordTokenUsage(userId, inputTokens, outputTokens);
    }

    return serialiseMessage(assistantResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof Anthropic.AuthenticationError) {
      logger.error({ err }, 'AI authentication error — check the API key in admin settings');
      throw Object.assign(new Error('AI provider authentication failed'), { statusCode: 502 });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      logger.error({ err }, 'AI connection error — check base URL and network');
      throw Object.assign(new Error('Could not reach the AI provider'), { statusCode: 502 });
    }
    if (err instanceof Anthropic.APIError) {
      logger.error({ err }, `AI API error ${err.status}`);
      throw Object.assign(new Error(`AI provider error: ${err.message}`), { statusCode: 502 });
    }
    throw err;
  } finally {
    client.release();
  }
}
