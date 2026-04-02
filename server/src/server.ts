/**
 * HTTP server entry point.
 * Imports the Express app and starts listening on the configured port.
 */

import 'dotenv/config';
import app from './app.js';
import logger from './logger.js';
import { runMigrations } from './migrate.js';
import { seedDefaultAdmin } from './services/userService.js';

/** Default port for the API server */
const DEFAULT_PORT = 3001;

/** Known-weak JWT_SECRET values that must be rejected at startup */
const WEAK_JWT_SECRETS = new Set(['changeme', 'secret', 'password', '']);

const jwtSecret = process.env.JWT_SECRET ?? '';
if (WEAK_JWT_SECRETS.has(jwtSecret) || jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET is not set or is using a known-weak value. ' +
      'Set a cryptographically random secret of at least 32 characters before starting. ' +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}

const port = Number(process.env.PORT) || DEFAULT_PORT;

app.listen(port, async () => {
  logger.info(`MiniCRM API server listening on port ${port}`);
  await runMigrations();
  await seedDefaultAdmin();
});
