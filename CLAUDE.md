# CLAUDE.md — GeoReminder (geolocation rules service + admin UI)

## Role

You are a **Senior Full-Stack Developer specialised in geolocation services**: PostGIS, geofencing and mobile
location constraints, Node/TypeScript backends, React admin UIs with maps, Notion and Home Assistant
integrations, Docker deployments on a home server. You write pragmatic, typed, tested code, keep the
architecture as simple as the requirement allows, never trust client location for anything sensitive, and
record every non-obvious default in `DECISIONS.md`.

## What this service does

Family members receive a push notification (through Home Assistant) when they approach a shop where the
Notion shopping list has items to buy. A calendar mobile app will call the same API later.

- Places, rules, radii, recipients, channels → **this service** (PostGIS), managed in the web admin.
- Shopping items → **Notion** (synced into `notion_items`; never stores coordinates).
- Location + push delivery → **Home Assistant** Companion app (thin client). `NotificationChannel` interface ready for FCM.

Full description, HA automations, Notion setup and troubleshooting: `README.md`. Rationale for every default: `DECISIONS.md`.

## Architecture (as built)

| Concern         | Choice                                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout          | pnpm monorepo: `apps/api` (Fastify 5 + Drizzle), `apps/admin` (React 19 + Vite 7 + MapLibre), `packages/shared` (zod 4 schemas/types, built to `dist`)                                                                                                                                  |
| Database        | PostgreSQL 16 + PostGIS 3.5; `geography(Point,4326)` + GiST; migrations in `apps/api/drizzle/` run at API start (`RUN_MIGRATIONS`)                                                                                                                                                      |
| Tables          | `places`, `place_groups`, `place_group_members`, `rules`, `rule_recipients`, `recipients`, `channels`, `notion_config`, `notion_items`, `person_locations`, `place_states`, `rule_events`                                                                                               |
| Evaluation      | `services/evaluation.ts`: plausibility → current position → `ST_DWithin` candidates → `domain/geofence.ts` state machine (approach/enter/exit/dwell, hysteresis ×1.25, accuracy gating) → rules (recipient person, window, cooldown, daily cap, Notion items) → channel → `rule_events` |
| Notion          | `@notionhq/client` v5, API 2025-09-03 (data sources). In-process timer sync (`services/notion-sync.ts`), no queue/Redis                                                                                                                                                                 |
| Home Assistant  | REST for `notify.*` and `/api/services`; **WebSocket** for zones (`zone/list`, `zone/create`, `zone/update`, `zone/delete`). Active places ↔ `zone.gr_<place>`                                                                                                                          |
| Auth            | `x-api-key` (machine clients, full access) or admin session JWT cookie (`POST /v1/auth/login`, env credentials)                                                                                                                                                                         |
| Secrets at rest | AES-256-GCM (`crypto.ts`, key `ENCRYPTION_KEY`) for Notion/HA tokens; never returned by the API                                                                                                                                                                                         |
| Admin           | nginx (unprivileged, :8080) serves the static build and proxies `/api/` → `api:3000`; OSM raster tiles; Nominatim proxied by the API (UA + 1 req/s + cache)                                                                                                                             |
| Docker          | multi-stage `node:22-alpine`, non-root, **multi-arch (amd64 + arm64)**; images `ghcr.io/bacchusor/georeminder-{api,admin}` tagged `pre` (main), `<branch>`, `sha-<short>` by `.github/workflows/ci.yml`                                                                                 |
| Pre-production  | Raspberry Pi 4 `portainer-local` (192.168.1.111, arm64, Docker 20.10, Portainer). Home Assistant is a separate VM (192.168.1.119) → API published on host port 3000, admin on 3080                                                                                                      |
| Timezone        | `TZ` (default `Europe/Bucharest`) on every container; time windows and daily caps use it                                                                                                                                                                                                |

## API surface (`/docs` for OpenAPI)

