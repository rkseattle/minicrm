FROM node:20-alpine

# Build from the repo root so npm workspaces can resolve hoisted dependencies
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package*.json ./
COPY server/package*.json ./server/
COPY shared/package*.json ./shared/
COPY client/package*.json ./client/

# Install server production dependencies via workspace
RUN npm ci --workspace=server --omit=dev

# Copy source files needed at runtime
COPY server/ ./server/
COPY shared/ ./shared/

EXPOSE 3001

CMD ["node", "server/src/server.js"]
