/**
 * Public API for the framework clients layer.
 *
 * Import from this barrel rather than individual files:
 *   import { RestClient, GrpcClient } from '@framework/clients';
 *
 */

export {
  RestClient,
  RestClientError,
  BearerAuthStrategy,
  ApiKeyAuthStrategy,
  BasicAuthStrategy,
} from './rest-client.js';

export type { AuthStrategy, ApiResponse, RestClientOptions } from './rest-client.js';

export { GrpcClient, GrpcClientError } from './grpc-client.js';

export type { GrpcClientOptions } from './grpc-client.js';

export { MailEmulatorClient, MailEmulatorError } from './mail-emulator-client.js';

export type { SeededMessage } from './mail-emulator-client.js';

export { SmtpSeedClient } from './smtp-seed-client.js';

export type { SeedMail } from './smtp-seed-client.js';
