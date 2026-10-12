-- Public Gallery only. Private projects stay on the user's device or own cloud.
DROP TRIGGER projects_quota_insert;
DROP TRIGGER projects_quota_update;
DROP TRIGGER projects_storage_insert;
DROP TRIGGER projects_storage_update;
DROP TRIGGER projects_storage_delete;
DROP INDEX projects_user;
DROP TABLE projects;

ALTER TABLE users DROP COLUMN email;
ALTER TABLE users DROP COLUMN name;
ALTER TABLE users ADD COLUMN nick TEXT;
ALTER TABLE users ADD COLUMN nick_key TEXT;
ALTER TABLE users ADD COLUMN moderator INTEGER NOT NULL DEFAULT 0 CHECK (moderator IN (0, 1));
CREATE UNIQUE INDEX users_nick_key ON users(nick_key);
UPDATE users SET storage_bytes = COALESCE((SELECT SUM(size + thumb_size) FROM posts WHERE user_id = users.id), 0);

CREATE TABLE meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  gallery_version INTEGER NOT NULL DEFAULT 0,
  stored_bytes INTEGER NOT NULL DEFAULT 0 CHECK (stored_bytes >= 0)
);
INSERT INTO meta (id, stored_bytes) SELECT 1, COALESCE(SUM(size + thumb_size), 0) FROM posts;

-- These guards and counters run in the post write's transaction, including races.
CREATE TRIGGER posts_cloud_quota_insert BEFORE INSERT ON posts BEGIN
  SELECT RAISE(ABORT, 'HOODOO_CLOUD_FULL') WHERE
    (SELECT stored_bytes FROM meta WHERE id = 1) + NEW.size + NEW.thumb_size > 10737418240;
END;
CREATE TRIGGER posts_cloud_storage_insert AFTER INSERT ON posts BEGIN
  UPDATE meta SET stored_bytes = stored_bytes + NEW.size + NEW.thumb_size,
    gallery_version = gallery_version + CASE WHEN NEW.hidden = 0 THEN 1 ELSE 0 END WHERE id = 1;
END;
CREATE TRIGGER posts_cloud_storage_delete AFTER DELETE ON posts BEGIN
  UPDATE meta SET stored_bytes = stored_bytes - OLD.size - OLD.thumb_size,
    gallery_version = gallery_version + CASE WHEN OLD.hidden = 0 THEN 1 ELSE 0 END WHERE id = 1;
END;
-- Reports/reasons are private. Only changes to shared fields invalidate the list.
CREATE TRIGGER posts_gallery_update AFTER UPDATE OF title, likes, dislikes, hidden, thumb_key, created_at ON posts
WHEN (OLD.hidden = 0 OR NEW.hidden = 0) AND (
  OLD.title IS NOT NEW.title OR OLD.likes IS NOT NEW.likes OR
  OLD.dislikes IS NOT NEW.dislikes OR OLD.hidden IS NOT NEW.hidden OR
  OLD.thumb_key IS NOT NEW.thumb_key OR OLD.created_at IS NOT NEW.created_at
) BEGIN
  UPDATE meta SET gallery_version = gallery_version + 1 WHERE id = 1;
END;
CREATE TRIGGER users_gallery_nick AFTER UPDATE OF nick ON users
WHEN OLD.nick IS NOT NEW.nick AND EXISTS (SELECT 1 FROM posts WHERE user_id = NEW.id AND hidden = 0) BEGIN
  UPDATE meta SET gallery_version = gallery_version + 1 WHERE id = 1;
END;
CREATE INDEX posts_owner ON posts(user_id, created_at DESC);
