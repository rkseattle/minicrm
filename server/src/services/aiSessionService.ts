/**
 * AI session service — creates, retrieves, and deletes multi-session AI conversations,
 * and orchestrates the send-message flow (user message → Claude → assistant response).
 *
 * All writes are transactional with audit entries. The Anthropic SDK call happens
 * between two short transactions so the pool connection is released for the duration
 * of the external HTTP round-trip.
 *
 * Tool use: when the model returns stop_reason 'tool_use', each tool_use block is
 * dispatched to toolExecutor and the result appended as tool_result before the next
 * Anthropic call. The loop repeats until stop_reason is 'end_turn' or the hard cap
 * of MAX_TOOL_ROUNDS is reached.
 *
 * In E2E environments (E2E=true) the Anthropic SDK call is replaced by a deterministic
 * stub response so that test runs never consume real API tokens.
 * (MINCRM-420, MINCRM-421, MINCRM-422)
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
  AiToolResult,
} from '@minicrm/shared/schemas/aiSessionSchema.js';
import { buildToolSet, BUILTIN_ROLE_CAPABILITIES } from '../ai/tools/index.js';
import { executeToolCall } from '../ai/toolExecutor.js';
import { AI_SYSTEM_PROMPT } from '../ai/systemPrompt.js';
import { userCapabilities } from './roleService.js';
import type { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { applyPiiFilter } from '../ai/piiFilter.js';

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
  tool_results: AiToolResult[] | null;
  created_at: Date;
}

interface AiConfigRow {
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  base_url: string;
  enabled: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const IS_E2E = process.env.E2E === 'true';

/**
 * Tools whose outputs are persisted on the assistant message for native client rendering.
 * Write, export, and admin tool results are excluded — they can be large and the client
 * has no renderer for them. Must stay in sync with READ_TOOL_NAMES in NliResultBlock.tsx.
 * (MINCRM-423, MINCRM-431)
 */
const PERSISTABLE_TOOL_NAMES = new Set([
  'searchContacts',
  'getContact',
  'searchAccounts',
  'getAccount',
  'searchDeals',
  'getDeal',
  'searchActivities',
  'getActivity',
  'searchNotes',
  'getNote',
  'searchLeads',
  'getLead',
]);

/** Deterministic response returned in E2E environments instead of calling Anthropic. */
const E2E_STUB_RESPONSE = '[E2E stub response]';

