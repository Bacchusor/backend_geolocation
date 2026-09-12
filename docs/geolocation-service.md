# Geolocation Service

Backend for the mobile app's location features: position upload, nearby search,
geocoding, geofence event ingestion, and the user's export/erasure rights.

## Use cases and requirements

| Use case | Endpoint | Accuracy | Latency | Privacy |
|---|---|---|---|---|
| Keep the user's current position fresh | `POST /v1/location` | Device accuracy stored, poor fixes dropped | Not latency-critical, batched by the client | Only the owner can read or write it |
| "What is around me" | `GET /v1/nearby` | Coarse is enough (client may send a rounded position) | < 100 ms on an indexed `places` table | Query coordinates are never logged |
| Search an address / label a map tap | `GET /v1/geocode`, `GET /v1/reverse` | Provider accuracy | Cached, provider timeout 4 s | Coordinates rounded to 5 decimals before caching |
| Check-in / notifications when entering a zone | `POST /v1/geofence/events` | Decided on device by the OS | Async, 202 | Events attributed to the token subject only |
| GDPR access and erasure | `GET /v1/location/export`, `DELETE /v1/location` | n/a | n/a | Whole footprint of one user |

Live position sharing between users is **out of scope** for this version. The
architecture supports it later (Redis GEO + pub/sub behind the same ports)
without changing the API surface described here.

## Architecture

Clean architecture with four layers. Dependencies point inwards only.

```
src/
  domain/          Pure TypeScript, no I/O. Value objects, business rules, ports.
    coordinates.ts     lat/lng validation, haversine, rounding
    location.ts        LocationFix, FixPolicy, evaluateFix (plausibility rules)
    ports.ts           Repository / Geocoder / Cache / Clock interfaces
  application/     One use case per file. Depends on domain ports only.
    update-location.ts find-nearby.ts geocode.ts record-geofence-events.ts
    user-data.ts (export + erase)      purge-history.ts (retention job)
  infrastructure/  Adapters implementing the ports.
    db/            pg pool, migration runner, PostGIS repositories
    geocoding/     Nominatim, Mapbox, circuit breaker, resilient wrapper
    cache/         in-memory TTL cache (swap for Redis behind the same port)
  http/            Fastify: auth plugin, zod schemas, routes, error mapping
  composition.ts   Wires config → adapters → use cases → server
  main.ts          Process entrypoint
migrations/        Versioned SQL, up/down pairs
scripts/           migrate, purge, seed-places
test/
  unit/            Domain, use cases, HTTP (in-memory adapters, ~1 s)
  integration/     Real PostGIS via testcontainers (skips without Docker)
```

Why this shape: spatial logic lives in SQL where the GiST index is; validation
and plausibility rules live in the domain where they are unit-tested without a
database; HTTP is a thin translation layer. Adding a Redis cache or a Google
geocoder means one new file in `infrastructure/` and one line in
`composition.ts`.

## Data model

See [migrations/001_init.up.sql](../migrations/001_init.up.sql).

| Table | Purpose | Retention |
|---|---|---|
| `user_locations` | One row per user, the current position | Until the user deletes |
| `location_history` | Every accepted fix | `HISTORY_RETENTION_DAYS` (default 30), purged by `npm run purge` |
| `places` | Searchable points of interest | Static |
| `geofence_events` | Enter/exit transitions reported by the device | Deleted with the user; add to the purge job if volume grows |

All positions are `geography(Point, 4326)` with a GiST index. Longitude comes
before latitude in `ST_MakePoint`. The nearby query uses `ST_DWithin` in
`WHERE` (index-driven) and `ST_Distance` only for ordering; the integration
test asserts with `EXPLAIN` that `places_position_idx` is used.

## API

All endpoints except `/healthz` require `Authorization: Bearer <JWT>`. The
user id is always the token's `sub` claim (must be a UUID); nothing in a body
or query can address another user. Timestamps are ISO-8601 with offset,
coordinates are decimal degrees, distances and radii are metres.

### `POST /v1/location`

Upload one fix or a batch (the client should batch every ~30 s or 50 m and
flush queued fixes when back online).

```json
{ "lat": 48.8566, "lng": 2.3522, "accuracy": 12, "timestamp": "2026-09-12T10:00:00Z" }
```
or
```json
{ "fixes": [ { "lat": 48.8566, "lng": 2.3522, "accuracy": 12, "timestamp": "2026-09-12T09:59:30Z" }, ... ] }
```

