SET NAMES utf8mb4;

USE `library_seat_reservation`;

START TRANSACTION;

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
  ('2024200101', '陈雨桐', '13810002001', NULL, 'reader', 'active', 96, 0, 0, NULL, '考研自习演示账号'),
  ('2024200102', '李明轩', '13810002002', NULL, 'reader', 'active', 88, 1, 0, NULL, '设备学习演示账号'),
  ('2024200103', '周思远', '13810002003', NULL, 'reader', 'active', 76, 2, 0, NULL, '小组讨论演示账号'),
  ('2024200104', '王佳宁', '13810002004', NULL, 'reader', 'active', 58, 4, 1, DATE_ADD(NOW(), INTERVAL 5 DAY), '信用预警演示账号'),
  ('2024200105', '赵清越', '13810002005', NULL, 'reader', 'active', 100, 0, 0, NULL, '临窗阅读演示账号')
ON DUPLICATE KEY UPDATE
  `real_name` = VALUES(`real_name`),
  `mobile` = VALUES(`mobile`),
  `role` = VALUES(`role`),
  `status` = VALUES(`status`),
  `credit_score` = VALUES(`credit_score`),
  `violation_count` = VALUES(`violation_count`),
  `is_blacklisted` = VALUES(`is_blacklisted`),
  `blacklist_until` = VALUES(`blacklist_until`),
  `remark` = VALUES(`remark`);

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
) VALUES
  (
    '七层座位预约演示数据已更新',
    '当前系统已接入 SVM 实时推荐、座位占用时间轴和后台管理数据，答辩演示可优先使用 2024200101、2024200102 等读者账号。',
    'system',
    'all',
    'published',
    NOW(),
    DATE_ADD(NOW(), INTERVAL 30 DAY),
    (SELECT `id` FROM `app_user` WHERE `student_no` = 'LIB001'),
    (SELECT `id` FROM `app_user` WHERE `student_no` = 'LIB001')
  ),
  (
    '晚间自习高峰提醒',
    '18:00-21:00 为晚间预约高峰，建议读者提前通过 AI 推荐选择安静、靠窗或可充电座位。',
    'rule',
    'reader',
    'published',
    NOW(),
    DATE_ADD(NOW(), INTERVAL 30 DAY),
    (SELECT `id` FROM `app_user` WHERE `student_no` = 'LIB001'),
    (SELECT `id` FROM `app_user` WHERE `student_no` = 'LIB001')
  );

DELETE l
FROM `user_credit_log` l
INNER JOIN `seat_reservation` r ON r.id = l.reservation_id
WHERE r.reservation_no IN (
  'DEMO-TOM-D3A02-0930',
  'DEMO-TOM-D3A02-1400',
  'DEMO-TOM-Q3A01-1800',
  'DEMO-TOD-L15B02-1000',
  'DEMO-YDAY-P15A01-0900',
  'DEMO-YDAY-C10A01-1430'
);

DELETE FROM `seat_reservation`
WHERE `reservation_no` IN (
  'DEMO-TOM-D3A02-0930',
  'DEMO-TOM-D3A02-1400',
  'DEMO-TOM-Q3A01-1800',
  'DEMO-TOD-L15B02-1000',
  'DEMO-YDAY-P15A01-0900',
  'DEMO-YDAY-C10A01-1430'
);

DELETE u
FROM `app_user` u
LEFT JOIN `seat_reservation` r ON r.user_id = u.id
WHERE u.student_no IN ('20242001', '20242002', '20242003', '20242004', '20242005')
  AND r.id IS NULL;

INSERT INTO `seat_reservation` (
  `reservation_no`,
  `user_id`,
  `seat_id`,
  `zone_id`,
  `floor_no`,
  `reservation_date`,
  `start_time`,
  `end_time`,
  `duration_minutes`,
  `source`,
  `status`,
  `checkin_open_at`,
  `checkin_deadline_at`,
  `checked_in_at`,
  `checkout_at`,
  `cancelled_at`,
  `cancel_reason`,
  `violation_type`,
  `violation_at`,
  `rule_snapshot_json`,
  `remarks`
)
SELECT
  demo.reservation_no,
  u.id,
  s.id,
  s.zone_id,
  s.floor_no,
  demo.reservation_date,
  demo.start_time,
  demo.end_time,
  demo.duration_minutes,
  demo.source,
  demo.status,
  TIMESTAMP(demo.reservation_date, demo.checkin_open_time),
  TIMESTAMP(demo.reservation_date, demo.checkin_deadline_time),
  CASE
    WHEN demo.checked_in_time IS NULL THEN NULL
    ELSE TIMESTAMP(demo.reservation_date, demo.checked_in_time)
  END,
  CASE
    WHEN demo.checkout_time IS NULL THEN NULL
    ELSE TIMESTAMP(demo.reservation_date, demo.checkout_time)
  END,
  NULL,
  NULL,
  demo.violation_type,
  CASE
    WHEN demo.violation_time IS NULL THEN NULL
    ELSE TIMESTAMP(demo.reservation_date, demo.violation_time)
  END,
  JSON_OBJECT('openTime', '06:30', 'closeTime', '22:30', 'slotMinutes', 30),
  demo.remarks
