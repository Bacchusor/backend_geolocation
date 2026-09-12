# backend_geolocation

Geolocation services backend for the mobile app: position upload with
server-side plausibility checks, PostGIS nearby search, cached geocoding,
geofence event ingestion, and GDPR export/erasure.

- TypeScript, Fastify 5, PostgreSQL + PostGIS, zod, jose
- Clean architecture: `domain` → `application` → `infrastructure` / `http`
- Unit tests on in-memory adapters, integration tests on a real PostGIS container

Full documentation: [docs/geolocation-service.md](docs/geolocation-service.md).

```bash
docker compose up -d db && cp .env.example .env && npm install && npm run migrate && npm run dev
npm test
```
