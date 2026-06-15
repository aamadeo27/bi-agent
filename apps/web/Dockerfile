# ── Stage 1: builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests; layer-cache misses only when lockfile changes
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/contracts/ packages/contracts/
COPY apps/web/ apps/web/

# Build the SPA (vite build writes to apps/web/dist/)
RUN pnpm --filter @bi/web build


# ── Stage 2: serve ─────────────────────────────────────────────────────────────
FROM nginx:alpine AS serve

# Replace the default nginx config with the SPA-routing config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the compiled SPA assets
COPY --from=builder /build/apps/web/dist /usr/share/nginx/html

# nginx:alpine already runs as root to bind port 80; the worker processes drop
# to the `nginx` user automatically via the default nginx.conf `user nginx` directive.

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
