CREATE DATABASE IF NOT EXISTS cheers CHARACTER SET utf8mb4;
USE cheers;

CREATE TABLE users (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  phone         VARCHAR(16) NOT NULL UNIQUE,          -- E.164, never returned by the API
  first_name    VARCHAR(21) NOT NULL,
  confirmed_18_at DATETIME NOT NULL,                  -- when the user ticked "I am 18+"
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at    DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())
);

CREATE TABLE otp_codes (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  phone      VARCHAR(16) NOT NULL,
  code_hash  CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts   TINYINT NOT NULL DEFAULT 0,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  INDEX (phone, created_at)
);

-- One row per user who is "live". Coordinates are snapped to ~110 m before storage.
CREATE TABLE presence (
  user_id    BIGINT PRIMARY KEY,
  lat        DECIMAL(7,4) NOT NULL,
  lng        DECIMAL(7,4) NOT NULL,
  note       VARCHAR(60) NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (expires_at),
  INDEX (lat, lng)
);

CREATE TABLE presence_drinks (
  id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id  BIGINT NOT NULL,
  category ENUM('alcohol','wine','soda') NOT NULL,
  item     VARCHAR(40) NOT NULL,
  quantity VARCHAR(30) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES presence(user_id) ON DELETE CASCADE
);

CREATE TABLE swipes (
  from_user  BIGINT NOT NULL,
  to_user    BIGINT NOT NULL,
  action     ENUM('like','pass') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (from_user, to_user),
  FOREIGN KEY (from_user) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE matches (
  user_a     BIGINT NOT NULL,                         -- always the smaller id
  user_b     BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (user_a, user_b),
  FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE blocks (
  blocker BIGINT NOT NULL,
  blocked BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (blocker, blocked),
  FOREIGN KEY (blocker) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE reports (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  reporter   BIGINT NOT NULL,
  reported   BIGINT NOT NULL,
  reason     VARCHAR(200) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  UNIQUE (reporter, reported),
  FOREIGN KEY (reporter) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reported) REFERENCES users(id) ON DELETE CASCADE
);

-- Purge expired presence every 10 minutes (MySQL event scheduler must be ON).
CREATE EVENT IF NOT EXISTS purge_presence
  ON SCHEDULE EVERY 10 MINUTE
  DO DELETE FROM presence WHERE expires_at < UTC_TIMESTAMP();

-- Chat (also in chat.sql for databases created before chat was added)
CREATE TABLE messages (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_a     BIGINT NOT NULL,                         -- match pair, user_a is the smaller id
  user_b     BIGINT NOT NULL,
  sender     BIGINT NOT NULL,
  body       VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  INDEX (user_a, user_b, id),
  FOREIGN KEY (user_a, user_b) REFERENCES matches(user_a, user_b) ON DELETE CASCADE,
  FOREIGN KEY (sender) REFERENCES users(id) ON DELETE CASCADE
);

-- Messages are deleted after 7 days.
CREATE EVENT IF NOT EXISTS purge_messages
  ON SCHEDULE EVERY 1 HOUR
  DO DELETE FROM messages WHERE created_at < UTC_TIMESTAMP() - INTERVAL 7 DAY;