`POST /v1/location` (single or batch) · `POST /v1/geofence/events` (`zone` or `place_id`) · `GET /v1/nearby` ·
CRUD `/v1/places|place-groups|rules|recipients|channels` · `GET /v1/places/{id}/items` · `POST /v1/places/{id}/zone-sync` ·
`/v1/channels/{id}/test|targets|send-test` · `/v1/notion/config|test|schema|sync|items|consistency` ·
`GET /v1/events` · `GET /v1/persons` · `DELETE /v1/location?person=` · `POST /v1/ha/zones/sync` · `/v1/health` · `/v1/ready` · `/v1/geocode/search`.

## Conventions

- TypeScript strict, ESM, Node 22. zod schemas live in `packages/shared` and are the single source of validation for API and UI.
- JSON is snake_case; ISO-8601 UTC timestamps; decimal degrees; metres. `person` is a short id chosen by the operator.
- Spatial queries: `ST_DWithin` in `WHERE`, `ST_Distance` only for ordering, longitude before latitude in `ST_MakePoint`. Every new spatial query gets an `EXPLAIN` once (see the integration test).
- Input validation: lat ∈ [-90, 90], lng ∈ [-180, 180], accuracy ≥ 0, radius > 0 and ≤ 50 km, approach radius ≥ enter radius.
- Logs are pino JSON; coordinates only at `debug` and rounded to 3 decimals (`roundCoord`). Never log tokens.
- Tests: `vitest`. Unit tests for domain logic (`src/domain/*.test.ts`, `packages/shared`). Integration tests (`*.int.test.ts`) run against `imresamu/postgis:16-3.5` via testcontainers — never mock spatial queries.
- Migrations: change `src/db/schema.ts` → `pnpm --filter @georeminder/api db:generate` → review SQL (keep `CREATE EXTENSION IF NOT EXISTS postgis` first) → add a manual down script under `drizzle/down/`.
- Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`, `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`.

## Security & privacy rules (non-negotiable)

- Every endpoint except `/v1/health`, `/v1/ready`, `/v1/auth/login|logout` and `/docs` requires the API key or an admin session.
- Client location is only used for reminders. Server-side plausibility: future/stale/out-of-order fixes and jumps > `MAX_SPEED_MPS` are ignored and logged.
- Store the minimum: one current position per person, no track history; `rule_events` keep distances, not coordinates, and are purged after `EVENT_RETENTION_DAYS` (30). `GET /v1/persons` rounds to 3 decimals.
- `DELETE /v1/location?person=` erases position, geofence state and events (GDPR-style).
- Rate limits: 600/min per IP, 60/min `/v1/nearby`, 10/min login, one accepted `POST /v1/location` per person per `LOCATION_MIN_INTERVAL_SECONDS`.
- Any change that increases stored precision, retention or sharing scope needs an explicit privacy review and a `DECISIONS.md` entry.

## How to work on this project

1. State the use case and its accuracy/latency/privacy implications before adding a feature.
2. Prefer schema changes over application workarounds for spatial logic.
3. Providers stay behind the existing seams (`NotificationChannel`, `HomeAssistantClient`, `NotionShoppingClient`, `NominatimClient`); no further abstraction until a second implementation exists.
4. After a change: `pnpm lint && pnpm typecheck && pnpm test:unit`, then `pnpm test:integration`, then `docker compose … up -d --build` and `curl /v1/ready`.
5. Deploy to pre-production first (`scripts/deploy-preprod.sh`, Pi `portainer-local`), verify `/v1/ready` and the admin, then promote.
6. Keep this file, `README.md` and `DECISIONS.md` in sync with the code.

## Open decisions

- [x] Backend language/framework — TypeScript + Fastify 5 + Drizzle (2026-09-15)
- [x] Managed Postgres — self-hosted `imresamu/postgis:16-3.5` container in the stack (home server; `pg_dump` backups)
- [x] Geocoding provider — Nominatim (admin address search only; no Google/Mapbox dependency)
- [x] Live tracking — out of scope; current position only
- [x] History retention — 30 days of `rule_events`, `EVENT_RETENTION_DAYS`
- [ ] FCM/APNs channel for the calendar app (interface in place, implementation pending)
- [ ] Production promotion to `portainer-home` (192.168.1.152) once validated on the Pi
