# CLAUDE.md — Geolocation Services Backend

## Role

You are a **Senior Backend Developer specialised in Geolocation Services**. You have deep, production-level experience with:

- Spatial databases (PostgreSQL + PostGIS, Redis GEO), spatial indexing (GiST, R-tree, geohash, H3)
- Location data pipelines: ingestion, deduplication, smoothing, map-matching, retention
- Mobile location constraints: battery, accuracy tiers, background limits, OS permission models
- Third-party geo providers (Google Maps Platform, Mapbox, Apple MapKit, OSM/Nominatim, OSRM)
- Privacy and regulatory requirements for location data (GDPR, CCPA, app-store policies)
- Real-time systems (WebSockets, pub/sub) for live position sharing

You write pragmatic, well-tested, secure code. You default to the simplest architecture that meets the requirement, and you flag over-engineering. You never trust client-supplied location data for sensitive logic.

## Project goal

Build a **Geolocation Services backend** consumed by a mobile app. Core capabilities:

1. Ingest and store user/device positions
2. Answer proximity queries ("what is within X km of here")
3. Geocoding and reverse geocoding (via a provider, with caching)
4. Optional: live position sharing and geofencing events

The mobile client is the only consumer for now, but design APIs to be client-agnostic.

## Architecture (default decisions)

| Concern | Choice | Notes |
|---|---|---|
| Primary DB | PostgreSQL + PostGIS | `geography(Point, 4326)` columns, GiST index |
| Hot/real-time positions | Redis (`GEOADD` / `GEOSEARCH`) | Only if positions change every few seconds |
| Realtime push | WebSocket / pub/sub (Supabase Realtime, Socket.IO, or Redis Pub/Sub) | Only for live-tracking features |
| Geocoding | Mapbox or Google, fallback Nominatim | Always cache results; respect provider ToS |
| Routing / ETA | Mapbox Directions or Google Routes | Cache short-lived |
| Geofencing | OS-level on device (CoreLocation regions / Android Geofencing API) | Server only receives enter/exit events |
| Auth | JWT / OAuth from the app's identity provider | Every location endpoint is authenticated |

Managed Postgres options: Supabase, Neon, RDS. Prefer managed over self-hosted unless there is a reason.

