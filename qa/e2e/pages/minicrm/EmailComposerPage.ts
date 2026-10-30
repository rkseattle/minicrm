/**
 * EmailComposerPage — Page Object for the composer the Emails section opens for a new
 * message or a reply.
 *
 * A reply arrives with its recipients and subject filled from the message it answers, so a
 * test usually writes only the body. Every element uses a HealingLocator with at least 2
 * strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls, no assertions.
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by EmailComposerPage. */
export interface EmailComposerPageContext {
  page: PageFacade;
}

export class EmailComposerPage {
  private readonly page: PageFacade;

  constructor(context: EmailComposerPageContext) {
    this.page = context.page;
  }

  /** Writes the message body, replacing whatever the composer started with. */
  async fillBody(text: string, timeout?: number): Promise<void> {
    const body = await this.page
      .locate(
        [
          { type: 'testId', value: 'email-composer-body' },
          { type: 'css', value: '[data-testid="email-composer"] textarea' },
        ],
        { intent: 'body field of the email composer' },
      )
      .resolve(timeout);
    await body.fill(text);
  }

  /** Presses Send. */
  async clickSend(): Promise<void> {
    const send = await this.page
      .locate(
        [
          { type: 'testId', value: 'email-composer-send' },
          { type: 'role', value: 'button', options: { name: /^send$/i }, within: 'email-composer' },
        ],
        { intent: 'Send button in the email composer' },
      )
      .resolve();
    await send.click();
  }
}
