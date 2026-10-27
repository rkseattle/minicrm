/**
 * Shared Zod schemas for synced email messages and the records they link to.
 * Imported by both the server (request validation) and the client (response types).
 *
 * A message is only ever read through a record it is linked to, or through the caller's
 * own unmatched list, so nothing here describes a message by id.
 */

import { z } from 'zod';

import { Capability } from './capabilitySchema.js';
import { paginationParamsSchema } from './paginationSchema.js';
import { typeErrorMessages } from './typeErrorMessages.js';

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
 * The capability that governs editing each record type.
 *
 * Filing mail against a record is a CRM write, so it takes the record's own edit
 * capability on top of the router's mailbox gate — the way bulk contact edits stack
 * BulkOperations with ContactsEdit. Accounts and leads have no capability of their own in
 * the enum and are gated by `contacts:edit` everywhere they are written
 * (`routes/accounts.ts`, `routes/leads.ts`); following that here rather than exempting
 * them is what stops a custom role without `contacts:edit` — which migration 170 still
 * grants `connected_accounts:manage` — from filing mail it cannot file against a contact.
 */
export const EMAIL_LINK_EDIT_CAPABILITY: Readonly<Record<EmailLinkRecordType, Capability>> = {
  contact: Capability.ContactsEdit,
  deal: Capability.DealsEdit,
  account: Capability.ContactsEdit,
  lead: Capability.ContactsEdit,
};

/** Whether sending from a record also logs an Email activity on it; leads have no timeline. */
export function sendLogsActivity(recordType: EmailLinkRecordType): boolean {
  return recordType !== 'lead';
}

/**
 * Every capability sending from a record needs, so a client can refuse before the user
 * writes a message the server would answer with FORBIDDEN.
 */
export function capabilitiesToSendFrom(recordType: EmailLinkRecordType): Capability[] {
  const needed = [EMAIL_LINK_EDIT_CAPABILITY[recordType]];
  if (sendLogsActivity(recordType)) needed.push(Capability.ActivitiesCreate);
  return needed;
}

/**
 * The record a message is filed against.
 *
 * One definition, because the query params and the link body name the same pair and a
 * second copy would drift its validation independently.
 */
export const emailLinkTargetSchema = z.object({
  record_type: z.enum(EMAIL_LINK_RECORD_TYPES, {
    error: 'record_type must be contact, lead, account, or deal',
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
  /** Where the sender asked replies to go; empty means reply to the sender. */
  reply_to_addresses: z.array(z.string()),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  has_attachments: z.boolean(),
  sent_at: z.string().nullable(),
  is_private: z.boolean(),
});

export type EmailMessage = z.infer<typeof emailMessageSchema>;

/** One message with its bodies, as the body endpoint returns it. The HTML is unsanitized. */
export const emailMessageDetailSchema = emailMessageSchema.extend({
  body_text: z.string().nullable(),
  body_html: z.string().nullable(),
});

export type EmailMessageDetail = z.infer<typeof emailMessageDetailSchema>;

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

/** Body of PATCH /api/v1/email-messages/:id/thread-privacy; applies to the whole thread. */
export const threadPrivacySchema = z
  .object({
    is_private: z.boolean(typeErrorMessages({ required: 'is_private must be a boolean' })),
  })
  .strict();

export type ThreadPrivacyInput = z.infer<typeof threadPrivacySchema>;

/** Response of PATCH /api/v1/email-messages/:id/thread-privacy; a type, since nothing parses it. */
export interface ThreadPrivacyResponse {
  is_private: boolean;
  /** Messages whose setting changed; 0 when the thread already had it. */
  updated: number;
}

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

/** The request header carrying a send's idempotency key. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** One key per compose, generated by the client and reused on every retry of it. */
export const idempotencyKeySchema = z.string().uuid();

/** What a successful send returns. */
export const sendEmailResponseSchema = z.object({
  message: emailMessageSchema,
  /** Merge tags that rendered empty. Reported after the fact; the send already happened. */
  unresolved_merge_tags: z.array(z.string()),
});

export type SendEmailResponse = z.infer<typeof sendEmailResponseSchema>;

/** What a failed send means for the message: it went, it certainly did not, or nobody knows. */
export type SendErrorOutcome = 'went' | 'not_sent' | 'unknown';

/**
 * Every code a send is refused with, by its route's middleware or its handler, and what it
 * means for the message. A code not listed, such as an unexpected 5xx, reads as unknown: the
 * client freezes the compose, since resending an unknown outcome can mail the recipient twice.
 */
export const SEND_ERROR_OUTCOMES = {
  // Refused by authentication, the feature flag, the capability check or the body parser.
  AUTH_MISSING_TOKEN: 'not_sent',
  AUTH_INVALID_TOKEN: 'not_sent',
  AUTH_SESSION_ABSOLUTE_TIMEOUT: 'not_sent',
  USER_INACTIVE: 'not_sent',
  PASSWORD_CHANGE_REQUIRED: 'not_sent',
  UNAUTHENTICATED: 'not_sent',
  FEATURE_DISABLED: 'not_sent',
  AUTH_FORBIDDEN: 'not_sent',
  SERVICE_ACCOUNT_UI_BLOCKED: 'not_sent',
  PAYLOAD_TOO_LARGE: 'not_sent',
  VALIDATION_ERROR: 'not_sent',
  FORBIDDEN: 'not_sent',
  NOT_FOUND: 'not_sent',
  IDEMPOTENCY_KEY_REQUIRED: 'not_sent',
  IDEMPOTENCY_KEY_INVALID: 'not_sent',
  EMAIL_ACCOUNT_NOT_FOUND: 'not_sent',
  EMAIL_MESSAGE_NOT_FOUND: 'not_sent',
  TEMPLATE_NOT_FOUND: 'not_sent',
  PROVIDER_SEND_UNSUPPORTED: 'not_sent',
  PROVIDER_AUTH_EXPIRED: 'not_sent',
  RECONNECT_REQUIRED: 'not_sent',
  RATE_LIMITED: 'not_sent',
  SEND_FAILED: 'not_sent',
  SENT_NOT_RECORDED: 'went',
  SEND_ALREADY_SENT: 'went',
  SEND_NOT_CONFIRMED: 'unknown',
  SEND_IN_PROGRESS: 'unknown',
  SEND_UNCONFIRMED: 'unknown',
  IDEMPOTENCY_KEY_REUSED: 'unknown',
} as const satisfies Record<string, SendErrorOutcome>;

export type SendErrorCode = keyof typeof SEND_ERROR_OUTCOMES;

/** Refusals answered before the send service runs, by middleware or the controller. */
export type SendRequestErrorCode = Extract<
  SendErrorCode,
  | 'AUTH_MISSING_TOKEN'
  | 'AUTH_INVALID_TOKEN'
  | 'AUTH_SESSION_ABSOLUTE_TIMEOUT'
  | 'USER_INACTIVE'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'UNAUTHENTICATED'
  | 'FEATURE_DISABLED'
  | 'AUTH_FORBIDDEN'
  | 'SERVICE_ACCOUNT_UI_BLOCKED'
  | 'PAYLOAD_TOO_LARGE'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_INVALID'
>;

/** The outcome a response's error code names; a missing or unlisted code is unknown. */
export function sendErrorOutcome(code: string | undefined): SendErrorOutcome {
  if (code === undefined || !Object.hasOwn(SEND_ERROR_OUTCOMES, code)) return 'unknown';
  // Safe: the hasOwn check above proves code is one of the table's keys.
  return SEND_ERROR_OUTCOMES[code as SendErrorCode];
}