Each fix receives one of three verdicts, decided in `evaluateFix`:

| Verdict | Condition | Effect |
|---|---|---|
| current | fresh (≤ `MAX_FIX_AGE_SECONDS`), newer than the stored position, speed vs. previous position ≤ `MAX_SPEED_MPS` after subtracting both accuracy radii | Becomes current and is archived |
| history | stale, or older than the stored current position | Archived only |
| reject | timestamp more than 60 s in the future, or accuracy worse than `MAX_ACCEPTED_ACCURACY_M`, or implausible speed | Dropped and reported |

Response `200`:
```json
{
  "accepted": 2,
  "rejected": [ { "index": 2, "reason": "fix accuracy too poor (9999m)" } ],
  "currentUpdated": true,
  "current": { "lat": 48.8567, "lng": 2.3523, "accuracy": 12, "recordedAt": "...", "updatedAt": "..." }
}
```

Dropped fixes are reported in the body rather than as an error so a client can
resynchronise its clock or accuracy settings without retry storms. Max 100
fixes per request, 12 requests per minute per user.

### `GET /v1/location`

Current position of the caller, `404` if none.

### `GET /v1/nearby?lat=&lng=&radius=&limit=&offset=`

Places within `radius` metres (≤ `MAX_NEARBY_RADIUS_M`, default 50 km),
sorted by distance. `limit` 1–50 (default 20). Response:

```json
{ "center": {"lat": 48.8566, "lng": 2.3522}, "radius": 2000, "limit": 20, "offset": 0,
  "results": [ { "id": "…", "name": "Notre-Dame", "lat": 48.853, "lng": 2.3499, "distance": 429.3, "metadata": {} } ] }
```

### `GET /v1/geocode?q=&limit=` and `GET /v1/reverse?lat=&lng=`

Forward and reverse geocoding through the configured provider. Results are
cached (default 30 days) by normalised query, or by coordinate rounded to
5 decimals for reverse lookups. Provider failures open a circuit breaker after
5 consecutive errors and return `503 PROVIDER_UNAVAILABLE` for 30 s.
Reverse returns `404` when the provider has no address.

### `POST /v1/geofence/events`

```json
{ "events": [ { "geofenceId": "office", "type": "enter", "occurredAt": "2026-09-12T08:00:00Z", "lat": 48.85, "lng": 2.35 } ] }
```

Returns `202 { "stored": n }`. Geofences are evaluated on the device
(CoreLocation regions / Android Geofencing API); the server only records the
transitions.

### `GET /v1/location/export` and `DELETE /v1/location`

Export returns current position, history and geofence events for the caller
(GDPR Art. 15, limited to 5 requests per hour). Delete removes all of it and
returns `204` (Art. 17).

### Errors

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "invalid request", "details": [ { "path": "lat", "message": "…" } ] } }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Schema or domain validation failed |
| 401 | `UNAUTHORIZED` | Missing, invalid, expired token, or non-UUID subject |
| 404 | `NOT_FOUND` | No current position / no reverse-geocode result |
| 413 | `FST_ERR_CTP_BODY_TOO_LARGE` | Body above 64 KB |
| 429 | `FST_ERR_RATE_LIMIT` | Per-user (or per-IP when anonymous) limit hit |
| 503 | `PROVIDER_UNAVAILABLE` | Geocoding provider down or circuit open |
| 500 | `INTERNAL_ERROR` | Anything else; details only in server logs with the request id |

## Security

- **Authentication**: every route except `/healthz` verifies a JWT (HS256 shared
  secret for development, RS256/ES256 via the identity provider's JWKS in
  production). Issuer and audience are enforced, clock tolerance 30 s.
- **Authorisation**: the user id is derived from the token only. Tests assert a
  `userId` in the body is ignored.
- **Untrusted client location**: `evaluateFix` applies staleness, future-skew,
  accuracy and velocity checks before any fix becomes the current position.
  Nothing in this service uses client location for pricing, access or
  compliance decisions.
- **Input validation**: zod at the edge, domain value objects inside. Latitude
  ∈ [-90, 90], longitude ∈ [-180, 180], radius > 0 and capped, accuracy ≥ 0,
  batch sizes capped, query length capped.
- **Rate limits**: global 120/min, `POST /location` 12/min, `nearby` 60/min,
  geocoding 30/min, export 5/hour, keyed by user id.
- **Transport hardening**: helmet headers, 64 KB body limit, 10 s statement
  timeout, 4 s provider timeout, opaque 500s.
