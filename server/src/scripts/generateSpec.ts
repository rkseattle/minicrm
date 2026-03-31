/**
 * Generates the OpenAPI JSON spec from swagger-jsdoc annotations and writes it
 * to openapi.json in the server package root.
 *
 * Used by the `lint:api` npm script and CI to produce a stable spec artifact
 * that @redocly/cli can validate.
 *
 * Usage: tsx src/scripts/generateSpec.ts
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { swaggerSpec } from '../swagger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Output path — server/openapi.json */
const OUTPUT_PATH = resolve(__dirname, '../../openapi.json');

writeFileSync(OUTPUT_PATH, JSON.stringify(swaggerSpec, null, 2), 'utf-8');

console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
