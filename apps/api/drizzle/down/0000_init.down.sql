-- Reverse of 0000_init.sql (manual; apply with psql if a rollback is ever needed)
DROP TABLE IF EXISTS rule_events, rule_recipients, rules, place_states, person_locations, notion_items, notion_config, recipients, channels, place_group_members, place_groups, places CASCADE;
DELETE FROM drizzle.__drizzle_migrations;
