CREATE UNIQUE INDEX "saved_view_owner_id_idx"
  ON "saved_view" ("owner_user_id", "id");

CREATE TABLE "user_video_preference" (
  "owner_user_id" TEXT PRIMARY KEY NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "default_saved_view_id" TEXT NOT NULL,
  FOREIGN KEY ("owner_user_id", "default_saved_view_id")
    REFERENCES "saved_view" ("owner_user_id", "id") ON DELETE CASCADE
);
