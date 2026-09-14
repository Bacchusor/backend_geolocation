CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_enc" text,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notion_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"token_enc" text,
	"database_id" text,
	"data_source_id" text,
	"mapping" jsonb DEFAULT '{"title":"Name","needed":"Needed","needed_means_true":true,"shop":"Shop","category":"Category"}'::jsonb NOT NULL,
	"sync_interval_seconds" integer DEFAULT 300 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_ok" boolean,
	"last_sync_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notion_items" (
	"page_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"shop" text,
	"category" text,
	"needed" boolean DEFAULT true NOT NULL,
	"url" text,
	"last_edited_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_locations" (
	"person" text PRIMARY KEY NOT NULL,
	"position" geography(Point,4326) NOT NULL,
	"accuracy_m" real,
	"recorded_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_group_members" (
	"group_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	CONSTRAINT "place_group_members_group_id_place_id_pk" PRIMARY KEY("group_id","place_id")
);
--> statement-breakpoint
CREATE TABLE "place_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_states" (
	"person" text NOT NULL,
	"place_id" uuid NOT NULL,
	"in_approach" boolean DEFAULT false NOT NULL,
	"in_enter" boolean DEFAULT false NOT NULL,
	"entered_at" timestamp with time zone,
	"dwell_notified" boolean DEFAULT false NOT NULL,
	"last_distance_m" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_states_person_place_id_pk" PRIMARY KEY("person","place_id")
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"position" geography(Point,4326) NOT NULL,
	"enter_radius_m" integer DEFAULT 100 NOT NULL,
	"approach_radius_m" integer DEFAULT 500 NOT NULL,
	"dwell_seconds" integer DEFAULT 120 NOT NULL,
	"icon" text DEFAULT 'mdi:cart' NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notion_shop" text,
	"notion_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"notion_min_items" integer DEFAULT 1 NOT NULL,
	"message_template" text DEFAULT '{count} items for {shop}: {items}' NOT NULL,
	"group_by_category" boolean DEFAULT false NOT NULL,
	"notion_url" text,
	"ha_zone_id" text,
	"ha_zone_entity_id" text,
	"ha_zone_synced_at" timestamp with time zone,
	"ha_zone_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"person" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"target" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"person" text NOT NULL,
	"place_id" uuid,
	"place_name" text,
	"rule_id" uuid,
	"rule_name" text,
	"trigger" text,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"distance_m" real,
	"matched_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivery" jsonb,
	"source" text DEFAULT 'location' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_recipients" (
	"rule_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	CONSTRAINT "rule_recipients_rule_id_recipient_id_pk" PRIMARY KEY("rule_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"place_id" uuid,
	"place_group_id" uuid,
	"trigger" text NOT NULL,
	"window_start" text,
	"window_end" text,
	"days_of_week" integer[] DEFAULT '{0,1,2,3,4,5,6}'::int[] NOT NULL,
	"cooldown_seconds" integer DEFAULT 3600 NOT NULL,
	"max_per_day" integer DEFAULT 5 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "place_group_members" ADD CONSTRAINT "place_group_members_group_id_place_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."place_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_group_members" ADD CONSTRAINT "place_group_members_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_states" ADD CONSTRAINT "place_states_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_events" ADD CONSTRAINT "rule_events_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_events" ADD CONSTRAINT "rule_events_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_recipients" ADD CONSTRAINT "rule_recipients_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_recipients" ADD CONSTRAINT "rule_recipients_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_place_group_id_place_groups_id_fk" FOREIGN KEY ("place_group_id") REFERENCES "public"."place_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notion_items_shop_idx" ON "notion_items" USING btree ("shop");--> statement-breakpoint
CREATE INDEX "pgm_place_idx" ON "place_group_members" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "places_position_idx" ON "places" USING gist ("position");--> statement-breakpoint
CREATE INDEX "places_active_idx" ON "places" USING btree ("active");--> statement-breakpoint
CREATE INDEX "recipients_person_idx" ON "recipients" USING btree ("person");--> statement-breakpoint
CREATE INDEX "rule_events_created_idx" ON "rule_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rule_events_person_created_idx" ON "rule_events" USING btree ("person","created_at");--> statement-breakpoint
CREATE INDEX "rule_events_rule_person_idx" ON "rule_events" USING btree ("rule_id","person","outcome","created_at");--> statement-breakpoint
CREATE INDEX "rules_place_idx" ON "rules" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "rules_group_idx" ON "rules" USING btree ("place_group_id");