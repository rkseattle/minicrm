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

const port = Number(process.env.PORT) || DEFAULT_PORT;

// ── API docs (development + staging only) ─────────────────────────────────────
// Dynamically imported so swagger-jsdoc is never loaded in production.
// Swagger UI is served at /api-docs; raw spec at /api-docs.json.
if (process.env.NODE_ENV !== 'production') {
  const { setupSwagger } = await import('./swagger.js');
  setupSwagger(app);
}

app.listen(port, async () => {
  logger.info(`MiniCRM API server listening on port ${port}`);
  await runMigrations();
  await seedDefaultAdmin();
});
