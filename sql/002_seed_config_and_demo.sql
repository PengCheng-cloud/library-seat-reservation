SET NAMES utf8mb4;

USE `library_seat_reservation`;

DELETE FROM `system_config`
WHERE `config_key` = 'reservation_slot_minutes';

INSERT INTO `app_user` (
  `student_no`,
  `real_name`,
  `mobile`,
  `avatar_url`,
  `role`,
  `status`,
  `credit_score`,
  `violation_count`,
  `is_blacklisted`,
  `blacklist_until`,
  `remark`
) VALUES
  ('ADMIN001', '系统管理员', '13800000001', NULL, 'super_admin', 'active', 100, 0, 0, NULL, '一期默认超级管理员'),
  ('LIB001', '图书馆管理员', '13800000002', NULL, 'admin', 'active', 100, 0, 0, NULL, '一期默认图书馆管理员'),
  ('2026000101', '测试读者甲', '13800000011', NULL, 'reader', 'active', 100, 0, 0, NULL, '演示用普通读者'),
  ('2026000102', '测试读者乙', '13800000012', NULL, 'reader', 'active', 100, 0, 0, NULL, '演示用普通读者')
ON DUPLICATE KEY UPDATE
  `real_name` = VALUES(`real_name`),
  `mobile` = VALUES(`mobile`),
  `role` = VALUES(`role`),
  `status` = VALUES(`status`),
  `remark` = VALUES(`remark`);

INSERT INTO `system_config` (`config_key`, `config_group`, `config_value`, `value_type`, `description`, `updated_by`) VALUES
  ('library_open_time', 'reservation', '06:30', 'time', '图书馆开放时间', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('library_close_time', 'reservation', '22:30', 'time', '图书馆闭馆时间', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('reservation_advance_days', 'reservation', '3', 'number', '允许提前预约天数', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('max_active_reservations', 'reservation', '1', 'number', '单用户同时有效预约上限', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('max_daily_reservations', 'reservation', '2', 'number', '单用户单日可创建预约次数上限', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('min_reservation_minutes', 'reservation', '30', 'number', '单次最短预约时长', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('max_reservation_minutes', 'reservation', '240', 'number', '单次最长预约时长', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('allow_cross_day_reservation', 'reservation', 'false', 'boolean', '是否允许跨天预约', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('cancel_before_minutes', 'reservation', '15', 'number', '用户自助取消截止时间（距离开始前）', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('checkin_allow_before_minutes', 'checkin', '10', 'number', '允许提前签到分钟数', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('checkin_allow_after_minutes', 'checkin', '15', 'number', '允许延后签到分钟数', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('checkin_location_latitude', 'checkin', '25.793041', 'number', '定位签到中心点纬度，当前默认指向江西理工大学三江校区东园图书馆，0 表示暂不启用严格范围校验', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('checkin_location_longitude', 'checkin', '114.763803', 'number', '定位签到中心点经度，当前默认指向江西理工大学三江校区东园图书馆，0 表示暂不启用严格范围校验', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('checkin_location_radius_meters', 'checkin', '100', 'number', '定位签到允许半径（米），当前默认覆盖江西理工大学三江校区东园图书馆周边签到范围', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('max_leave_times', 'checkin', '2', 'number', '单次预约最多暂离次数', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('max_leave_minutes_each', 'checkin', '60', 'number', '单次暂离最长分钟数', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('max_leave_minutes_total', 'checkin', '60', 'number', '单次预约累计暂离总分钟数', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('initial_credit_score', 'credit', '100', 'number', '用户初始信用分', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('credit_min_score', 'credit', '0', 'number', '信用分最小值', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('credit_max_score', 'credit', '100', 'number', '信用分最大值', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('blacklist_credit_threshold', 'credit', '60', 'number', '进入黑名单的信用分阈值', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('blacklist_days', 'credit', '7', 'number', '黑名单默认限制天数', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('penalty_no_show', 'credit', '10', 'number', '未签到扣分', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('penalty_leave_timeout', 'credit', '15', 'number', '暂离超时扣分', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001')),
  ('penalty_manual_severe', 'credit', '20', 'number', '严重违规人工处罚扣分', (SELECT `id` FROM `app_user` WHERE `student_no` = 'ADMIN001'))
ON DUPLICATE KEY UPDATE
  `config_group` = VALUES(`config_group`),
  `config_value` = VALUES(`config_value`),
  `value_type` = VALUES(`value_type`),
  `description` = VALUES(`description`),
  `updated_by` = VALUES(`updated_by`);

INSERT INTO `system_notice` (
  `title`,
  `content`,
  `notice_type`,
  `audience`,
  `status`,
  `publish_at`,
  `expire_at`,
  `created_by`,
  `updated_by`
) VALUES (
  '系统试运行说明',
  '本系统当前为一期默认规则版本。预约、签到、暂离和信用分机制已按常规高校图书馆场景配置，如后续学校有明确制度，将统一调整。',
  'rule',
  'all',
  'published',
  NOW(),
  NULL,
  (SELECT `id` FROM `app_user` WHERE `student_no` = 'LIB001'),
  (SELECT `id` FROM `app_user` WHERE `student_no` = 'LIB001')
);
