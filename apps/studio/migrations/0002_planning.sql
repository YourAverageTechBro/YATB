CREATE TABLE "video" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 200),
  "format" TEXT NOT NULL CHECK ("format" IN ('short', 'long')),
  "promotion" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN (
    'not-started', 'filming', 'ready-to-edit', 'ready-to-review', 'published'
  )),
  "publish_date" TEXT CHECK (
    "publish_date" IS NULL OR "publish_date" GLOB '????-??-??'
  ),
  "script_json" TEXT NOT NULL CHECK (length("script_json") <= 32768),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER,
  CHECK (
    ("format" = 'short' AND "promotion" IN ('organic', 'advertisement'))
    OR
    ("format" = 'long' AND "promotion" IN ('organic', 'integration'))
  )
);

CREATE INDEX "video_active_updated_idx"
  ON "video" ("deleted_at", "updated_at" DESC);
CREATE INDEX "video_active_status_updated_idx"
  ON "video" ("deleted_at", "status", "updated_at" DESC);
CREATE INDEX "video_active_format_updated_idx"
  ON "video" ("deleted_at", "format", "updated_at" DESC);

CREATE TABLE "saved_view" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "owner_user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "name" TEXT COLLATE NOCASE NOT NULL CHECK (length("name") BETWEEN 1 AND 80),
  "layout" TEXT NOT NULL CHECK ("layout" IN ('list', 'board')),
  "group_by" TEXT NOT NULL CHECK ("group_by" IN ('none', 'status', 'format')),
  "status_filter" TEXT NOT NULL CHECK ("status_filter" IN (
    'all', 'not-started', 'filming', 'ready-to-edit', 'ready-to-review', 'published'
  )),
  "format_filter" TEXT NOT NULL CHECK ("format_filter" IN ('all', 'short', 'long')),
  "sort" TEXT NOT NULL CHECK ("sort" IN (
    'updated-desc', 'publish-date-asc', 'title-asc'
  )),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  CHECK (
    ("layout" = 'list' AND "group_by" IN ('none', 'status', 'format'))
    OR
    ("layout" = 'board' AND "group_by" = 'status')
  ),
  UNIQUE ("owner_user_id", "name")
);

CREATE INDEX "saved_view_owner_updated_idx"
  ON "saved_view" ("owner_user_id", "updated_at" DESC);
