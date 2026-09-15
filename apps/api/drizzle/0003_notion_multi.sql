ALTER TABLE "notion_items" ADD COLUMN "shops" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "notion_items" ADD COLUMN "categories" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Backfill from the joined display values written by earlier versions
UPDATE "notion_items" SET "shops" = string_to_array("shop", ', ') WHERE "shop" IS NOT NULL AND "shops" = '{}';--> statement-breakpoint
UPDATE "notion_items" SET "categories" = string_to_array("category", ', ') WHERE "category" IS NOT NULL AND "categories" = '{}';
