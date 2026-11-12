-- Run this against your RDS/MySQL database BEFORE deploying the updated
-- lambda/index.mjs (the /puspakom endpoints assume these tables exist).
--
-- PUSPAKOM inspections (v2.0.0 designs, part F):
--   PUSPAKOM_INSPECTION   one booking. A Failed result books a REINSPECTION
--                         that points back to it (parent) and to the first
--                         booking of the chain (root). The chain closes when
--                         an inspection in it is Passed; the report and its
--                         SKSC-PKR reference number belong to the root.
--   PUSPAKOM_PRECHECK     the technician's work for one inspection:
--                         kind PRE (44-check walk-around) or RECHECK (only the
--                         items PUSPAKOM failed, on the re-inspection).
--   PUSPAKOM_ANSWER       one row per check answered in a PRE pre-check.
--   PUSPAKOM_FAILED_ITEM  a check PUSPAKOM failed, what they found, and the
--                         technician's fix (filled in during the RECHECK).
--   PUSPAKOM_MEDIA        result slip photos.
--   PUSPAKOM_EVENT        the chronology shown on every screen and the PDF.
--   PUSPAKOM_STOP_DEF /   the walk-around configuration (stops, the 44 checks,
--   PUSPAKOM_CHECK_DEF    "OK if" text, helper notes). Rows with bus_model '*'
--                         apply to every model; add model-specific rows later.
--
-- Status is never stored: it is worked out from these rows each time, so it
-- can't drift from the data (see puspakomBusStatus in index.mjs).
--
-- Every bus_id column is built from BUS.bus_id's real type/charset/collation
-- (the lesson of 006_fix_bus_fk.sql), so the foreign key always matches.