FROM (
  SELECT
    'DEMO-TOM-D3A02-0930' AS reservation_no,
    '2024200101' AS student_no,
    'D3-A-02' AS seat_code,
    DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS reservation_date,
    '09:30:00' AS start_time,
    '10:30:00' AS end_time,
    60 AS duration_minutes,
    'mini_program' AS source,
    'reserved' AS status,
    '09:20:00' AS checkin_open_time,
    '09:45:00' AS checkin_deadline_time,
    NULL AS checked_in_time,
    NULL AS checkout_time,
    'none' AS violation_type,
    NULL AS violation_time,
    '演示：D3-A-02 明日上午已被预约，用于展示时间轴占用。' AS remarks
  UNION ALL
  SELECT 'DEMO-TOM-D3A02-1400', '2024200102', 'D3-A-02', DATE_ADD(CURDATE(), INTERVAL 1 DAY), '14:00:00', '15:30:00', 90, 'mini_program', 'reserved', '13:50:00', '14:15:00', NULL, NULL, 'none', NULL, '演示：D3-A-02 明日下午占用。'
  UNION ALL
  SELECT 'DEMO-TOM-Q3A01-1800', '2024200103', 'Q3-A-01', DATE_ADD(CURDATE(), INTERVAL 1 DAY), '18:00:00', '20:00:00', 120, 'mini_program', 'reserved', '17:50:00', '18:15:00', NULL, NULL, 'none', NULL, '演示：晚间小组学习预约。'
  UNION ALL
  SELECT 'DEMO-TOD-L15B02-1000', '2024200105', 'L15-B-02', CURDATE(), '10:00:00', '12:00:00', 120, 'mini_program', 'checked_in', '09:50:00', '10:15:00', '10:02:00', NULL, 'none', NULL, '演示：今日正在使用。'
  UNION ALL
  SELECT 'DEMO-YDAY-P15A01-0900', '2024200101', 'P15-A-01', DATE_SUB(CURDATE(), INTERVAL 1 DAY), '09:00:00', '11:00:00', 120, 'mini_program', 'completed', '08:50:00', '09:15:00', '08:58:00', '10:55:00', 'none', NULL, '演示：已完成预约。'
  UNION ALL
  SELECT 'DEMO-YDAY-C10A01-1430', '2024200104', 'C10-A-01', DATE_SUB(CURDATE(), INTERVAL 1 DAY), '14:30:00', '16:00:00', 90, 'mini_program', 'no_show', '14:20:00', '14:45:00', NULL, NULL, 'no_show', '14:46:00', '演示：未签到违约。'
) demo
INNER JOIN `app_user` u ON u.student_no = demo.student_no
INNER JOIN `library_seat` s ON s.seat_code = demo.seat_code;

INSERT INTO `reservation_checkin_record` (
  `reservation_id`,
  `checkin_type`,
  `first_checkin_at`,
  `checkout_type`,
  `checkout_at`,
  `leave_count`,
  `total_leave_minutes`,
  `last_leave_started_at`,
  `last_returned_at`,
  `actual_usage_minutes`,
  `final_result`
)
SELECT
  r.id,
  CASE WHEN r.checked_in_at IS NULL THEN NULL ELSE 'qr_code' END,
  r.checked_in_at,
  CASE WHEN r.checkout_at IS NULL THEN NULL ELSE 'direct' END,
  r.checkout_at,
  0,
  0,
  NULL,
  NULL,
  CASE WHEN r.checkout_at IS NULL OR r.checked_in_at IS NULL THEN 0 ELSE TIMESTAMPDIFF(MINUTE, r.checked_in_at, r.checkout_at) END,
  CASE
    WHEN r.status = 'completed' THEN 'completed'
    WHEN r.status = 'no_show' THEN 'no_show'
    ELSE 'reserved'
  END
FROM `seat_reservation` r
WHERE r.reservation_no IN (
  'DEMO-TOD-L15B02-1000',
  'DEMO-YDAY-P15A01-0900',
  'DEMO-YDAY-C10A01-1430'
)
ON DUPLICATE KEY UPDATE
  `checkin_type` = VALUES(`checkin_type`),
  `first_checkin_at` = VALUES(`first_checkin_at`),
  `checkout_type` = VALUES(`checkout_type`),
  `checkout_at` = VALUES(`checkout_at`),
  `actual_usage_minutes` = VALUES(`actual_usage_minutes`),
  `final_result` = VALUES(`final_result`);

INSERT INTO `user_credit_log` (
  `user_id`,
  `reservation_id`,
  `operator_user_id`,
  `change_type`,
  `change_reason`,
  `score_delta`,
  `score_before`,
  `score_after`
)
SELECT
  u.id,
  r.id,
  admin_user.id,
  'penalty',
  '演示数据：未签到扣分',
  -10,
  68,
  58
FROM `app_user` u
INNER JOIN `app_user` admin_user ON admin_user.student_no = 'LIB001'
INNER JOIN `seat_reservation` r ON r.reservation_no = 'DEMO-YDAY-C10A01-1430'
WHERE u.student_no = '2024200104';

COMMIT;

