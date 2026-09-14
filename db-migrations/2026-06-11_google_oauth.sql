-- Migration: add Google sign-in support to the users table.
--
-- For FRESH databases this is already baked into mysql/100_user_db.sql. Apply this
-- file only to EXISTING databases (whose volume was created before Google sign-in):
--
--   docker exec -i dms-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" dms_db' \
--     < db-migrations/2026-06-11_google_oauth.sql
--
-- It is idempotent: re-running it is safe.

-- 1) Add the google_sub column (unique, nullable) if it is not already present.
SET @col_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_sub'
);
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) NULL UNIQUE AFTER password_hash',
    'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Relax chk_auth so a registered account may be passwordless when it has a linked
--    Google identity. Drop the old constraint first (if present), then re-add.
SET @chk_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND CONSTRAINT_NAME = 'chk_auth'
);
SET @ddl := IF(@chk_exists > 0, 'ALTER TABLE users DROP CHECK chk_auth', 'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE users ADD CONSTRAINT chk_auth CHECK (
    (role = 'guest' AND password_hash IS NULL) OR
    (role IN ('user', 'doctor', 'admin') AND (password_hash IS NOT NULL OR google_sub IS NOT NULL))
);
