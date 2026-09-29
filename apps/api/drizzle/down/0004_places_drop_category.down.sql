-- Reverse of 0004_places_drop_category.sql (previous per-place category filters are not restored)
ALTER TABLE "places" ADD COLUMN IF NOT EXISTS "notion_categories" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "places" ADD COLUMN IF NOT EXISTS "group_by_category" boolean DEFAULT false NOT NULL;
