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

/** Longest subject a send accepts, matching the org-SMTP compose path. */
export const EMAIL_SEND_SUBJECT_MAX = 255;

/** Longest HTML body a send accepts, in characters. Bounds what a caller can make us submit. */
export const EMAIL_SEND_BODY_MAX = 100_000;

/** Most addresses across To and Cc. Gmail's own per-message ceiling is far higher. */
export const EMAIL_SEND_MAX_RECIPIENTS = 50;

const recipientListSchema = z.array(
  z.string().trim().email('Each recipient must be an email address'),
);

/**
 * Body for sending through one of the caller's own mailboxes.
 *
 * Either a typed `subject` and `body_html`, or a `template_id` rendered against the named
 * record — never both, since a template silently overriding typed text loses it.
 * `in_reply_to_message_id` and `forward_of_message_id` name a stored message in the same
 * mailbox; a message answers or forwards one message, not both.
 */
export const sendEmailSchema = z
  .object({
    connected_account_id: z.string().uuid('connected_account_id must be a UUID'),
    to: recipientListSchema,
    cc: recipientListSchema.default([]),
    subject: z
      .string()
      .trim()
      .min(1, 'Subject is required')
      .max(EMAIL_SEND_SUBJECT_MAX, `Subject must be ${EMAIL_SEND_SUBJECT_MAX} characters or fewer`)
      .optional(),
    body_html: z
      .string()
      .trim()
      .min(1, 'Body is required')
      .max(EMAIL_SEND_BODY_MAX, `Body must be ${EMAIL_SEND_BODY_MAX} characters or fewer`)
      .optional(),
    template_id: z.string().uuid('template_id must be a UUID').optional(),
    record_type: emailLinkTargetSchema.shape.record_type.optional(),
    record_id: emailLinkTargetSchema.shape.record_id.optional(),
    in_reply_to_message_id: z.string().uuid('in_reply_to_message_id must be a UUID').optional(),
    forward_of_message_id: z.string().uuid('forward_of_message_id must be a UUID').optional(),
  })
  .superRefine((value, ctx) => {
    const recipients = value.to.length + value.cc.length;
    if (recipients === 0) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'At least one recipient is required' });
    } else if (recipients > EMAIL_SEND_MAX_RECIPIENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `A message may have at most ${EMAIL_SEND_MAX_RECIPIENTS} recipients`,
      });
    }
    if ((value.record_type === undefined) !== (value.record_id === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['record_id'],
        message: 'record_type and record_id must be given together',
      });
    }
    if (value.in_reply_to_message_id !== undefined && value.forward_of_message_id !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['forward_of_message_id'],
        message: 'A message replies to or forwards one message, not both',
      });
    }
    if (value.template_id !== undefined) {
      if (value.subject !== undefined || value.body_html !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['template_id'],
          message: 'Send a template or a typed subject and body, not both',
        });
      }
      if (value.record_id === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['record_id'],
          message: 'A template is rendered against a record; name one',
        });
      }
    } else if (value.subject === undefined) {
      ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject is required' });
    } else if (value.body_html === undefined) {
      ctx.addIssue({ code: 'custom', path: ['body_html'], message: 'Body is required' });
    }
  });

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

/** What a successful send returns. */
export const sendEmailResponseSchema = z.object({
  message: emailMessageSchema,
  /** Merge tags that rendered empty. Reported after the fact; the send already happened. */
  unresolved_merge_tags: z.array(z.string()),
});

export type SendEmailResponse = z.infer<typeof sendEmailResponseSchema>;
