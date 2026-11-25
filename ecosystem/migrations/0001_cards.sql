CREATE TABLE cards (user_id TEXT PRIMARY KEY, card_json TEXT NOT NULL CHECK(length(card_json)<=8192), updated_at INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, display_name TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);
