# Snippets for the `homelab-monitoring` docs

The homelab repo's standing rule is "every modification updates the docs in the same change". This
repository cannot commit there, so here is what to paste after deploying GeoReminder to pre-production.

## `docs/03-SERVICES.md` — new row

| Service                          | Where / URL                                                                                                       | Data / config                                                                                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GeoReminder 0.1 (pre-production) | rp48 / portainer-local (.111): API http://192.168.1.111:3000 (`/docs` = OpenAPI), admin http://192.168.1.111:3080 | `/opt/georeminder/{docker-compose.yml,.env}` (compose project `georeminder`; volume `georeminder_georeminder-pgdata` = PostgreSQL 16 + PostGIS 3.5) | Geolocation rules service: Home Assistant forwards `device_tracker` positions and zone events to `/v1/location` / `/v1/geofence/events` (header `x-api-key`), the service matches places against the Notion shopping list and pushes through `notify.mobile_app_*`; saving a place creates the HA zone `zone.gr_<name>`. Repo `Bacchusor/backend_geolocation` (branch `georeminder`), images `ghcr.io/bacchusor/georeminder-{api,admin}` built by GitHub Actions (multi-arch). Credentials: `GEOREMINDER_API_KEY`, `GEOREMINDER_ADMIN_PASSWORD` (admin user `admin`); the HA channel uses `HA_ADMIN_TOKEN`. Deploy: `scripts/deploy-preprod.sh` from the repo or Portainer stack on rp48. To promote to .152 later: same compose, new `.env`. |

## `docs/02-HOSTS.md` — rp48 section, containers list

- **georeminder** (compose project in `/opt/georeminder`, deployed 2026-09-15 as pre-production):
  georeminder-api (`ghcr.io/bacchusor/georeminder-api`, 3000), georeminder-admin
  (`ghcr.io/bacchusor/georeminder-admin`, nginx-unprivileged, 3080→8080), georeminder-postgis
  (`imresamu/postgis:16-3.5`, no host port, volume `georeminder_georeminder-pgdata`).
- Listening: add **3000 3080**.

## `docs/05-OPERATIONS.md`

- Access model row: **GeoReminder** — admin UI http://192.168.1.111:3080 (`admin` / `GEOREMINDER_ADMIN_PASSWORD`);
  machine API header `x-api-key: GEOREMINDER_API_KEY`; `/v1/health` + `/v1/ready` are public.
- Deploy workflow, apps: `georeminder` is **not** in the homelab-monitoring repo; it is deployed from
  `Bacchusor/backend_geolocation` with `scripts/deploy-preprod.sh` (ssh + `docker compose pull && up -d` in
  `/opt/georeminder`). Rollback = deploy with a previous `sha-<short>` tag.
- Backups worth taking: `docker exec georeminder-postgis pg_dump -U georeminder -d georeminder -Fc` and
  `/opt/georeminder/.env` (holds `ENCRYPTION_KEY`, without which the stored Notion/HA tokens are unreadable).
- Known quirk: `postgis/postgis` official images are amd64-only; the stack uses `imresamu/postgis` on the Pi.

## `.secrets.env.example` — new keys

```
# --- GeoReminder (pre-production on rp48, apps: Bacchusor/backend_geolocation) ---
GEOREMINDER_API_KEY=
GEOREMINDER_ADMIN_PASSWORD=
```

## Home Assistant (`docs/03-SERVICES.md`, HA entry)

- `rest_command.georeminder_location` / `rest_command.georeminder_zone_event` + two automations per person
  (see the README of backend_geolocation, section "Home Assistant setup"); `secrets.yaml` key
  `georeminder_api_key`. Zones `zone.gr_*` are managed by GeoReminder — do not edit them by hand.
- Monitoring: add `http://192.168.1.111:3000/v1/ready` to the `blackbox_http` probes (instance `georeminder-pre`).
