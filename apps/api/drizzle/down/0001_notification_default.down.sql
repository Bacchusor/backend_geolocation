-- Reverse of 0001_notification_default.sql
ALTER TABLE "places" ALTER COLUMN "message_template" SET DEFAULT '{count} items for {shop}: {items}';