/** Maximum number of tool-call rounds before aborting to prevent runaway loops. */
const MAX_TOOL_ROUNDS = 10;

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
    tool_results: row.tool_results ?? null,
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
    `SELECT id, session_id, role, content, tool_results, created_at
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
 * Appends a user message to the session, runs the agentic Claude loop
 * (tool calls resolved until end_turn or MAX_TOOL_ROUNDS), and persists
 * the final assistant reply.
 *
 * Returns the assistant AiMessageResponse so the client can optimistically
 * append it without a refetch.
 *
 * In E2E mode the Anthropic call is replaced by a stub — no tokens are consumed.
 * (MINCRM-422)
 */
export async function sendMessage(
  sessionId: string,
  userId: string,
  content: string,
  actor: AuditActor,
  userRole: string,
): Promise<AiMessageResponse> {
  // Resolve capabilities before Tx 1 so that a DB failure here aborts cleanly
  // without leaving an orphaned user message in ai_messages. In E2E mode the
  // result is unused but the query is cheap.
  //
  // Fallback: if userCapabilities() returns an empty set (e.g., built-in
  // role_capabilities rows missing due to a failed migration), merge in the
  // static BUILTIN_ROLE_CAPABILITIES snapshot for the user's legacy role so
  // the NLI tool set is never silently empty for a valid role. (MINCRM-434)
  const dbCapabilities = await userCapabilities(userId);
  const capabilities: ReadonlySet<Capability> =
    dbCapabilities.size > 0 ? dbCapabilities : new Set(BUILTIN_ROLE_CAPABILITIES[userRole] ?? []);

  // ── Tx 1: validate ownership, fetch history, insert user message ──────────
  // Commit before calling Anthropic so the pool connection is released during
  // the (potentially multi-second) external HTTP round-trip.
  let session: AiSessionRow;
  let sdkMessages: Anthropic.MessageParam[];
  let isFirstMessage: boolean;

  const client1: PoolClient = await pool.connect();
  try {
    await client1.query('BEGIN');

    const sessionResult = await client1.query<AiSessionRow>(
      `SELECT id, user_id, name, created_at, updated_at
       FROM ai_sessions
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [sessionId, userId],
    );

    if (sessionResult.rows.length === 0) {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 });
    }

    session = sessionResult.rows[0];
    isFirstMessage = session.name === null;

    const historyResult = await client1.query<AiMessageRow>(
      `SELECT role, content
       FROM ai_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId],
    );

    await client1.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [sessionId, content],
    );

    sdkMessages = [
      ...historyResult.rows.map((row) => ({
        role: row.role as 'user' | 'assistant',
        content: row.content,
      })),
      { role: 'user' as const, content },
    ];

    await client1.query('COMMIT');
  } catch (err) {
    await client1.query('ROLLBACK');
    throw err;
  } finally {
    client1.release();
  }

  // ── Agentic AI loop (outside any transaction) ──────────────────────────────
  // Pool connection is intentionally released before this block (end of Tx 1)
  // so it is available to tool calls that need their own DB queries.

  let assistantContent: string;
  let inputTokens = 0;
  let outputTokens = 0;
  const collectedToolResults: AiToolResult[] = [];

  if (IS_E2E) {
    assistantContent = E2E_STUB_RESPONSE;
  } else {
    // Fetch config with a fresh pool query — no open transaction.
    const configResult = await pool.query<AiConfigRow>(
      `SELECT model, api_key_encrypted, api_key_key_version, base_url, enabled
       FROM ai_configuration
       LIMIT 1`,
    );
    const row = configResult.rows[0];
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
    const anthropicClient = new Anthropic(clientOptions);
    const tools = buildToolSet(userRole, capabilities);

    try {
      // Agentic tool-use loop: keep calling Claude until it produces a text
      // response (stop_reason === 'end_turn') or we hit the safety cap.
      let loopMessages: Anthropic.MessageParam[] = [...sdkMessages];
      let rounds = 0;
      assistantContent = '';

      while (rounds < MAX_TOOL_ROUNDS) {
        const response = await anthropicClient.messages.create({
          model: row.model,
          max_tokens: 4096,
          system: AI_SYSTEM_PROMPT,
          tools,
          tool_choice: { type: 'auto' },
          messages: loopMessages,
        });

        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;

        if (response.stop_reason === 'end_turn') {
          const textBlock = response.content.find((b) => b.type === 'text');
          assistantContent = textBlock?.type === 'text' ? textBlock.text : '';
          break;
        }

        if (response.stop_reason === 'tool_use') {
          // Append the assistant's tool_use message to the conversation.
          loopMessages = [...loopMessages, { role: 'assistant', content: response.content }];

          // Execute each tool call sequentially to avoid write races.
          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
          const strippedFieldsManifest: Record<string, string[]> = {};
          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;
            let toolResult: unknown;
            try {
              toolResult = await executeToolCall(
                block.name,
                block.input as Record<string, unknown>,
                { actor: { ...actor, source: 'AI (NLI)' as const }, userId, userRole },
              );
            } catch (toolErr: unknown) {
              // Hard auth errors propagate; other errors become error content.
              const statusCode = (toolErr as { statusCode?: number }).statusCode;
              if (statusCode === 403 || statusCode === 401) throw toolErr;
              toolResult = { error: toolErr instanceof Error ? toolErr.message : String(toolErr) };
            }

            // Apply PII minimization before sending to the AI provider.
            // Operates on a deep copy — the original result is unchanged.
            const { sanitised, strippedFields } = applyPiiFilter(toolResult);

            // Persist results only for read tools so write/export/admin outputs
            // do not bloat stored messages with data the client cannot render.
            // (MINCRM-423, MINCRM-431)
            if (PERSISTABLE_TOOL_NAMES.has(block.name)) {
              collectedToolResults.push({
                toolName: block.name,
                input: block.input as Record<string, unknown>,
                output: sanitised,
              });
            }

            if (strippedFields.length > 0) {
              strippedFieldsManifest[block.name] = strippedFields;
            }

            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(sanitised),
            });
          }

          // Emit the per-round PII audit manifest (field names only, never values).
          if (Object.keys(strippedFieldsManifest).length > 0) {
            logger.info(
              { sessionId, round: rounds, strippedFields: strippedFieldsManifest },
              'NLI PII minimization: fields stripped from AI payload (MINCRM-445)',
            );
          }

          // Append tool results and loop.
          loopMessages = [...loopMessages, { role: 'user', content: toolResultBlocks }];
          rounds++;
          continue;
        }

        // Unexpected stop reason — treat current content as final.
        logger.warn({ stop_reason: response.stop_reason }, 'Unexpected AI stop reason');
        const textBlock = response.content.find((b) => b.type === 'text');
        assistantContent = textBlock?.type === 'text' ? textBlock.text : '';
        break;
      }

      if (rounds >= MAX_TOOL_ROUNDS && !assistantContent) {
        assistantContent =
          'I reached the maximum number of tool calls while processing your request. ' +
          'Please try breaking your request into smaller steps.';
        logger.warn({ sessionId, rounds }, 'NLI hit MAX_TOOL_ROUNDS cap');
      }

      if (!assistantContent) {
        throw Object.assign(new Error('AI provider returned no text content'), { statusCode: 502 });
      }
    } catch (err) {
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
    }
  }

  // ── Tx 2: insert assistant message, update session, write audit entry ─────

  const client2: PoolClient = await pool.connect();
  try {
    await client2.query('BEGIN');

    const toolResultsJson =
      collectedToolResults.length > 0 ? JSON.stringify(collectedToolResults) : null;

    const assistantResult = await client2.query<AiMessageRow>(
      `INSERT INTO ai_messages (session_id, role, content, tool_results)
       VALUES ($1, 'assistant', $2, $3)
       RETURNING id, session_id, role, content, tool_results, created_at`,
      [sessionId, assistantContent, toolResultsJson],
    );

    if (isFirstMessage) {
      const derivedName = deriveSessionName(content);
      await client2.query(`UPDATE ai_sessions SET name = $1, updated_at = now() WHERE id = $2`, [
        derivedName,
        sessionId,
      ]);
    } else {
      await client2.query(`UPDATE ai_sessions SET updated_at = now() WHERE id = $1`, [sessionId]);
    }

    await writeAuditEntry(client2, {
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

    await client2.query('COMMIT');

    if (!IS_E2E && (inputTokens > 0 || outputTokens > 0)) {
      void recordTokenUsage(userId, inputTokens, outputTokens);
    }

    return serialiseMessage(assistantResult.rows[0]);
  } catch (err) {
    await client2.query('ROLLBACK');
    throw err;
  } finally {
    client2.release();
  }
}