- **Logging**: request logs contain method, path and request id only. Query
  strings, bodies and the Authorization header are never logged.
- **Data minimisation**: one current row per user, history purged after the
  retention window, export and erasure endpoints.
- **Dependencies**: `npm audit` reports issues only in the dev-only
  testcontainers chain; runtime dependencies are clean at the time of writing.

Anything that increases stored precision, retention or sharing scope needs a
privacy review before merging.

## Configuration

Copy `.env.example` to `.env`. All variables are validated at startup by
`src/config.ts`; the process refuses to start with an invalid configuration.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL with PostGIS |
| `JWT_SECRET` / `JWT_JWKS_URL` | one required | HS256 secret (≥ 32 chars) or JWKS endpoint |
| `JWT_ISSUER`, `JWT_AUDIENCE` | required | Enforced on every token |
| `GEOCODER_PROVIDER` | `nominatim` | `nominatim` or `mapbox` (needs `MAPBOX_ACCESS_TOKEN`) |
| `NOMINATIM_USER_AGENT` | | Public Nominatim requires an identifying UA and ≤ 1 req/s; use Mapbox beyond hobby traffic |
| `GEOCODE_CACHE_TTL_SECONDS` | 30 days | |
| `MAX_NEARBY_RADIUS_M` | 50000 | |
| `MAX_FIX_AGE_SECONDS` | 600 | Older fixes go to history only |
| `MAX_SPEED_MPS` | 350 | Airliner speed |
| `MAX_ACCEPTED_ACCURACY_M` | 500 | Worse fixes are dropped |
| `HISTORY_RETENTION_DAYS` | 30 | Used by `npm run purge` |
| `TRUST_PROXY` | false | Set `true` behind a load balancer so rate limits see the client IP |

## Running

```bash
docker compose up -d db          # local PostGIS
cp .env.example .env
npm install
npm run migrate
npm run seed:places data/places.example.json   # optional
npm run dev
```

Mint a development token (HS256, matches `.env.example`):

```bash
node -e '
const { SignJWT } = require("jose");
new SignJWT({}).setProtectedHeader({alg:"HS256"}).setSubject("11111111-1111-4111-8111-111111111111")
  .setIssuer("https://your-idp.example.com/").setAudience("geolocation-api").setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode("change-me-to-a-long-random-string-at-least-32-chars")).then(console.log)'
```

```bash
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"lat":48.8566,"lng":2.3522,"accuracy":12,"timestamp":"'$(date -u +%FT%TZ)'"}' \
  localhost:3000/v1/location
curl -H "Authorization: Bearer $TOKEN" 'localhost:3000/v1/nearby?lat=48.8566&lng=2.3522&radius=2000'
```

Schedule `npm run purge` daily (cron, Kubernetes CronJob, or the platform's
scheduler).

## Testing

```bash
npm test                # unit + integration (integration skips without Docker)
npm run test:unit       # ~1 s, no external services
npm run test:integration
```

Unit tests cover coordinate validation, distance math, fix plausibility rules,
the update-location use case, geocode caching, the circuit breaker, config
validation, and the full HTTP surface (auth failures, cross-user isolation,
validation, rate limits, security headers, error opacity) on in-memory
adapters. Integration tests run the migrations against `postgis/postgis:16-3.4`
and verify upserts, coordinate precision, nearby ordering/radius/pagination,
GiST index usage via `EXPLAIN`, per-user deletion, retention purge and geofence
event storage.

## Mobile client notes

- Send `accuracy` from the OS fix; the server drops fixes worse than 500 m.
- Batch fixes and upload every 30 s / 50 m; flush the queue after reconnecting.
  Stale fixes are archived, they do not overwrite the current position.
- Use `currentUpdated: false` plus a `rejected` reason to detect clock skew or
  a degraded GPS and adapt locally.
- Reverse-geocode on a map tap, not per list row; the server cache makes
  repeated taps on the same spot free.
- Register geofences with the OS and forward transitions; do not poll the
  server for geofence state.

## Extending

| Need | Change |
|---|---|
| Multiple instances | Implement `Cache` on Redis, register it in `composition.ts` |
| Live tracking of many users | Add a `HotPositionStore` port backed by Redis GEO, publish updates over pub/sub; keep `user_locations` as the durable copy |
| Another geocoder | Implement `Geocoder`, wrap with `ResilientGeocoder` |
| History analytics | Partition `location_history` by month before volume grows |
