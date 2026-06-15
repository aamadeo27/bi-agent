# ── Stage 1: builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Install pnpm via corepack (ships with Node 20)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first so package installs are cached when only source
# files change.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

# Install all deps (including devDependencies needed for the build step)
RUN pnpm install --frozen-lockfile

# Copy the rest of the monorepo source needed to build the API
COPY tsconfig.base.json ./
COPY packages/contracts/ packages/contracts/
COPY apps/api/ apps/api/

# Build the API (tsup produces dist/index.js)
RUN pnpm --filter @bi/api build

# Prune to production-only node_modules so the runtime stage stays lean
RUN pnpm --filter @bi/api --prod deploy /prod/api


# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy production-pruned node_modules from the builder's deploy output
COPY --from=builder /prod/api/node_modules ./node_modules

# Copy compiled output
COPY --from=builder /build/apps/api/dist ./dist

# The node user (uid 1000) ships with the official node:alpine image
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
