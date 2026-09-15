-- Notification = shop name (title) + number of items (message). New default for places without a custom template.
ALTER TABLE "places" ALTER COLUMN "message_template" SET DEFAULT '{count} items to buy';
--> statement-breakpoint
UPDATE "places" SET "message_template" = '{count} items to buy' WHERE "message_template" = '{count} items for {shop}: {items}';
