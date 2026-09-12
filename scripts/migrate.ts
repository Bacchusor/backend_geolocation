import path from "node:path";
import { createPool } from "../src/infrastructure/db/pool.js";
import { migrateDown, migrateUp } from "../src/infrastructure/db/migrate.js";

const direction = process.argv[2] ?? "up";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const pool = createPool(url, process.env.DATABASE_SSL === "true");
const dir = path.resolve(process.cwd(), "migrations");
try {
  if (direction === "down") {
    const v = await migrateDown(pool, dir);
    console.log(v ? `reverted ${v}` : "nothing to revert");
  } else {
    const applied = await migrateUp(pool, dir);
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
  }
} finally {
  await pool.end();
}