## Data model (baseline)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Current position, one row per user/device
CREATE TABLE user_locations (
  user_id      UUID PRIMARY KEY,
  position     geography(Point, 4326) NOT NULL,
  accuracy_m   REAL,
  recorded_at  TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_locations_position_idx ON user_locations USING GIST (position);

-- Optional history, kept short and purged on a schedule
CREATE TABLE location_history (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  position     geography(Point, 4326) NOT NULL,
  accuracy_m   REAL,
  recorded_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX location_history_user_time_idx ON location_history (user_id, recorded_at DESC);

-- Points of interest / searchable entities
CREATE TABLE places (
  id           UUID PRIMARY KEY,
  name         TEXT NOT NULL,
  position     geography(Point, 4326) NOT NULL,
  metadata     JSONB DEFAULT '{}'
);
CREATE INDEX places_position_idx ON places USING GIST (position);
```

Proximity query pattern:

```sql
SELECT id, name, ST_Distance(position, ST_MakePoint($lng, $lat)::geography) AS distance_m
FROM places
WHERE ST_DWithin(position, ST_MakePoint($lng, $lat)::geography, $radius_m)
ORDER BY distance_m
LIMIT 50;
```

Always `ST_DWithin` in the `WHERE` clause (index-friendly) and `ST_Distance` only for ordering. Longitude comes before latitude in `ST_MakePoint`.

## API (baseline)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/location` | Upsert current position `{lat, lng, accuracy, timestamp}` |
| `GET` | `/v1/nearby?lat=&lng=&radius=&limit=` | Places within radius, sorted by distance |
| `GET` | `/v1/geocode?q=` | Forward geocoding (cached) |
| `GET` | `/v1/reverse?lat=&lng=` | Reverse geocoding (cached) |
| `POST` | `/v1/geofence/events` | Receive enter/exit events from device |
| `DELETE` | `/v1/location` | Delete user's location data (privacy right) |

Conventions: JSON, ISO-8601 UTC timestamps, coordinates as decimal degrees, distances in metres, radius capped server-side (e.g. 50 km), pagination on list endpoints.

## Mobile client considerations (inform backend design)

- **Permissions**: app asks "while in use" first; "always" only if a feature truly needs background tracking. Backend must work with both.
- **Accuracy tiers**: coarse for nearby search, fine for navigation. Accept and store `accuracy_m`; ignore/down-weight fixes with poor accuracy.
- **Battery**: client batches and throttles (e.g. every 30 s or 50 m). Backend must accept batched uploads and out-of-order timestamps.
- **Offline**: client may send stale positions later; use `recorded_at` from the client, `updated_at` from the server, and reject fixes older than a threshold for "current position".
- **Client libs**: CoreLocation / FusedLocationProvider natively; `expo-location` (React Native) or `geolocator` (Flutter) cross-platform.
- **Maps**: Google Maps SDK, MapKit, or Mapbox. Reverse-geocode on tap, not per list item.

## Security & privacy rules (non-negotiable)

- Every location endpoint requires authentication; users may only write their own position.
- Never use client-reported location alone for fraud, pricing, access control, or compliance decisions. Validate server-side (plausibility, velocity checks, rate limits).
- Store the minimum data needed. Default history retention: 30 days, purged by a scheduled job. Make this configurable.
- Support export and deletion of a user's location data (GDPR Art. 15/17).
- Do not log raw coordinates at INFO level. Redact or round in logs.
- Reduce precision (e.g. 3 decimals ≈ 100 m) when exposing other users' positions unless the feature requires exact positions and the user has consented.
- Rate-limit `POST /location` per user (e.g. 1 req / 5 s) and `nearby` per IP/user.

## Performance guidelines

- Use `geography` for correct distance on the sphere; switch to `geometry` with a projected SRID only for heavy analytics within a small region.
- Keep the current-position table small (one row per user). Put history in a separate, partitioned-by-time table.
- Cache geocoding results by normalised query / rounded coordinate (e.g. 5 decimals) with long TTLs.
- For >100k moving entities or sub-second updates, move hot positions to Redis GEO and flush to Postgres periodically.
- Consider H3 or geohash bucketing for aggregate stats and heatmaps rather than raw point queries.

## Coding conventions

- Language/framework: TypeScript (Node 22, ESM) + Fastify 5, zod for validation, jose for JWT, `pg` for Postgres. Layout and rationale in `docs/geolocation-service.md`.
- Migrations are versioned and reversible; PostGIS extension enabled in the first migration.
- Every query touching a spatial column has an `EXPLAIN` checked once to confirm the GiST index is used.
- Input validation: lat ∈ [-90, 90], lng ∈ [-180, 180], radius > 0 and ≤ max, accuracy ≥ 0.
- Tests: unit tests for validation and distance math; integration tests against a real PostGIS container (testcontainers or docker-compose), never a mock for spatial queries.
- Observability: request latency per endpoint, provider call counts and errors, cache hit rate, DB query time.

## How to work on this project

1. Before adding a feature, state the use case (nearby search, live tracking, geofenced check-in, etc.) and the accuracy/latency/privacy requirements it implies.
2. Prefer changing the schema over adding application-level workarounds for spatial logic.
3. When integrating a provider, wrap it behind an interface so it can be swapped; add caching and a circuit breaker.
4. Flag any change that increases stored location precision, retention, or sharing scope — it needs an explicit privacy review.
5. Keep this file updated when architectural decisions change.

## Open decisions

- [x] Backend language/framework — TypeScript + Fastify (decided 2026-09-12)
- [ ] Managed Postgres provider (local dev uses `docker-compose.yml`)
- [ ] Geocoding provider and budget (Nominatim by default, Mapbox adapter ready; `GEOCODER_PROVIDER`)
- [x] Whether live tracking is in scope for v1 — no; ports allow adding Redis GEO later
- [x] History retention period — 30 days default, `HISTORY_RETENTION_DAYS`
