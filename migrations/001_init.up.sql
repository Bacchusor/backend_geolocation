CREATE EXTENSION IF NOT EXISTS postgis;

-- Current position, one row per user.
CREATE TABLE user_locations (
  user_id      UUID PRIMARY KEY,
  position     geography(Point, 4326) NOT NULL,
  accuracy_m   REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  recorded_at  TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_locations_position_idx ON user_locations USING GIST (position);

-- Short-lived history, purged by a scheduled job (see HISTORY_RETENTION_DAYS).
CREATE TABLE location_history (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  position     geography(Point, 4326) NOT NULL,
  accuracy_m   REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  recorded_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX location_history_user_time_idx ON location_history (user_id, recorded_at DESC);
CREATE INDEX location_history_recorded_at_idx ON location_history (recorded_at);

-- Searchable points of interest.
CREATE TABLE places (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  position     geography(Point, 4326) NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX places_position_idx ON places USING GIST (position);

-- Enter/exit transitions reported by the device's OS geofencing.
CREATE TABLE geofence_events (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  geofence_id  TEXT NOT NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN ('enter', 'exit')),
  occurred_at  TIMESTAMPTZ NOT NULL,
  position     geography(Point, 4326),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX geofence_events_user_time_idx ON geofence_events (user_id, occurred_at DESC);
