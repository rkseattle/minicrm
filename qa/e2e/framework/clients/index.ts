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
