/**
 * Sending through a connected mailbox without ever mailing a recipient twice.
 *
 * One idempotency key per compose: kept while the request is unchanged, so a retry is a
 * replay, and replaced once the user edits, since an edited message is a new send. Any
 * failure that is not a definite "nothing was sent" freezes the compose: from then on only
 * the stored request is resent, under the same key, whatever the form shows — the way Stripe
 * and the IETF Idempotency-Key draft treat an indeterminate outcome.
 */

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import {
  sendErrorOutcome,
  type SendEmailInput,
  type SendEmailResponse,
} from '@shared/schemas/emailMessageSchema.js';
import { EMAIL_MESSAGES_QUERY_KEY, sendEmailMessage } from '@/api/emailMessages.js';
import { newIdempotencyKey } from '@/utils/idempotencyKey.js';

/** How long a send's confirmation shows before its form closes. */
export const CLOSE_AFTER_SENT_MS = 1500;

/** What a compose would send, and the mailbox address its confirmation names. */
export interface MailboxRequest {
  input: SendEmailInput;
  mailbox: string | undefined;
}

/** How a failed send ended for the user. */
export type MailboxFailure =
  { kind: 'went'; code: string } | { kind: 'maybe' } | { kind: 'refused' };

interface Attempt extends MailboxRequest {
  key: string;
  request: string;
}

export interface MailboxSend {
  /** True once a send may have gone; the form must stop accepting edits. */
  frozen: boolean;
  /**
   * Sends `current()` — or, when frozen, the stored request, never a rebuilt one.
   * @returns the response and the mailbox the request named.
   */
  send(current: () => MailboxRequest): Promise<{ response: SendEmailResponse; mailbox?: string }>;
  /** Settles a failed send: says how it ended, and freezes the compose when it may have gone. */
  settleFailure(error: unknown): MailboxFailure;
  /** Called after any send that went, to refresh the synced-mail lists. */
  refreshMail(): void;
  /** Forgets the compose, for a closed form. */
  reset(): void;
}

export function useMailboxSend(): MailboxSend {
  const queryClient = useQueryClient();
  const attemptRef = useRef<Attempt | null>(null);
  const [frozen, setFrozen] = useState(false);

  async function send(
    current: () => MailboxRequest,
  ): Promise<{ response: SendEmailResponse; mailbox?: string }> {
    let attempt = attemptRef.current;
    if (!frozen || !attempt) {
      const next = current();
      const request = JSON.stringify(next.input);
      if (attempt?.request !== request) attempt = { ...next, key: newIdempotencyKey(), request };
      attemptRef.current = attempt;
    }
    const response = await sendEmailMessage(attempt.input, attempt.key);
    return { response, mailbox: attempt.mailbox };
  }

  function settleFailure(error: unknown): MailboxFailure {
    // Safe: an Axios error or anything else; only the optional code is read.
    const code = (error as AxiosError<{ error?: { code?: string } }>)?.response?.data?.error?.code;
    const outcome = sendErrorOutcome(code);
    if (outcome === 'went' && code !== undefined) return { kind: 'went', code };
    if (outcome === 'not_sent') return { kind: 'refused' };
    setFrozen(true);
    return { kind: 'maybe' };
  }

  function refreshMail(): void {
    void queryClient.invalidateQueries({ queryKey: EMAIL_MESSAGES_QUERY_KEY });
  }

  // Stable, so a form can call it from an effect keyed on being open.
  const reset = useCallback((): void => {
    attemptRef.current = null;
    setFrozen(false);
  }, []);

  return { frozen, send, settleFailure, refreshMail, reset };
}