SET @bus_col_type  := (SELECT COLUMN_TYPE       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BUS' AND COLUMN_NAME = 'bus_id');
SET @bus_charset   := (SELECT CHARACTER_SET_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BUS' AND COLUMN_NAME = 'bus_id');
SET @bus_collation := (SELECT COLLATION_NAME     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BUS' AND COLUMN_NAME = 'bus_id');

-- 1. Inspections ------------------------------------------------------------
SET @sql := CONCAT(
  'CREATE TABLE IF NOT EXISTS PUSPAKOM_INSPECTION (
    inspection_id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bus_id                ', @bus_col_type, ' CHARACTER SET ', @bus_charset, ' COLLATE ', @bus_collation, ' NOT NULL,
    inspection_type       ENUM(''PERIODIC'',''REINSPECTION'',''SPECIAL'') NOT NULL,
    parent_inspection_id  BIGINT UNSIGNED NULL,
    root_inspection_id    BIGINT UNSIGNED NULL,
    scheduled_at          DATETIME NOT NULL,
    booking_ref           VARCHAR(64) NULL,
    notes                 VARCHAR(500) NULL,
    registered_by         BIGINT UNSIGNED NOT NULL,
    registered_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    registered_verified_name   VARCHAR(150) NULL,
    registered_selfie_s3_bucket VARCHAR(255) NULL,
    registered_selfie_s3_key    VARCHAR(512) NULL,
    result                ENUM(''PASSED'',''FAILED'') NULL,
    result_date           DATE NULL,
    result_by             BIGINT UNSIGNED NULL,
    result_at             DATETIME NULL,
    result_verified_name   VARCHAR(150) NULL,
    result_selfie_s3_bucket VARCHAR(255) NULL,
    result_selfie_s3_key    VARCHAR(512) NULL,
    ref_no                VARCHAR(32) NULL,
    report_pdf_s3_key     VARCHAR(512) NULL,
    report_issued_at      DATETIME NULL,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_puspakom_ref_no (ref_no),
    KEY idx_puspakom_bus_sched (bus_id, scheduled_at),
    KEY idx_puspakom_root (root_inspection_id),
    KEY idx_puspakom_open (result, scheduled_at),
    CONSTRAINT fk_puspakom_bus FOREIGN KEY (bus_id) REFERENCES BUS(bus_id),
    CONSTRAINT fk_puspakom_parent FOREIGN KEY (parent_inspection_id) REFERENCES PUSPAKOM_INSPECTION(inspection_id),
    CONSTRAINT fk_puspakom_registered_by FOREIGN KEY (registered_by) REFERENCES `USER`(user_id),
    CONSTRAINT fk_puspakom_result_by FOREIGN KEY (result_by) REFERENCES `USER`(user_id)
  )'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Technician pre-check / re-check -----------------------------------------
CREATE TABLE IF NOT EXISTS PUSPAKOM_PRECHECK (
  precheck_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inspection_id     BIGINT UNSIGNED NOT NULL,
  kind              ENUM('PRE','RECHECK') NOT NULL,
  started_by        BIGINT UNSIGNED NULL,
  started_at        DATETIME NULL,
  submitted_by      BIGINT UNSIGNED NULL,
  submitted_at      DATETIME NULL,
  remarks           VARCHAR(500) NULL,
  declared          TINYINT(1) NOT NULL DEFAULT 0,
  verified_name     VARCHAR(150) NULL,
  selfie_s3_bucket  VARCHAR(255) NULL,
  selfie_s3_key     VARCHAR(512) NULL,
  UNIQUE KEY uq_puspakom_precheck (inspection_id, kind),
  CONSTRAINT fk_puspakom_precheck_insp FOREIGN KEY (inspection_id) REFERENCES PUSPAKOM_INSPECTION(inspection_id) ON DELETE CASCADE,
  CONSTRAINT fk_puspakom_precheck_started FOREIGN KEY (started_by) REFERENCES `USER`(user_id),
  CONSTRAINT fk_puspakom_precheck_submitted FOREIGN KEY (submitted_by) REFERENCES `USER`(user_id)
);

-- One row per check. Answers arrive from phones that may have been offline,
-- so client_ts (ms since epoch, set on the phone when the answer changed)
-- decides which write wins: an older write never overwrites a newer one.
CREATE TABLE IF NOT EXISTS PUSPAKOM_ANSWER (
  answer_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  precheck_id     BIGINT UNSIGNED NOT NULL,
  check_id        VARCHAR(8) NOT NULL,
  answer          ENUM('OK','NG','NO_DAMAGE','DAMAGE') NULL,
  ng_reason       ENUM('NOT_WORKING','FLICKERING','CRACKED','LOOSE','OTHER') NULL,
  note            VARCHAR(200) NULL,
  tread_mm        DECIMAL(4,1) NULL,
  pressure_psi    SMALLINT UNSIGNED NULL,
  pad_mm          DECIMAL(4,1) NULL,
  tag             ENUM('OK','NG','REPLACE','LOW','CHECK_SOON','DAMAGE') NULL,
  photo_s3_key    VARCHAR(512) NULL,
  damages         JSON NULL,
  entered_by      BIGINT UNSIGNED NOT NULL,
  entered_at      DATETIME NOT NULL,
  client_ts       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_puspakom_answer (precheck_id, check_id),
  CONSTRAINT fk_puspakom_answer_precheck FOREIGN KEY (precheck_id) REFERENCES PUSPAKOM_PRECHECK(precheck_id) ON DELETE CASCADE,
  CONSTRAINT fk_puspakom_answer_user FOREIGN KEY (entered_by) REFERENCES `USER`(user_id)
);

-- 3. Failed items (what PUSPAKOM found) and their fix ------------------------
CREATE TABLE IF NOT EXISTS PUSPAKOM_FAILED_ITEM (
  failed_item_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inspection_id   BIGINT UNSIGNED NOT NULL,
  check_id        VARCHAR(8) NOT NULL,
  puspakom_found  VARCHAR(300) NOT NULL,
  fixed_text      VARCHAR(300) NULL,
  fix_photo_keys  JSON NULL,
  fixed_by        BIGINT UNSIGNED NULL,
  fixed_at        DATETIME NULL,
  client_ts       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_puspakom_failed (inspection_id, check_id),
  CONSTRAINT fk_puspakom_failed_insp FOREIGN KEY (inspection_id) REFERENCES PUSPAKOM_INSPECTION(inspection_id) ON DELETE CASCADE,
  CONSTRAINT fk_puspakom_failed_user FOREIGN KEY (fixed_by) REFERENCES `USER`(user_id)
);

-- 4. Result slip photos ------------------------------------------------------
CREATE TABLE IF NOT EXISTS PUSPAKOM_MEDIA (
  media_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inspection_id   BIGINT UNSIGNED NOT NULL,
  media_kind      ENUM('SLIP') NOT NULL DEFAULT 'SLIP',
  s3_bucket       VARCHAR(255) NOT NULL,
  s3_key          VARCHAR(512) NOT NULL,
  uploaded_by     BIGINT UNSIGNED NOT NULL,
  uploaded_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_puspakom_media_insp (inspection_id),
  CONSTRAINT fk_puspakom_media_insp FOREIGN KEY (inspection_id) REFERENCES PUSPAKOM_INSPECTION(inspection_id) ON DELETE CASCADE,
  CONSTRAINT fk_puspakom_media_user FOREIGN KEY (uploaded_by) REFERENCES `USER`(user_id)
);

-- 5. Chronology --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS PUSPAKOM_EVENT (
  event_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inspection_id   BIGINT UNSIGNED NOT NULL,
  root_inspection_id BIGINT UNSIGNED NOT NULL,
  event_type      VARCHAR(40) NOT NULL,
  actor_user_id   BIGINT UNSIGNED NULL,
  event_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detail          JSON NULL,
  KEY idx_puspakom_event_root (root_inspection_id, event_at),
  CONSTRAINT fk_puspakom_event_insp FOREIGN KEY (inspection_id) REFERENCES PUSPAKOM_INSPECTION(inspection_id) ON DELETE CASCADE,
  CONSTRAINT fk_puspakom_event_user FOREIGN KEY (actor_user_id) REFERENCES `USER`(user_id)
);

-- 6. Walk-around configuration ------------------------------------------------
CREATE TABLE IF NOT EXISTS PUSPAKOM_STOP_DEF (
  bus_model    VARCHAR(64) NOT NULL DEFAULT '*',
  stop_no      TINYINT UNSIGNED NOT NULL,
  stop_name    VARCHAR(60) NOT NULL,
  stop_where   VARCHAR(120) NOT NULL,
  helper_top   VARCHAR(255) NULL,
  helper_end   VARCHAR(255) NULL,
  has_drawing  TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (bus_model, stop_no)
);

CREATE TABLE IF NOT EXISTS PUSPAKOM_CHECK_DEF (
  bus_model      VARCHAR(64) NOT NULL DEFAULT '*',
  check_id       VARCHAR(8) NOT NULL,
  stop_no        TINYINT UNSIGNED NOT NULL,
  sort_no        TINYINT UNSIGNED NOT NULL,
  answer_type    ENUM('OK_NG','TYRE','BRAKE','BODY') NOT NULL,
  label          VARCHAR(80) NOT NULL,
  ok_if          VARCHAR(255) NOT NULL,
  photo_hint     VARCHAR(120) NOT NULL,
  puspakom_item  VARCHAR(120) NOT NULL,
  pin_x_pct      DECIMAL(5,2) NULL,
  pin_y_pct      DECIMAL(5,2) NULL,
  PRIMARY KEY (bus_model, check_id)
);

INSERT IGNORE INTO PUSPAKOM_STOP_DEF (bus_model, stop_no, stop_name, stop_where, helper_top, helper_end, has_drawing) VALUES
('*', 1, 'Driver''s cab', 'Inside, driver''s seat', NULL, 'Before you step out: helper switches on the low beam, hazard lights and marker lights, then stays in the driver''s seat.', 1),
('*', 2, 'Saloon', 'Inside, passenger area', NULL, NULL, 1),
('*', 3, 'Front', 'Outside, in front of the bus', 'Helper: low beam, then high beam; hazard lights stay on.', NULL, 1),
('*', 4, 'Left side', 'Doors side, walk front to rear', NULL, NULL, 1),
('*', 5, 'Rear', 'Outside, behind the bus', 'Helper: press the brake pedal, then select reverse (parking brake on).', NULL, 1),
('*', 6, 'Right side', 'Walk rear to front', NULL, 'Done with the lights: helper switches everything off and sets the parking brake.', 1),
('*', 7, 'Underneath', 'Over the pit', 'Helper: drive the bus over the pit, parking brake on, then switch off.', NULL, 0);

INSERT IGNORE INTO PUSPAKOM_CHECK_DEF (bus_model, check_id, stop_no, sort_no, answer_type, label, ok_if, photo_hint, puspakom_item) VALUES
('*','C01',1, 1,'OK_NG','Speedometer','Needle sits at 0 when stopped, moves when the bus moves, dial lights up, glass not cracked','Speedometer dial','Speedometer accuracy'),
('*','C02',1, 2,'OK_NG','Parking brake','Holds the bus still when applied, releases fully, red warning light on the dash comes on','Brake applied, warning light on','Brake performance'),
('*','C03',1, 3,'OK_NG','Driver''s seat','Firm on its rails (no rocking), slides and locks in place, seat belt clicks in and pulls back','Seat and rails','Visual: driver / passenger seat'),
('*','C04',1, 4,'OK_NG','First aid kit','In its place in the cab, box closes, items inside complete and not expired','Kit, opened','Self-declaration'),
('*','C05',1, 5,'OK_NG','Fire extinguisher','Clipped in its bracket, gauge needle in the green, pin and seal in place, service date not expired','Gauge and expiry label','Safety equipment (commercial)'),
('*','C06',2, 6,'OK_NG','Passenger seats & handrails','Every seat fixed (no rocking), no torn cushions or sharp edges; every handrail tight, not bent','Seats front to rear','Visual: seats · Self-declaration'),
('*','C07',2, 7,'OK_NG','Floorboard','No holes, soft spots or lifted panels; floor covering not torn or loose (nothing to trip on)','Floor, aisle','Visual: floorboard'),
('*','C08',2, 8,'OK_NG','Passenger doors & panels','Helper opens and closes each door: opens fully, closes with no gap, rubber seal not torn, panels tight','Each door, helper opens and closes','Visual: door panel'),
('*','C09',2, 9,'OK_NG','Window tint','No dark film added; windscreen lets through 70% light or more, front side windows 50% or more','Windows from inside','Window light transmittance'),
('*','C10',3,10,'OK_NG','Windscreen & wipers','No cracks or chips in the driver''s view; wipers sweep clean with no streaks, blades not torn','Whole windscreen, wipers running','Windows'),
('*','C11',3,11,'OK_NG','Low beam','Both lamps light up white, same brightness, lens clear (not cracked, foggy or with water inside)','Both lamps lit','Lighting · headlamp beam'),
('*','C12',3,12,'OK_NG','High beam','Both lamps light up brighter than low beam, blue light on the dash comes on, lens clear and not cracked','Both lamps lit','Lighting · headlamp beam'),
('*','C13',3,13,'OK_NG','Signal indicator (FR)','Flashes amber, steady speed (about 1–2 flashes a second), lens not cracked','Lamp lit','Lighting'),
('*','C14',3,14,'OK_NG','Signal indicator (FL)','Flashes amber, steady speed (about 1–2 flashes a second), lens not cracked','Lamp lit','Lighting'),
('*','C15',3,15,'OK_NG','Top marker light','Every lamp on the roof edge lights up, lenses not cracked or missing','Lamps lit','Lighting'),
('*','C16',3,16,'OK_NG','Registration plate (front)','Tight (not bent or loose), clean, every letter and number readable, nothing covering it','Plate, readable','Identity · Self-declaration'),
('*','C17',3,17,'BODY','Front body & paint','No damage = no dents, cracks, holes, rust, sharp edges, loose panels or scratches. Anything else: Mark damage','Whole front + close-up of each mark','Visual: body work / paint work'),
('*','C18',4,18,'TYRE','Front left tyre','Tread 6 mm or more all across the tyre · pressure 108 psi or more (target 120) · no cuts, bulges or cords showing','Calliper on the tread','Tyres'),
('*','C19',4,19,'BRAKE','Front left brake','Pad over 5 mm (3–5 mm Check soon, under 3 mm Replace) · disc not cracked','Pad with gauge','Brake performance'),
('*','C20',4,20,'OK_NG','Body marker light (L)','Every amber side lamp lights up, lenses not cracked or missing','Lamps lit','Lighting'),
('*','C21',4,21,'OK_NG','Body lettering & fleet no.','Company name and fleet no. present, readable from a few metres, not peeling or faded','Lettering on the body','Self-declaration'),
('*','C22',4,22,'BODY','Left side body & paint','No damage = no dents, cracks, holes, rust, sharp edges, loose panels or scratches. Anything else: Mark damage','Whole side + close-up of each mark','Visual: body work / paint work'),
('*','C23',4,23,'TYRE','Rear left tyre 1 · outer','Tread 6 mm or more all across the tyre · pressure 108 psi or more (target 120) · no cuts, bulges or cords showing','Calliper on the tread','Tyres'),
('*','C24',4,24,'TYRE','Rear left tyre 2 · inner','Tread 6 mm or more all across the tyre · pressure 108 psi or more (target 120) · no cuts, bulges or cords showing','Calliper on the tread','Tyres'),
('*','C25',4,25,'BRAKE','Rear left brake','Pad over 5 mm (3–5 mm Check soon, under 3 mm Replace) · disc not cracked','Pad with gauge','Brake performance'),
('*','C26',5,26,'OK_NG','Brake light','Both lamps light up red when the pedal is pressed and go off when released, lenses not cracked','Lamps lit','Lighting'),
('*','C27',5,27,'OK_NG','Third brake light','Lights up red with the brake pedal, goes off when released','Lamp lit','Lighting'),
('*','C28',5,28,'OK_NG','Reverse light','Lights up white when reverse is selected, goes off in neutral','Lamps lit','Lighting'),
('*','C29',5,29,'OK_NG','Rear plate light','Lights up white and lights the whole rear plate','Lamp lit','Lighting'),
('*','C30',5,30,'OK_NG','Rear marker lights','Both top corner lamps light up red, lenses not cracked or missing','Lamps lit','Lighting'),
('*','C31',5,31,'OK_NG','Registration plate (rear)','Tight (not bent or loose), clean, every letter and number readable, nothing covering it','Plate, readable','Identity · Self-declaration'),
('*','C32',5,32,'OK_NG','Speed limit sign','Sign at the rear, numbers readable, not faded, peeling or covered','Sign','Self-declaration'),
('*','C33',5,33,'OK_NG','Rear reflective markings','Strips along the rear present, MS 828 mark visible, clean, not faded or peeling','Reflective strips','Reflectors (JPJ rule, over 3,500 kg)'),
('*','C34',5,34,'BODY','Rear body & paint','No damage = no dents, cracks, holes, rust, sharp edges, loose panels or scratches. Anything else: Mark damage','Whole rear + close-up of each mark','Visual: body work / paint work'),
('*','C35',6,35,'TYRE','Rear right tyre 2 · inner','Tread 6 mm or more all across the tyre · pressure 108 psi or more (target 120) · no cuts, bulges or cords showing','Calliper on the tread','Tyres'),
('*','C36',6,36,'TYRE','Rear right tyre 1 · outer','Tread 6 mm or more all across the tyre · pressure 108 psi or more (target 120) · no cuts, bulges or cords showing','Calliper on the tread','Tyres'),
('*','C37',6,37,'BRAKE','Rear right brake','Pad over 5 mm (3–5 mm Check soon, under 3 mm Replace) · disc not cracked','Pad with gauge','Brake performance'),
('*','C38',6,38,'OK_NG','Body marker light (R)','Every amber side lamp lights up, lenses not cracked or missing','Lamps lit','Lighting'),
('*','C39',6,39,'BODY','Right side body & paint','No damage = no dents, cracks, holes, rust, sharp edges, loose panels or scratches. Anything else: Mark damage','Whole side + close-up of each mark','Visual: body work / paint work'),
('*','C40',6,40,'TYRE','Front right tyre','Tread 6 mm or more all across the tyre · pressure 108 psi or more (target 120) · no cuts, bulges or cords showing','Calliper on the tread','Tyres'),
('*','C41',6,41,'BRAKE','Front right brake','Pad over 5 mm (3–5 mm Check soon, under 3 mm Replace) · disc not cracked','Pad with gauge','Brake performance'),
('*','C42',7,42,'OK_NG','Steering & suspension','No play when helper turns the wheel; links not bent; shock absorbers dry; air bags not cracked or leaking','Linkages, shocks, air bags','Steering · suspension'),
('*','C43',7,43,'OK_NG','Undercarriage','Axle cover bolts, U-bolts and cross members tight, no cracks; no oil, coolant or grease leaks','Axle shaft cover, U-bolts, cross members, leaks','Visual: axle shaft cover, U-bolt, cross member'),
('*','C44',7,44,'OK_NG','Chassis & motor number','Stamped numbers clean and readable, same as on the registration card (grant)','Stamped numbers, readable','Vehicle identity');

-- 7. Settings (number bands and the 6-month cycle) ---------------------------
INSERT IGNORE INTO APP_SETTING (setting_key, setting_value) VALUES
('puspakom_cycle_months', '6'),
('puspakom_not_booked_days', '60'),
('puspakom_tread_min_mm', '6.0'),
('puspakom_pressure_target_psi', '120'),
('puspakom_pressure_low_pct', '90'),
('puspakom_pad_replace_mm', '3.0'),
('puspakom_pad_check_mm', '5.0');

-- 8. Notifications can point at an inspection --------------------------------
ALTER TABLE NOTIFICATION
  ADD COLUMN puspakom_inspection_id BIGINT UNSIGNED NULL AFTER job_id,
  ADD CONSTRAINT fk_notification_puspakom
    FOREIGN KEY (puspakom_inspection_id) REFERENCES PUSPAKOM_INSPECTION(inspection_id)
    ON DELETE SET NULL;

-- Check
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'PUSPAKOM\_%';
SELECT stop_no, COUNT(*) AS checks FROM PUSPAKOM_CHECK_DEF WHERE bus_model = '*' GROUP BY stop_no;
SELECT answer_type, COUNT(*) AS checks FROM PUSPAKOM_CHECK_DEF WHERE bus_model = '*' GROUP BY answer_type;
