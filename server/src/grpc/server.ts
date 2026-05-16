/**
 * gRPC server bootstrap for MiniCRM (MINCRM-376).
 *
 * Loads the audit.proto definition via @grpc/proto-loader, registers the
 * AuditService implementation, and starts listening on GRPC_PORT.
 *
 * This is a separate listener from the Express HTTP server — both run in the
 * same Node.js process but on different ports. Start it via startGrpcServer()
 * and shut it down via the returned stop() function.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { listAuditEventsHandler, streamAuditEventsHandler } from './auditGrpcService.js';

/** Default gRPC port when GRPC_PORT env var is not set */
const DEFAULT_GRPC_PORT = 50051;

/** Path to the proto file — same directory as this file (server/src/grpc/proto/) */
const PROTO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'proto/audit.proto');

/** proto-loader options — keep longs as numbers, use camelCase, maintain field names from proto */
const PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
};

/**
 * Starts the gRPC server.
 *
 * @returns A stop function that shuts down the server gracefully (with a timeout fallback).
 */
export async function startGrpcServer(): Promise<() => Promise<void>> {
  const port = Number(process.env.GRPC_PORT) || DEFAULT_GRPC_PORT;

  const packageDef = await protoLoader.load(PROTO_PATH, PROTO_LOADER_OPTIONS);
  const grpcObject = grpc.loadPackageDefinition(packageDef);

  // Navigate to the service constructor: minicrm.audit.v1.AuditService
  const auditPkg = (grpcObject['minicrm'] as Record<string, unknown>)?.['audit'] as
    | Record<string, unknown>
    | undefined;

  const AuditServiceDef = auditPkg?.['v1'] as
    | Record<string, grpc.ServiceClientConstructor>
    | undefined;

  if (!AuditServiceDef?.['AuditService']) {
    throw new Error('Failed to locate AuditService in loaded proto package definition');
  }

  const server = new grpc.Server();

  // The service descriptor is the static property on the constructor.
  const serviceDescriptor = AuditServiceDef['AuditService'].service as grpc.ServiceDefinition;

  server.addService(serviceDescriptor, {
    ListAuditEvents: listAuditEventsHandler,
    StreamAuditEvents: streamAuditEventsHandler,
  });

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) {
          reject(err);
          return;
        }
        logger.info(`gRPC server listening on port ${boundPort}`);
        resolve();
      },
    );
  });

  const GRPC_SHUTDOWN_TIMEOUT_MS = 5_000;

  return (): Promise<void> =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn('gRPC shutdown timeout — forcing shutdown');
        server.forceShutdown();
        resolve();
      }, GRPC_SHUTDOWN_TIMEOUT_MS);

      server.tryShutdown((err) => {
        clearTimeout(timer);
        if (err) {
          logger.error({ err }, 'gRPC tryShutdown error — forcing shutdown');
          server.forceShutdown();
        }
        resolve();
      });
    });
}
