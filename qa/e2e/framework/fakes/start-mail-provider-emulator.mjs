// Plain ESM, not TypeScript, so Node runs this and the .ts it imports with no build step.
import { createMailProviderEmulator } from './mail-provider-emulator.ts';

const DEFAULT_PORT = 4010;
const raw = process.env.MAIL_EMULATOR_PORT;
const port = raw === undefined || raw === '' ? DEFAULT_PORT : Number(raw);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`MAIL_EMULATOR_PORT must be a port number, not ${String(raw)}`);
}

createMailProviderEmulator().listen(port, () => {
  process.stdout.write(`mail provider emulator listening on ${String(port)}\n`);
});
