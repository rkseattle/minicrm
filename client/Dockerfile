FROM node:20-alpine

# Build from the repo root so npm workspaces can resolve hoisted dependencies
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json ./
COPY client/package.json ./client/
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Use npm install (not npm ci) so Docker resolves platform-specific optional deps
# (e.g. @rollup/rollup-linux-arm64-musl) that aren't in a macOS-generated lockfile
RUN npm install --workspace=minicrm-client

# Copy source files needed at runtime
COPY client/ ./client/
COPY shared/ ./shared/

EXPOSE 5173

CMD ["npm", "run", "dev", "--workspace=minicrm-client"]
