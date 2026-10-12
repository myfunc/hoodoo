-- Count both files. Legacy pictures use their maximum size until replaced.
ALTER TABLE projects ADD COLUMN thumb_size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN deleting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN thumb_size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN hidden_reason TEXT;
ALTER TABLE posts ADD COLUMN deleting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN storage_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN deleting INTEGER NOT NULL DEFAULT 0;
UPDATE projects SET thumb_size = 512000 WHERE thumb_key IS NOT NULL;
UPDATE posts SET thumb_size = 512000 WHERE thumb_key IS NOT NULL;
UPDATE users SET storage_bytes =
  COALESCE((SELECT SUM(size + thumb_size) FROM projects WHERE user_id = users.id), 0) +
  COALESCE((SELECT SUM(size + thumb_size) FROM posts WHERE user_id = users.id), 0);

-- Atomic guards also cover concurrent saves after the request's early check.
CREATE TRIGGER projects_quota_insert BEFORE INSERT ON projects BEGIN
  SELECT RAISE(ABORT, 'HOODOO_ACCOUNT_DELETING') WHERE (SELECT deleting FROM users WHERE id = NEW.user_id) = 1;
  SELECT RAISE(ABORT, 'HOODOO_STORAGE_FULL') WHERE
    (SELECT storage_bytes FROM users WHERE id = NEW.user_id) + NEW.size + NEW.thumb_size > 52428800;
END;
CREATE TRIGGER projects_quota_update BEFORE UPDATE OF size, thumb_size ON projects BEGIN
  SELECT RAISE(ABORT, 'HOODOO_PROJECT_DELETING') WHERE OLD.deleting = 1;
  SELECT RAISE(ABORT, 'HOODOO_ACCOUNT_DELETING') WHERE (SELECT deleting FROM users WHERE id = NEW.user_id) = 1;
  SELECT RAISE(ABORT, 'HOODOO_STORAGE_FULL') WHERE
    NEW.size + NEW.thumb_size > OLD.size + OLD.thumb_size AND
    (SELECT storage_bytes FROM users WHERE id = NEW.user_id) - OLD.size - OLD.thumb_size + NEW.size + NEW.thumb_size > 52428800;
END;
CREATE TRIGGER projects_storage_insert AFTER INSERT ON projects BEGIN
  UPDATE users SET storage_bytes = storage_bytes + NEW.size + NEW.thumb_size WHERE id = NEW.user_id;
END;
CREATE TRIGGER projects_storage_update AFTER UPDATE OF size, thumb_size ON projects BEGIN
  UPDATE users SET storage_bytes = storage_bytes - OLD.size - OLD.thumb_size + NEW.size + NEW.thumb_size WHERE id = NEW.user_id;
END;
CREATE TRIGGER projects_storage_delete AFTER DELETE ON projects BEGIN
  UPDATE users SET storage_bytes = storage_bytes - OLD.size - OLD.thumb_size WHERE id = OLD.user_id;
END;
CREATE TRIGGER posts_quota_insert BEFORE INSERT ON posts BEGIN
  SELECT RAISE(ABORT, 'HOODOO_ACCOUNT_DELETING') WHERE (SELECT deleting FROM users WHERE id = NEW.user_id) = 1;
  SELECT RAISE(ABORT, 'HOODOO_STORAGE_FULL') WHERE
    (SELECT storage_bytes FROM users WHERE id = NEW.user_id) + NEW.size + NEW.thumb_size > 52428800;
END;
CREATE TRIGGER posts_storage_insert AFTER INSERT ON posts BEGIN
  UPDATE users SET storage_bytes = storage_bytes + NEW.size + NEW.thumb_size WHERE id = NEW.user_id;
END;
CREATE TRIGGER posts_storage_delete AFTER DELETE ON posts BEGIN
  UPDATE users SET storage_bytes = storage_bytes - OLD.size - OLD.thumb_size WHERE id = OLD.user_id;
END;
CREATE INDEX posts_owner_hidden ON posts(user_id, hidden, created_at DESC);
CREATE INDEX votes_user ON votes(user_id, post_id);
CREATE INDEX reports_user ON reports(user_id, post_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX rate_window ON rate(window_start);
