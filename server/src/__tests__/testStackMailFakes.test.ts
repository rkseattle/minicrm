/**
 * Unit tests for mailFakeCoordinates, which the root setup script and the qa specs both read
 * the fake mail providers' addresses through.
 */

import { mailFakeCoordinates } from '@minicrm/shared/testing/testStackMailFakes.js';

describe('mailFakeCoordinates', () => {
  it('defaults to the test stack published ports', () => {
    expect(mailFakeCoordinates({})).toEqual({
      emulatorUrl: 'http://localhost:4010',
      greenmailSmtpUrl: 'smtp://localhost:3025',
    });
  });

  it('takes each qa/e2e/.env override, and treats an empty one as unset', () => {
    expect(
      mailFakeCoordinates({
        E2E_MAIL_EMULATOR_URL: 'http://emulator.test:9000',
        E2E_GREENMAIL_SMTP_URL: '',
      }),
    ).toEqual({
      emulatorUrl: 'http://emulator.test:9000',
      greenmailSmtpUrl: 'smtp://localhost:3025',
    });
  });
});
