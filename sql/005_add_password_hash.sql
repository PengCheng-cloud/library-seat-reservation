-- Migration for databases created before password login was added.
-- New installations already get this column from 001_schema.sql.
ALTER TABLE `app_user`
  ADD COLUMN `password_hash` VARCHAR(255) NULL COMMENT '密码哈希 (scrypt)' AFTER `remark`;
