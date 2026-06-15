# BI Result Presenter

A multi-tenant BI assistant that lets analysts query connected data sources in plain language and receive SQL-backed results rendered as charts or tables.

## Local dev quick-start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (with Compose v2)
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/installation) >= 9

### One-command setup

```sh
# 1. Install all workspace dependencies
pnpm install

# 2. Copy env template and fill in local values
cp .env.example .env.local
# Edit .env.local — at minimum set DATABASE_URL, JWT_ACCESS_SECRET,
# JWT_REFRESH_SECRET, KMS_KEY_REF (use "local-test-key" stub), GEMINI_API_KEY

# 3. Start Postgres + API (migrate-seed runs automatically, then exits)
docker compose up

# 4. In a second terminal — start the Vite dev server (fast HMR)
pnpm --filter web dev
```

The SPA is available at `http://localhost:5173` and talks to the API at `http://localhost:3000`.

### Tear down

```sh
docker compose down -v   # removes containers and the db_data volume
```

### Service map

| Service | URL | Notes |
|---------|-----|-------|
| API (Express) | http://localhost:3000 | `GET /health` returns `{"status":"ok"}` |
| Postgres | localhost:5432 | bound to 127.0.0.1 only; db `bi_platform` |
| SPA (Vite) | http://localhost:5173 | host process, not in compose |

### Migrate + seed status

The `migrate-seed` service is a **placeholder** until T1.2 (Prisma control-plane schema) lands. It logs a TODO and exits 0. Once T1.2 is merged the compose file will be updated to run:

```sh
npx prisma migrate deploy
node dist/scripts/provision-tenant.js --name demo --admin-email admin@demo.example
```

### Environment variables

See `.env.example` for the full list of required variables and their descriptions. Copy to `.env.local` before running `docker compose up`.

### Building Docker images manually

```sh
# API image (from repo root)
docker build -f apps/api/Dockerfile -t bi-api .

# Web image (from repo root)
docker build -f apps/web/Dockerfile -t bi-web .
```
