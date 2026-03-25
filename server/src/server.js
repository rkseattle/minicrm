/**
 * HTTP server entry point.
 * Imports the Express app and starts listening on the configured port.
 */

import 'dotenv/config';
import app from './app.js';
import { seedDefaultAdmin } from './services/userService.js';

/** Default port for the API server */
const DEFAULT_PORT = 3001;

const port = Number(process.env.PORT) || DEFAULT_PORT;

app.listen(port, async () => {
  console.log(`MiniCRM API server listening on port ${port}`);
  await seedDefaultAdmin();
});
