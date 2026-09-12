/**
 * Loads places from a JSON file: [{ "name": "...", "lat": 48.85, "lng": 2.35, "metadata": {...} }]
 *   DATABASE_URL=... npx tsx scripts/seed-places.ts data/places.json
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createPool } from "../src/infrastructure/db/pool.js";

const url = process.env.DATABASE_URL;
const file = process.argv[2];
if (!url) throw new Error("DATABASE_URL is required");
if (!file) throw new Error("usage: seed-places.ts <places.json>");

const schema = z.array(
  z.object({
    name: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    metadata: z.record(z.unknown()).default({}),
  }),
);
const places = schema.parse(JSON.parse(await readFile(file, "utf8")));

const pool = createPool(url, process.env.DATABASE_SSL === "true");
try {
  await pool.query(
    `INSERT INTO places (name, position, metadata)
     SELECT n, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, m
     FROM unnest($1::text[], $2::float8[], $3::float8[], $4::jsonb[]) AS t(n, lng, lat, m)`,
    [places.map((p) => p.name), places.map((p) => p.lng), places.map((p) => p.lat), places.map((p) => JSON.stringify(p.metadata))],
  );
  console.log(`inserted ${places.length} places`);
} finally {
  await pool.end();
}
