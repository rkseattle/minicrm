# Build stage: compile TypeScript to JavaScript (MINCRM-288)
FROM node:20-alpine AS builder

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

RUN npm run build --workspace=minicrm-server

# Runtime stage: node only, no TypeScript source or tsx (MINCRM-288)
FROM node:20-alpine

WORKDIR /app

# tsc outputs to server/dist/server/src/ (mirrors workspace-relative source tree)
COPY --from=builder /app/server/dist/server/src ./server/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

# Migration files are required at startup
COPY db/ ./db/

EXPOSE 3001

CMD ["node", "server/dist/server.js"]
