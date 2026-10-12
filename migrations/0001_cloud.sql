-- Hoodoo cloud (worker/, docs/cloud.md): accounts, private saves, the public gallery,
-- votes, reports and rate limits. Times are Unix milliseconds. Scene files and pictures
-- live in R2 or KV under the keys stored here.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  -- Google's stable account id ("sub"); dev sign-ins use "dev:<email>".
  subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Only a hash of the cookie's token is kept: a leaked table opens no sessions.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Until when the last Turnstile check counts.
  human_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  scene_key TEXT NOT NULL,
  thumb_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX projects_user ON projects(user_id, updated_at DESC);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  size INTEGER NOT NULL,
  scene_key TEXT NOT NULL,
  thumb_key TEXT,
  created_at INTEGER NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX posts_new ON posts(hidden, created_at DESC);
CREATE INDEX posts_top ON posts(hidden, (likes - dislikes) DESC, created_at DESC);
CREATE INDEX posts_reported ON posts(reports DESC, created_at DESC);

-- One vote per user per post: 1 likes, -1 dislikes.
CREATE TABLE votes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- One report per user per post.
CREATE TABLE reports (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- Fixed-window counters per user and action (worker/rate.ts).
CREATE TABLE rate (
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, action)
);
