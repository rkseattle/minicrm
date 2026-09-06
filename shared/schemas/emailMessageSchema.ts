/**
 * Shared Zod schemas for synced email messages and the records they link to.
 * Imported by both the server (request validation) and the client (response types).
 *
 * A message is only ever read through a record it is linked to, or through the caller's
 * own unmatched list, so nothing here describes a message by id.
 */

import { z } from 'zod';

import { paginationParamsSchema } from './paginationSchema.js';

/**
 * Record types a message can be linked to.
 *
 * Mirrors `email_message_links.record_type`'s CHECK constraint. Deliberately not
 * `RECORD_LINK_TYPES` from shared/types, which includes `activity` — a message names
 * people and the things they are about, never an activity.
 */
export const EMAIL_LINK_RECORD_TYPES = ['contact', 'lead', 'account', 'deal'] as const;

export type EmailLinkRecordType = (typeof EMAIL_LINK_RECORD_TYPES)[number];

/**
 * The record a message is filed against.
 *
 * One definition, because the query params and the link body name the same pair and a
 * second copy would drift its validation independently.
 */
export const emailLinkTargetSchema = z.object({
  record_type: z.enum(EMAIL_LINK_RECORD_TYPES, {
    errorMap: () => ({ message: 'record_type must be contact, lead, account, or deal' }),
  }),
  record_id: z.string().uuid('record_id must be a UUID'),
});

/** Query params for the messages linked to one record. */
export const recordMessagesParamsSchema = paginationParamsSchema.merge(emailLinkTargetSchema);

export type RecordMessagesParams = z.infer<typeof recordMessagesParamsSchema>;

/** Body for linking a message to a record by hand. */
export const createEmailMessageLinkSchema = emailLinkTargetSchema;

export type CreateEmailMessageLinkInput = z.infer<typeof createEmailMessageLinkSchema>;

/**
 * One message as the API returns it.
 *
 * `body_html` is stored exactly as the sender wrote it and is never sanitized on the way
 * out — whatever renders it must sanitize at render, which is why it is not in the list
 * projection below.
 */
export const emailMessageSchema = z.object({
  id: z.string().uuid(),
  connected_account_id: z.string().uuid(),
  thread_id: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  from_address: z.string(),
  to_addresses: z.array(z.string()),
  cc_addresses: z.array(z.string()),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  has_attachments: z.boolean(),
  sent_at: z.string().nullable(),
  is_private: z.boolean(),
});

export type EmailMessage = z.infer<typeof emailMessageSchema>;

/**
 * A conversation, which is the unit both list endpoints page by.
 *
 * Keyed by `(connected_account_id, thread_id)` rather than the thread id alone: Gmail and
 * Graph thread ids are provider-local, `email_messages`' own UNIQUE is per account, and one
 * record links to messages from several reps' mailboxes — so a bare id could fuse two
 * people's conversations into one.
 */
export const emailThreadSchema = z.object({
  thread_id: z.string(),
  connected_account_id: z.string().uuid(),
  messages: z.array(emailMessageSchema),
});

export type EmailThread = z.infer<typeof emailThreadSchema>;
