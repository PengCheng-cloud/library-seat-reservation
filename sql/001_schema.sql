SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `library_seat_reservation`
DEFAULT CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE `library_seat_reservation`;

CREATE TABLE IF NOT EXISTS `app_user` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `open_id` VARCHAR(64) NULL COMMENT '微信openid',
  `union_id` VARCHAR(64) NULL COMMENT '微信unionid',
  `student_no` VARCHAR(32) NOT NULL COMMENT '学号或工号',
  `real_name` VARCHAR(32) NOT NULL COMMENT '姓名',
  `mobile` VARCHAR(20) NULL COMMENT '手机号',
  `avatar_url` VARCHAR(255) NULL COMMENT '头像地址',
  `role` ENUM('reader', 'admin', 'super_admin') NOT NULL DEFAULT 'reader' COMMENT '用户角色',
  `status` ENUM('pending', 'active', 'disabled') NOT NULL DEFAULT 'active' COMMENT '用户状态',
  `credit_score` SMALLINT UNSIGNED NOT NULL DEFAULT 100 COMMENT '当前信用分',
  `violation_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计违约次数',
  `is_blacklisted` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否在黑名单中',
  `blacklist_until` DATETIME NULL COMMENT '黑名单截止时间',
  `last_login_at` DATETIME NULL COMMENT '最近登录时间',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `password_hash` VARCHAR(255) NULL COMMENT '密码哈希 (scrypt)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_app_user_student_no` (`student_no`),
  UNIQUE KEY `uk_app_user_open_id` (`open_id`),
  KEY `idx_app_user_role_status` (`role`, `status`),
  KEY `idx_app_user_blacklist` (`is_blacklisted`, `blacklist_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统用户表';

CREATE TABLE IF NOT EXISTS `library_zone` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `zone_code` VARCHAR(16) NOT NULL COMMENT '分区编码',
  `floor_no` TINYINT UNSIGNED NOT NULL DEFAULT 7 COMMENT '楼层号',
  `grid_letter` VARCHAR(4) NOT NULL COMMENT '轴网字母',
  `grid_number` SMALLINT UNSIGNED NOT NULL COMMENT '轴网数字',
  `zone_band` ENUM('north', 'south_outer', 'south_inner', 'east', 'west', 'inner') NOT NULL COMMENT '区域带',
  `display_name` VARCHAR(64) NOT NULL COMMENT '展示名称',
  `seat_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '座位数',
  `table_group_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '桌组数',
  `image_ref` VARCHAR(255) NULL COMMENT '平面图文件名',
  `polygon_json` JSON NULL COMMENT '区域多边形坐标',
  `bbox_json` JSON NULL COMMENT '区域包围盒',
  `annotation_status` ENUM('pending', 'annotated', 'verified') NOT NULL DEFAULT 'pending' COMMENT '标注状态',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序值',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `notes` VARCHAR(255) NULL COMMENT '备注',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_library_zone_floor_code` (`floor_no`, `zone_code`),
  KEY `idx_library_zone_floor_enabled` (`floor_no`, `is_enabled`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图书馆分区表';

CREATE TABLE IF NOT EXISTS `library_seat` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `zone_id` BIGINT UNSIGNED NOT NULL COMMENT '分区ID',
  `seat_code` VARCHAR(32) NOT NULL COMMENT '座位编号',
  `floor_no` TINYINT UNSIGNED NOT NULL DEFAULT 7 COMMENT '楼层号',
  `table_code` VARCHAR(16) NOT NULL COMMENT '桌组编码',
  `table_group_code` VARCHAR(32) NOT NULL COMMENT '桌组组合编码',
  `seat_seq` SMALLINT UNSIGNED NOT NULL COMMENT '桌组内座位序号',
  `seat_seq_label` VARCHAR(8) NOT NULL COMMENT '格式化座位序号',
  `qr_token` VARCHAR(64) NOT NULL COMMENT '二维码令牌',
  `seat_type` VARCHAR(32) NOT NULL COMMENT '座位类型',
  `seat_capacity` TINYINT UNSIGNED NOT NULL COMMENT '桌位容量',
  `seat_status` ENUM('available', 'disabled', 'maintenance') NOT NULL DEFAULT 'available' COMMENT '静态座位状态',
  `has_power` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否有插座',
  `near_window` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否靠窗',
  `quiet_level` ENUM('安静', '一般') NOT NULL DEFAULT '一般' COMMENT '安静程度',
  `near_restroom` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否靠近卫生间',
  `near_pantry` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否靠近茶水间',
  `near_ac` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否靠近空调出风口',
  `near_bookshelf` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否靠近书架区',
  `near_corridor` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否靠近电梯或通道',
  `sunlight` ENUM('有', '无') NOT NULL DEFAULT '无' COMMENT '日照情况',
  `raw_tags_text` VARCHAR(255) NULL COMMENT '原始标签文本',
  `raw_tags_json` JSON NULL COMMENT '原始标签数组',
  `tag_keys_json` JSON NULL COMMENT '标准标签键数组',
  `specific_location` VARCHAR(255) NULL COMMENT '具体位置描述',
  `coord_x` DECIMAL(10, 2) NULL COMMENT 'X坐标预留',
  `coord_y` DECIMAL(10, 2) NULL COMMENT 'Y坐标预留',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序值',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_library_seat_code` (`seat_code`),
  UNIQUE KEY `uk_library_seat_qr_token` (`qr_token`),
  KEY `idx_library_seat_zone_status` (`zone_id`, `seat_status`),
  KEY `idx_library_seat_table_group` (`table_group_code`),
  KEY `idx_library_seat_filter` (`seat_status`, `has_power`, `near_window`, `quiet_level`, `seat_type`),
  CONSTRAINT `fk_library_seat_zone` FOREIGN KEY (`zone_id`) REFERENCES `library_zone` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图书馆座位表';

CREATE TABLE IF NOT EXISTS `seat_reservation` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `reservation_no` VARCHAR(32) NOT NULL COMMENT '预约编号',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `seat_id` BIGINT UNSIGNED NOT NULL COMMENT '座位ID',
  `zone_id` BIGINT UNSIGNED NOT NULL COMMENT '分区ID',
  `floor_no` TINYINT UNSIGNED NOT NULL DEFAULT 7 COMMENT '楼层号',
  `reservation_date` DATE NOT NULL COMMENT '预约日期',
  `start_time` TIME NOT NULL COMMENT '开始时间',
  `end_time` TIME NOT NULL COMMENT '结束时间',
  `duration_minutes` SMALLINT UNSIGNED NOT NULL COMMENT '预约时长（分钟）',
  `source` ENUM('mini_program', 'admin') NOT NULL DEFAULT 'mini_program' COMMENT '预约来源',
  `status` ENUM('reserved', 'checked_in', 'temporary_leave', 'completed', 'cancelled', 'no_show', 'violation', 'admin_released') NOT NULL DEFAULT 'reserved' COMMENT '预约状态',
  `checkin_open_at` DATETIME NOT NULL COMMENT '签到开放时间',
  `checkin_deadline_at` DATETIME NOT NULL COMMENT '签到截止时间',
  `checked_in_at` DATETIME NULL COMMENT '实际签到时间',
  `checkout_at` DATETIME NULL COMMENT '实际签退时间',
  `cancelled_at` DATETIME NULL COMMENT '取消时间',
  `cancel_reason` VARCHAR(255) NULL COMMENT '取消原因',
  `violation_type` ENUM('none', 'no_show', 'leave_timeout', 'manual_penalty') NOT NULL DEFAULT 'none' COMMENT '违约类型',
  `violation_at` DATETIME NULL COMMENT '违约时间',
  `rule_snapshot_json` JSON NULL COMMENT '预约时的规则快照',
  `remarks` VARCHAR(255) NULL COMMENT '备注',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_seat_reservation_no` (`reservation_no`),
  KEY `idx_seat_reservation_user_date` (`user_id`, `reservation_date`, `status`),
  KEY `idx_seat_reservation_seat_date` (`seat_id`, `reservation_date`, `start_time`),
  KEY `idx_seat_reservation_status_date` (`status`, `reservation_date`),
  CONSTRAINT `fk_seat_reservation_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`),
  CONSTRAINT `fk_seat_reservation_seat` FOREIGN KEY (`seat_id`) REFERENCES `library_seat` (`id`),
  CONSTRAINT `fk_seat_reservation_zone` FOREIGN KEY (`zone_id`) REFERENCES `library_zone` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预约主表';

CREATE TABLE IF NOT EXISTS `seat_reservation_slot` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `reservation_id` BIGINT UNSIGNED NOT NULL COMMENT '预约ID',
  `seat_id` BIGINT UNSIGNED NOT NULL COMMENT '座位ID',
  `reservation_date` DATE NOT NULL COMMENT '预约日期',
  `slot_start` TIME NOT NULL COMMENT '时隙开始时间',
  `slot_end` TIME NOT NULL COMMENT '时隙结束时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_seat_reservation_slot_unique` (`seat_id`, `reservation_date`, `slot_start`),
  KEY `idx_seat_reservation_slot_reservation` (`reservation_id`),
  CONSTRAINT `fk_reservation_slot_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `seat_reservation` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reservation_slot_seat` FOREIGN KEY (`seat_id`) REFERENCES `library_seat` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预约时隙占用表';

CREATE TABLE IF NOT EXISTS `reservation_checkin_record` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `reservation_id` BIGINT UNSIGNED NOT NULL COMMENT '预约ID',
  `checkin_type` ENUM('qr_code', 'admin') NULL COMMENT '签到方式',
  `first_checkin_at` DATETIME NULL COMMENT '首次签到时间',
  `checkout_type` ENUM('qr_code', 'admin', 'auto', 'direct') NULL COMMENT '签退方式',
  `checkout_at` DATETIME NULL COMMENT '签退时间',
  `leave_count` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '暂离次数',
  `total_leave_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计暂离分钟数',
  `last_leave_started_at` DATETIME NULL COMMENT '最近一次暂离开始时间',
  `last_returned_at` DATETIME NULL COMMENT '最近一次返回时间',
  `actual_usage_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '实际使用时长',
  `final_result` ENUM('reserved', 'completed', 'cancelled', 'no_show', 'leave_timeout', 'admin_released') NOT NULL DEFAULT 'reserved' COMMENT '最终结果',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_checkin_record_reservation` (`reservation_id`),
  CONSTRAINT `fk_checkin_record_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `seat_reservation` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='签到签退主记录表';

CREATE TABLE IF NOT EXISTS `reservation_leave_record` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `reservation_id` BIGINT UNSIGNED NOT NULL COMMENT '预约ID',
  `leave_seq` TINYINT UNSIGNED NOT NULL COMMENT '暂离序号',
  `leave_started_at` DATETIME NOT NULL COMMENT '暂离开始时间',
  `leave_deadline_at` DATETIME NOT NULL COMMENT '暂离截止时间',
  `returned_at` DATETIME NULL COMMENT '返回时间',
  `leave_minutes` SMALLINT UNSIGNED NULL COMMENT '本次暂离分钟数',
  `is_timeout` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否超时',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reservation_leave_seq` (`reservation_id`, `leave_seq`),
  KEY `idx_reservation_leave_returned` (`reservation_id`, `returned_at`),
  CONSTRAINT `fk_leave_record_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `seat_reservation` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='暂离记录表';

CREATE TABLE IF NOT EXISTS `user_credit_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `reservation_id` BIGINT UNSIGNED NULL COMMENT '关联预约ID',
  `operator_user_id` BIGINT UNSIGNED NULL COMMENT '操作人ID',
  `change_type` ENUM('reward', 'penalty', 'manual_adjust', 'restore') NOT NULL COMMENT '变更类型',
  `change_reason` VARCHAR(128) NOT NULL COMMENT '变更原因',
  `score_delta` SMALLINT NOT NULL COMMENT '分值变化',
  `score_before` SMALLINT UNSIGNED NOT NULL COMMENT '变更前分数',
  `score_after` SMALLINT UNSIGNED NOT NULL COMMENT '变更后分数',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_credit_log_user_created` (`user_id`, `created_at`),
  KEY `idx_user_credit_log_reservation` (`reservation_id`),
  CONSTRAINT `fk_user_credit_log_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`),
  CONSTRAINT `fk_user_credit_log_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `seat_reservation` (`id`),
  CONSTRAINT `fk_user_credit_log_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户信用分变更日志表';

CREATE TABLE IF NOT EXISTS `system_notice` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `title` VARCHAR(128) NOT NULL COMMENT '标题',
  `content` TEXT NOT NULL COMMENT '内容',
  `notice_type` ENUM('system', 'maintenance', 'activity', 'rule') NOT NULL DEFAULT 'system' COMMENT '公告类型',
  `audience` ENUM('all', 'reader', 'admin') NOT NULL DEFAULT 'all' COMMENT '受众范围',
  `status` ENUM('draft', 'published', 'offline') NOT NULL DEFAULT 'draft' COMMENT '公告状态',
  `publish_at` DATETIME NULL COMMENT '发布时间',
  `expire_at` DATETIME NULL COMMENT '过期时间',
  `created_by` BIGINT UNSIGNED NOT NULL COMMENT '创建人',
  `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_system_notice_status_time` (`status`, `publish_at`, `expire_at`),
  CONSTRAINT `fk_system_notice_created_by` FOREIGN KEY (`created_by`) REFERENCES `app_user` (`id`),
  CONSTRAINT `fk_system_notice_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统公告表';

CREATE TABLE IF NOT EXISTS `admin_operation_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `operator_user_id` BIGINT UNSIGNED NOT NULL COMMENT '操作人ID',
  `action_module` VARCHAR(32) NOT NULL COMMENT '模块',
  `action_type` VARCHAR(32) NOT NULL COMMENT '动作类型',
  `target_type` VARCHAR(32) NULL COMMENT '目标对象类型',
  `target_id` VARCHAR(64) NULL COMMENT '目标对象ID',
  `request_ip` VARCHAR(64) NULL COMMENT '请求IP',
  `action_detail_json` JSON NULL COMMENT '详情JSON',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_admin_operation_log_operator_created` (`operator_user_id`, `created_at`),
  KEY `idx_admin_operation_log_module_created` (`action_module`, `created_at`),
  CONSTRAINT `fk_admin_operation_log_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员操作日志表';

CREATE TABLE IF NOT EXISTS `seat_status_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `seat_id` BIGINT UNSIGNED NOT NULL COMMENT '座位ID',
  `operator_user_id` BIGINT UNSIGNED NOT NULL COMMENT '操作人ID',
  `from_status` ENUM('available', 'disabled', 'maintenance') NULL COMMENT '变更前状态',
  `to_status` ENUM('available', 'disabled', 'maintenance') NOT NULL COMMENT '变更后状态',
  `change_reason` VARCHAR(255) NOT NULL COMMENT '变更原因',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_seat_status_log_seat_created` (`seat_id`, `created_at`),
  CONSTRAINT `fk_seat_status_log_seat` FOREIGN KEY (`seat_id`) REFERENCES `library_seat` (`id`),
  CONSTRAINT `fk_seat_status_log_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='座位静态状态变更日志表';

CREATE TABLE IF NOT EXISTS `system_config` (
  `config_key` VARCHAR(64) NOT NULL COMMENT '配置键',
  `config_group` VARCHAR(32) NOT NULL DEFAULT 'system' COMMENT '配置分组',
  `config_value` TEXT NOT NULL COMMENT '配置值',
  `value_type` ENUM('string', 'number', 'boolean', 'json', 'time') NOT NULL DEFAULT 'string' COMMENT '值类型',
  `description` VARCHAR(255) NULL COMMENT '配置说明',
  `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`config_key`),
  KEY `idx_system_config_group` (`config_group`),
  CONSTRAINT `fk_system_config_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';
