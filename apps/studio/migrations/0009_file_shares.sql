CREATE TABLE "media_file_share" (
  "media_file_id" TEXT PRIMARY KEY NOT NULL REFERENCES "media_file" ("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE CHECK (length("token") = 64),
  "created_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "created_at" INTEGER NOT NULL
);
