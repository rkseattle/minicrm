# Node version for both stages. Declared once as an ARG so a version bump is a
# single edit here, matching .nvmrc — which every CI job reads via
# actions/setup-node's node-version-file. (MINCRM-704)
ARG NODE_VERSION=24

# Build stage: compile TypeScript to JavaScript (MINCRM-288)
FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /app

# Copy workspace manifests for layer caching
COPY package*.json ./
COPY server/package*.json ./server/
COPY shared/package*.json ./shared/
COPY client/package*.json ./client/

# Full install so tsc (root devDependency) and all server deps are available
RUN npm ci

# Copy source needed for compilation
COPY server/ ./server/
COPY shared/ ./shared/

# shared's own compiled .js MUST exist before minicrm-server's build runs.
# server/tsconfig.build.json's `include` only ever covers server/src/**/*, so
# it never compiles shared/schemas/*.ts itself despite the tsconfig `paths`
# entry pointing there — Node16 module resolution actually resolves
# `@minicrm/shared/schemas/*.js` imports through shared/package.json's own
# `exports` map (a literal `./schemas/*": "./schemas/*"` passthrough), which
# needs the real .js file on disk regardless of what `paths` says. Without
# this step, minicrm-server's own tsc invocation fails outright on any
# schema not yet compiled from a prior local `npm run build
# --workspace=@minicrm/shared` run — this build never caught that in CI,
# since ci.yml never actually builds this Dockerfile at all (found via a
# real clean `docker build` reproduction, MINCRM-636/637).
RUN npm run build --workspace=@minicrm/shared

RUN npm run build --workspace=minicrm-server

# Runtime stage: node only, no TypeScript source or tsx (MINCRM-288)
# Re-declared because a global ARG goes out of scope at each FROM — and placed BEFORE
# this FROM, not after, because an ARG consumed by a FROM must precede it. Moving this
# line below the FROM leaves ${NODE_VERSION} empty and the tag malformed.
ARG NODE_VERSION
FROM node:${NODE_VERSION}-alpine

# curl is required by docker-compose.yml's own healthcheck
# (CMD curl -f http://localhost:3001/api/health) — node:24-alpine has no
# curl by default, so that healthcheck always failed with "executable file
# not found in $PATH" and the container never reported healthy.
RUN apk add --no-cache curl

WORKDIR /app

# tsc outputs to server/dist/server/src/ (mirrors workspace-relative source tree)
COPY --from=builder /app/server/dist/server/src ./server/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

# node_modules/@minicrm/shared is a workspace symlink to ../../shared — tsc emits
# shared's compiled .js in-place next to the .ts sources (no outDir), so that
# directory must exist in the runtime image or the symlink resolves to nothing.
COPY --from=builder /app/shared ./shared

# Migration files are required at startup — db/ for the product database,
# qa/migrations/ for the coverage/TIA database (runCoverageMigrations() in
# migrate.ts resolves COVERAGE_MIGRATIONS_DIR to ../../qa/migrations relative
# to server/dist, i.e. /app/qa/migrations here). Only the migrations
# subdirectory is copied, not all of qa/, since the rest of qa/ is E2E
# framework/test code with no place in a runtime image.
COPY db/ ./db/
COPY qa/migrations/ ./qa/migrations/

EXPOSE 3001

# NODE_ENV is deliberately NOT set here. server.ts refuses to boot without a
# recognized value, and baking one in would make an unconfigured deployment
# indistinguishable from a deliberate one — the exact state the guard exists to
# surface. Compose supplies it; a bare `docker run` must pass -e NODE_ENV.

CMD ["node", "server/dist/server.js"]
