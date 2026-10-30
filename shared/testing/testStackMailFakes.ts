/**
 * Where the test stack's fake mail providers are, one definition for the root setup script
 * that waits on and resets them and the qa specs that seed them: neither can import the
 * other, and a split sends setup to reset one emulator while the specs seed another.
 * Dependency-free, like every file here; callers pass their own environment.
 */

/** The fakes' addresses as the test runner reaches them, from the qa/e2e/.env overrides. */
export interface MailFakeCoordinates {
  /** The Gmail/Graph emulator's base URL, its admin API included. */
  emulatorUrl: string;
  /** GreenMail's SMTP, which the specs deliver seeded mail through. */
  greenmailSmtpUrl: string;
}

/**
 * @param env - The process environment, or any record carrying its E2E_* keys.
 * @returns Each override when set and non-empty, else the docker-compose.test.yml default.
 */
export function mailFakeCoordinates(
  env: Readonly<Record<string, string | undefined>>,
): MailFakeCoordinates {
  return {
    emulatorUrl: env['E2E_MAIL_EMULATOR_URL'] || 'http://localhost:4010',
    greenmailSmtpUrl: env['E2E_GREENMAIL_SMTP_URL'] || 'smtp://localhost:3025',
  };
}
