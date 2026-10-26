ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS builder

# Build from the repo root so npm workspaces can resolve hoisted dependencies
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# The root lockfile carries every platform's native bindings, musl included.
RUN npm ci --workspace=minicrm-client

# Copy source files needed for the build
COPY client/ ./client/
COPY shared/ ./shared/

# Compile shared schemas to JS so Vite can resolve .js imports at build time
RUN npm run build --workspace=@minicrm/shared

RUN npm run build --workspace=minicrm-client

FROM nginx:alpine
COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
