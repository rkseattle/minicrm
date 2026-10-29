/**
 * Where the Gmail and Graph drivers send their requests.
 *
 * Outside production an E2E stack may point either at a local emulator; everywhere else
 * these are the providers' own hosts. Read per call, so a test can set the seam and reach
 * every request the driver makes.
 */

import { nonProductionSeam } from '../../utils/nonProductionSeams.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0/me';

/** The Gmail API's per-user base; paths such as `/messages` are appended to it. */
export function gmailApiBase(): string {
  return nonProductionSeam('GMAIL_API_BASE_URL') ?? GMAIL_API_BASE;
}

/** The Graph API's `/me` base; paths such as `/mailFolders/inbox` are appended to it. */
export function graphApiBase(): string {
  return nonProductionSeam('GRAPH_API_BASE_URL') ?? GRAPH_API_BASE;
}

/**
 * True when `value` is a URL on the Graph origin this process talks to.
 *
 * A stored delta link is replayed with a bearer token attached, so it may only point at
 * the origin requests are already sent to — never at one a tampered row names.
 */
export function isGraphOriginUrl(value: string): boolean {
  try {
    return new URL(value).origin === new URL(graphApiBase()).origin;
  } catch {
    return false;
  }
}
