-- ============================================================
-- Full one-shot reset: wipe all dummy/test data, add the new BUS
-- attributes (EV number, route colour, route number), and seed the
-- real project list + GOKL fleet.
--
-- KEPT (untouched):     USER, PUSH_TOKEN, APP_SETTING
-- WIPED (all rows):     PROJECT, USER_PROJECT, BUS, PART, REPORT,
--                        REPORT_MEDIA, JOB, JOB_TASK, JOB_TASK_PART,
--                        JOB_MEDIA, JOB_HISTORY, NOTIFICATION, TYRE,
--                        TYRE_MOUNTING, TYRE_INSPECTION_SESSION,
--                        TYRE_INSPECTION, TYRE_TREAD
-- SEEDED:                12 real PROJECT rows, 80 real GOKL BUS rows,
--                        USER_PROJECT rows giving every admin access
--                        to all 12 projects
--
-- NOTIFICATION is wiped even though it wasn't asked about directly:
-- its rows carry report_id/job_id pointing at rows this script
-- deletes, so leaving them would either break the FK constraint or
-- leave the Notifications screen linking to reports/jobs that no
-- longer exist.
--
-- USER_PROJECT is cleared and reseeded: the dummy PROJECT rows are
-- being replaced with new ones, so old assignments would otherwise
-- dangle. Every admin is reassigned to all 12 real projects; non-admin
-- users are NOT auto-assigned here — reassign them via the app as
-- needed.
--
-- Real project list and GOKL fleet as provided 2026-08-16/18. Only
-- GOKL has confirmed per-bus data (from the attached spreadsheet) —
-- the other 11 projects are created with their known unit counts in
-- project_desc, but have zero BUS rows until real per-bus
-- registration lists are provided for them too.
--
-- The 5 buses that were listed under two different routes in the
-- sheet (VHL8649, VHL9546, VHM3544, VHP6210, VHP6024) have been
-- resolved to BLUE (GOKL 04), per confirmation.
--
-- Run this against your dev/staging database only — it is NOT
-- reversible outside of a prior backup/snapshot. Take one first if
-- you have any doubt.
--
--   mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < reset_and_seed_real_data.sql
--
-- Re-running this script is safe except for the three ALTER TABLE
-- statements below — comment those out on a second run, since MySQL
-- errors on a column that already exists.
-- ============================================================

-- ── New BUS attributes ──────────────────────────────────────────
ALTER TABLE BUS ADD COLUMN bus_ev_no VARCHAR(20) NULL AFTER bus_model;
ALTER TABLE BUS ADD COLUMN bus_route_colour VARCHAR(30) NULL AFTER bus_route;
ALTER TABLE BUS ADD COLUMN bus_route_number VARCHAR(20) NULL AFTER bus_route_colour;

-- ── Wipe dummy/test data ─────────────────────────────────────────
SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;

-- Children first, then their parents.
DELETE FROM JOB_TASK_PART;
DELETE FROM JOB_MEDIA;
DELETE FROM JOB_HISTORY;
DELETE FROM TYRE_TREAD;
DELETE FROM TYRE_INSPECTION;
DELETE FROM TYRE_INSPECTION_SESSION;
DELETE FROM TYRE_MOUNTING;
DELETE FROM NOTIFICATION;
DELETE FROM JOB_TASK;
DELETE FROM REPORT_MEDIA;
DELETE FROM REPORT;
DELETE FROM JOB;
DELETE FROM TYRE;
DELETE FROM BUS;
DELETE FROM PART;
DELETE FROM USER_PROJECT;
DELETE FROM PROJECT;

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;

-- ── Reset auto-increment counters ──────────────────────────────
-- Safe here since every row in each of these tables was just deleted.
-- BUS/PROJECT are skipped: their ids are natural VARCHAR keys, not
-- auto-increment.
ALTER TABLE JOB_TASK_PART AUTO_INCREMENT = 1;
ALTER TABLE JOB_MEDIA AUTO_INCREMENT = 1;
ALTER TABLE JOB_HISTORY AUTO_INCREMENT = 1;
ALTER TABLE TYRE_TREAD AUTO_INCREMENT = 1;
ALTER TABLE TYRE_INSPECTION AUTO_INCREMENT = 1;
ALTER TABLE TYRE_INSPECTION_SESSION AUTO_INCREMENT = 1;
ALTER TABLE TYRE_MOUNTING AUTO_INCREMENT = 1;
ALTER TABLE NOTIFICATION AUTO_INCREMENT = 1;
ALTER TABLE JOB_TASK AUTO_INCREMENT = 1;
ALTER TABLE REPORT_MEDIA AUTO_INCREMENT = 1;
ALTER TABLE REPORT AUTO_INCREMENT = 1;
ALTER TABLE JOB AUTO_INCREMENT = 1;
ALTER TABLE TYRE AUTO_INCREMENT = 1;
ALTER TABLE PART AUTO_INCREMENT = 1;

-- ── Real projects ────────────────────────────────────────────────
-- project_name is the official body name (as given); project_desc holds
-- the fleet composition, since most of these projects don't have per-bus
-- rows yet to derive it from.
INSERT INTO PROJECT (project_id, project_name, project_desc) VALUES
  ('GOKL',         'GoKL (Dewan Bandaraya Kuala Lumpur)',              '86 Units'),
  ('UKM',          'Universiti Kebangsaan Malaysia (UKM)',             '10 Units (10 Meter)'),
  ('MBSJ',         'Majlis Bandaraya Subang Jaya (Smart Selangor)',    '15 Units Coaster'),
  ('MBSA',         'Majlis Bandaraya Shah Alam (Smart Selangor)',      '4 Units (10 Meter)'),
  ('UTP',          'Universiti Teknologi PETRONAS (UTP)',              '2 Units (12 Meter)'),
  ('EMUTIARA',     'BAS.MY (E-Mutiara)',                               '8 Units (10 Meter)'),
  ('USM',          'Universiti Sains Malaysia (USM)',                  '4 Units (12 Meter)'),
  ('UUM',          'Universiti Utara Malaysia (UUM)',                  '1 Unit (12 Meter)'),
  ('UNIMAP',       'Universiti Malaysia Perlis (UniMAP)',               '2 Units (12 Meter)'),
  ('MBHS',         'Majlis Bandaraya Hulu Selangor (Smart Selangor)',  '6 Units (10 Meter), 2 Units (12 Meter)'),
  ('UMT',          'Universiti Malaysia Terengganu (UMT)',             '1 Unit (12 Meter)'),
  ('MBDK',         'Majlis Bandaraya Diraja Klang (Smart Selangor)',   '2 Units (10 Meter CRRC)');

-- ── GOKL buses (84 unique registrations) ────────────────────────
-- Source: "LIST OF GOKL BUSES ALLOCATION AS AT 20 NOVEMBER 2024" —
-- supersedes the original colour-coded spreadsheet's GOKL data, which
-- numbered several of these same buses on different routes (routes
-- were genuinely renumbered between the two snapshots). No route
-- colour data in this source, so bus_route_colour is NULL throughout.
-- VKV8579 (EV074) is explicitly a shared bus between GOKL 03 and
-- GOKL 04 in the source; recorded once under both route numbers in
-- bus_route_number since a bus can only have one row here.
-- Columns: bus_id, bus_route, bus_model, project_id, bus_ev_no, bus_route_colour, bus_route_number
INSERT INTO BUS (bus_id, bus_route, bus_model, project_id, bus_ev_no, bus_route_colour, bus_route_number) VALUES
  ('VJP3453', 'KLCC / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV047', NULL, 'GOKL 01'),
  ('VJP3458', 'KLCC / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV048', NULL, 'GOKL 01'),
  ('VJP3581', 'KLCC / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV049', NULL, 'GOKL 01'),
  ('VJP4113', 'KLCC / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV050', NULL, 'GOKL 01'),
  ('VJS4993', 'KLCC / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV052', NULL, 'GOKL 01'),
  ('VJS7569', 'KLCC / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV053', NULL, 'GOKL 01'),
  ('VJT2449', 'KLCC / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV054', NULL, 'GOKL 01'),
  ('VJT4089', 'KLCC / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV055', NULL, 'GOKL 01'),
  ('VJF6104', 'HAB PASAR SENI / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV039', NULL, 'GOKL 02'),
  ('VJG3205', 'HAB PASAR SENI / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV040', NULL, 'GOKL 02'),
  ('VJG6294', 'HAB PASAR SENI / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV041', NULL, 'GOKL 02'),
  ('VJH6641', 'HAB PASAR SENI / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV042', NULL, 'GOKL 02'),
  ('VJJ3307', 'HAB PASAR SENI / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV043', NULL, 'GOKL 02'),
  ('VJJ9153', 'HAB PASAR SENI / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV044', NULL, 'GOKL 02'),
  ('VJK9567', 'HAB PASAR SENI / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV045', NULL, 'GOKL 02'),
  ('VJP601', 'HAB PASAR SENI / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV046', NULL, 'GOKL 02'),
  ('VHG3294', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (175 kWh)', 'GOKL', 'EV004', NULL, 'GOKL 03'),
  ('VHG3315', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (229 kWh)', 'GOKL', 'EV005', NULL, 'GOKL 03'),
  ('VHG3340', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (229 kWh)', 'GOKL', 'EV006', NULL, 'GOKL 03'),
  ('VHG3347', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (175 kWh)', 'GOKL', 'EV007', NULL, 'GOKL 03'),
  ('VLR2048', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (175 kWh)', 'GOKL', 'EV076', NULL, 'GOKL 03'),
  ('VHG7821', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (229 kWh)', 'GOKL', 'EV009', NULL, 'GOKL 03'),
  ('VHH3907', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (229 kWh)', 'GOKL', 'EV010', NULL, 'GOKL 03'),
  ('VHQ9051', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (175 kWh)', 'GOKL', 'EV026', NULL, 'GOKL 03'),
  ('VJC7895', 'HAB TITIWANGSA / KL SENTRAL', 'ELC-10M (175 kWh)', 'GOKL', 'EV036', NULL, 'GOKL 03'),
  ('VKV8579', 'HAB TITIWANGSA / KL SENTRAL (shared)', 'ELC-10M (229 kWh)', 'GOKL', 'EV074', NULL, 'GOKL 03 / GOKL 04'),
  ('VHJ201', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV011', NULL, 'GOKL 04'),
  ('VHJ204', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (229 kWh)', 'GOKL', 'EV012', NULL, 'GOKL 04'),
  ('VHJ4016', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV013', NULL, 'GOKL 04'),
  ('VHJ4019', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV014', NULL, 'GOKL 04'),
  ('VHK3258', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (229 kWh)', 'GOKL', 'EV015', NULL, 'GOKL 04'),
  ('VHK3264', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (229 kWh)', 'GOKL', 'EV016', NULL, 'GOKL 04'),
  ('VHT6231', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV028', NULL, 'GOKL 04'),
  ('VHS6450', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (229 kWh)', 'GOKL', 'EV027', NULL, 'GOKL 04'),
  ('VJC2964', 'HAB TITIWANGSA / BUKIT BINTANG', 'ELC-10M (175 kWh)', 'GOKL', 'EV037', NULL, 'GOKL 04'),
  ('VHM8459', 'HAB TITIWANGSA / MINDEF', 'ELC-10M (175 kWh)', 'GOKL', 'EV022', NULL, 'GOKL 05'),
  ('VHK9144', 'HAB TITIWANGSA / MINDEF', 'ELC-10M (175 kWh)', 'GOKL', 'EV017', NULL, 'GOKL 05'),
  ('VHQ1273', 'HAB TITIWANGSA / MINDEF', 'ELC-10M (175 kWh)', 'GOKL', 'EV025', NULL, 'GOKL 05'),
  ('VJF1146', 'HAB TITIWANGSA / MINDEF', 'ELC-10M (175 kWh)', 'GOKL', 'EV038', NULL, 'GOKL 05'),
  ('VKE1557', 'PPR PANTAI RIA / LRT UNIVERSITI', 'ELC-10M (175 kWh)', 'GOKL', 'EV065', NULL, 'GOKL 06'),
  ('VHF5405', 'PPR PANTAI RIA / LRT UNIVERSITI', 'ELC-10M (175 kWh)', 'GOKL', 'EV003', NULL, 'GOKL 06'),
  ('VHF5401', 'PPR PANTAI RIA / LRT UNIVERSITI', 'ELC-10M (175 kWh)', 'GOKL', 'EV002', NULL, 'GOKL 06'),
  ('VKB8946', 'LRT DATO KERAMAT / KELUMPUK BAMBU', 'ELC-10M (175 kWh)', 'GOKL', 'EV066', NULL, 'GOKL 07'),
  ('VJS4546', 'LRT DATO KERAMAT / KELUMPUK BAMBU', 'ELC-10M (175 kWh)', 'GOKL', 'EV051', NULL, 'GOKL 07'),
  ('VLN1654', 'LRT DATO KERAMAT / KELUMPUK BAMBU', 'ELC-10M (175 kWh)', 'GOKL', 'EV075', NULL, 'GOKL 07'),
  ('VHL8649', 'MRT KAMPUNG BATU / CHOW KIT', 'ELC-10M (229 kWh)', 'GOKL', 'EV019', NULL, 'GOKL 08'),
  ('VHL9546', 'MRT KAMPUNG BATU / CHOW KIT', 'ELC-10M (229 kWh)', 'GOKL', 'EV020', NULL, 'GOKL 08'),
  ('VHM3544', 'MRT KAMPUNG BATU / CHOW KIT', 'ELC-10M (229 kWh)', 'GOKL', 'EV021', NULL, 'GOKL 08'),
  ('VHP6024', 'MRT KAMPUNG BATU / CHOW KIT', 'ELC-10M (175 kWh)', 'GOKL', 'EV024', NULL, 'GOKL 08'),
  ('VHP6210', 'MRT KAMPUNG BATU / CHOW KIT', 'ELC-10M (175 kWh)', 'GOKL', 'EV023', NULL, 'GOKL 08'),
  ('VKB8941', 'MRT KAMPUNG BATU / CHOW KIT', 'ELC-10M (175 kWh)', 'GOKL', 'EV067', NULL, 'GOKL 08'),
  ('VHR6314', 'LRT SRI RAMPAI / SEKSYEN 10 WANGSA MAJU', 'ELC-10M (175 kWh)', 'GOKL', 'EV001', NULL, 'GOKL 09'),
  ('VLX2850', 'LRT SRI RAMPAI / SEKSYEN 10 WANGSA MAJU', 'ELC-10M (229 kWh)', 'GOKL', 'EV078', NULL, 'GOKL 09'),
  ('VLW7501', 'LRT SRI RAMPAI / SEKSYEN 10 WANGSA MAJU', 'ELC-10M (175 kWh)', 'GOKL', 'EV079', NULL, 'GOKL 09'),
  ('VHK9147', 'LRT SRI RAMPAI / SEKSYEN 10 WANGSA MAJU', 'ELC-10M (229 kWh)', 'GOKL', 'EV018', NULL, 'GOKL 09'),
  ('VHU5744', 'TERMINAL MALURI / BANDAR SRI PERMAISURI', 'ELC-10M (175 kWh)', 'GOKL', 'EV029', NULL, 'GOKL 10'),
  ('VJA5985', 'TERMINAL MALURI / BANDAR SRI PERMAISURI', 'ELC-10M (255 kWh)', 'GOKL', 'EV032', NULL, 'GOKL 10'),
  ('VJB3371', 'TERMINAL MALURI / BANDAR SRI PERMAISURI', 'ELC-10M (229 kWh)', 'GOKL', 'EV034', NULL, 'GOKL 10'),
  ('BQM6423', 'TERMINAL MALURI / BANDAR SRI PERMAISURI', 'ELC-10M (229 kWh)', 'GOKL', 'EV000', NULL, 'GOKL 10'),
  ('VHV4501', 'MRT MALURI / BANDAR TUN RAZAK', 'ELC-10M (175 kWh)', 'GOKL', 'EV030', NULL, 'GOKL 11'),
  ('VHY9086', 'MRT MALURI / BANDAR TUN RAZAK', 'ELC-10M (229 kWh)', 'GOKL', 'EV031', NULL, 'GOKL 11'),
  ('VJB3453', 'MRT MALURI / BANDAR TUN RAZAK', 'ELC-10M (229 kWh)', 'GOKL', 'EV033', NULL, 'GOKL 11'),
  ('VJC455', 'MRT MALURI / BANDAR TUN RAZAK', 'ELC-10M (229 kWh)', 'GOKL', 'EV035', NULL, 'GOKL 11'),
  ('VJV6019', 'TAMAN FADASON / MRT SRI DELIMA', 'ELC-10M (175 kWh)', 'GOKL', 'EV056', NULL, 'GOKL 12'),
  ('VJW192', 'TAMAN FADASON / MRT SRI DELIMA', 'ELC-10M (175 kWh)', 'GOKL', 'EV057', NULL, 'GOKL 12'),
  ('VJX2168', 'TAMAN FADASON / MRT SRI DELIMA', 'ELC-10M (229 kWh)', 'GOKL', 'EV058', NULL, 'GOKL 12'),
  ('VKA6575', 'TAMAN FADASON / MRT SRI DELIMA', 'ELC-10M (175 kWh)', 'GOKL', 'EV061', NULL, 'GOKL 12'),
  ('VJX7642', 'MRT JINJANG / MATRADE', 'ELC-10M (175 kWh)', 'GOKL', 'EV059', NULL, 'GOKL 13'),
  ('VJY3718', 'MRT JINJANG / MATRADE', 'ELC-10M (175 kWh)', 'GOKL', 'EV060', NULL, 'GOKL 13'),
  ('VKB8935', 'MRT JINJANG / MATRADE', 'ELC-10M (175 kWh)', 'GOKL', 'EV062', NULL, 'GOKL 13'),
  ('VKD1845', 'MRT JINJANG / MATRADE', 'ELC-10M (175 kWh)', 'GOKL', 'EV063', NULL, 'GOKL 13'),
  ('VKF3205', 'MRT JINJANG / MATRADE', 'ELC-10M (175 kWh)', 'GOKL', 'EV064', NULL, 'GOKL 13'),
  ('VKC4781', 'KOMPLEKS KOMUNITI MUHIBBAH / PPR PINGGIRAN BUKIT JALIL', 'ELC-10M (175 kWh)', 'GOKL', 'EV068', NULL, 'GOKL 14'),
  ('VKC7684', 'KOMPLEKS KOMUNITI MUHIBBAH / PPR PINGGIRAN BUKIT JALIL', 'ELC-10M (175 kWh)', 'GOKL', 'EV069', NULL, 'GOKL 14'),
  -- VKL475 (EV070) excluded here: the same registration also appears under
  -- MBHS (Hulu Selangor, BUKIT SENTOSA - TAMAN BUNGA RAYA) in BUS DETAIL
  -- ( ADMIN 2 ).xlsx, which has no EV number field to disambiguate against.
  -- Kept under MBHS below since a bus_id can't have two rows; needs manual
  -- verification of which project this bus is actually on.
  ('VKM362', 'KOMPLEKS KOMUNITI MUHIBBAH / PPR PINGGIRAN BUKIT JALIL', 'ELC-10M (229 kWh)', 'GOKL', 'EV071', NULL, 'GOKL 14'),
  ('VKP4367', 'KOMPLEKS KOMUNITI MUHIBBAH / PPR PINGGIRAN BUKIT JALIL', 'ELC-10M (229 kWh)', 'GOKL', 'EV072', NULL, 'GOKL 14'),
  ('VKQ2484', 'KOMPLEKS KOMUNITI MUHIBBAH / PPR PINGGIRAN BUKIT JALIL', 'ELC-10M (229 kWh)', 'GOKL', 'EV073', NULL, 'GOKL 14'),
  ('VMR6950', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV004M', NULL, 'GOKL 15'),
  ('VMW6443', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV005M', NULL, 'GOKL 15'),
  ('VKY4089', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV000M', NULL, 'GOKL 15'),
  ('VMQ6631', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV001M', NULL, 'GOKL 15'),
  ('VMQ6372', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV002M', NULL, 'GOKL 15'),
  ('VMQ6378', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV003M', NULL, 'GOKL 15');

-- ── Buses for 9 other projects (52 buses) ────────────────────────
-- Source: BUS BATTERY INFO.xlsx and BUS DETAIL ( ADMIN 2 ).xlsx.
-- Covers UTP, EMUTIARA (BAS.MY), USM, UUM, UNIMAP, MBSA, MBSJ,
-- MBHS (Hulu Selangor), UKM. UMT and MBDK still have zero buses —
-- no registration data available for either yet.
-- Columns: bus_id, bus_route, bus_model, project_id, bus_ev_no, bus_route_colour, bus_route_number
INSERT INTO BUS (bus_id, bus_route, bus_model, project_id, bus_ev_no, bus_route_colour, bus_route_number) VALUES
  ('VPP482', 'UTP', 'ELC-12M (281 kWh)', 'UTP', NULL, NULL, NULL),
  ('VPP791', 'UTP', 'ELC-12M (281 kWh)', 'UTP', NULL, NULL, NULL),
  ('DFG3055', 'INDUSTRI', 'ELC-10M (281 kWh)', 'EMUTIARA', NULL, NULL, NULL),
  ('DFG3155', 'INDUSTRI', 'ELC-10M (281 kWh)', 'EMUTIARA', NULL, NULL, NULL),
  ('DFG3255', 'PENGKALAN CHEPA', 'ELC-10M (281 kWh)', 'EMUTIARA', NULL, NULL, NULL),
  ('DFG3455', 'PENGKALAN CHEPA', 'ELC-10M (229 kWh)', 'EMUTIARA', NULL, NULL, NULL),
  ('DFG3655', 'PANTAI CAHAYA BULAN', 'ELC-10M (229 kWh)', 'EMUTIARA', NULL, NULL, NULL),
  ('DFG3755', 'PANTAI CAHAYA BULAN', 'ELC-10M (229 kWh)', 'EMUTIARA', NULL, NULL, NULL),
  ('DFG3855', 'SABAK', 'ELC-10M (229 kWh)', 'EMUTIARA', NULL, NULL, NULL),
  ('DFG3955', 'SABAK', 'ELC-10M (229 kWh)', 'EMUTIARA', NULL, NULL, NULL),
  ('USM4959', 'USM', 'ELC-12M (229 kWh)', 'USM', NULL, NULL, NULL),
  ('USM5929', 'USM', 'ELC-12M (229 kWh)', 'USM', NULL, NULL, NULL),
  ('USM6929', 'USM', 'ELC-12M (229 kWh)', 'USM', NULL, NULL, NULL),
  ('USM7929', 'USM', 'ELC-12M (229 kWh)', 'USM', NULL, NULL, NULL),
  ('UUM7929', 'UMT', 'ELC-12M (229 kWh)', 'UUM', NULL, NULL, NULL),
  ('UR3477', 'UNIMAP', 'ELC-12M (281 kWh)', 'UNIMAP', NULL, NULL, NULL),
  ('UR4577', 'UNIMAP', 'ELC-12M (281 kWh)', 'UNIMAP', NULL, NULL, NULL),
  ('BSE6717', 'SEKSYEN 19', 'ELC-10M (281 kWh)', 'MBSA', NULL, NULL, NULL),
  ('BSE8936', 'SEKSYEN 19', 'ELC-10M (281 kWh)', 'MBSA', NULL, NULL, NULL),
  ('BSG4156', 'SEKSYEN 19', 'ELC-10M (281 kWh)', 'MBSA', NULL, NULL, NULL),
  ('BSG4162', 'SEKSYEN 19', 'ELC-10M (281 kWh)', 'MBSA', NULL, NULL, NULL),
  ('BSG5902', 'LRT KINRARA BKS / SMK BANDAR PUCHONG JAYA', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 03'),
  ('BSG5907', 'LRT KINRARA BKS / SMK BANDAR PUCHONG JAYA', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 03'),
  ('BSG5911', 'LRT KINRARA BKS / SMK BANDAR PUCHONG JAYA', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 03'),
  ('BSH1484', 'LRT SUBANG JAYA', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 01'),
  ('BSH1631', 'LRT SUBANG JAYA', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 01'),
  ('BSH1486', 'LRT SUBANG JAYA', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 01'),
  ('BSH1617', 'LRT PUSAT BANDAR PUCHONG / BANDAR SUNWAY / STESEN LRT SS18', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 02'),
  ('BSH1490', 'LRT PUSAT BANDAR PUCHONG / BANDAR SUNWAY / STESEN LRT SS19', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 02'),
  ('BSH1578', 'LRT PUSAT BANDAR PUCHONG / BANDAR SUNWAY / STESEN LRT SS20', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 02'),
  ('BSH1493', 'HOSPITAL SERDANG / KTM SERDANG', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 04'),
  ('BSH1575', 'HOSPITAL SERDANG / KTM SERDANG', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 04'),
  ('BSH1495', 'HOSPITAL SERDANG / KTM SERDANG', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 04'),
  ('BSH1621', 'TERMINAL PUTRA PERMAI / PANGSAPURI BAYU', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 05'),
  ('BSH1497', 'TERMINAL PUTRA PERMAI / PANGSAPURI BAYU', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, 'SJ 05'),
  ('BSH1500', 'SPARE / PARKING', 'ELC-7.2M (141 kWh)', 'MBSJ', NULL, NULL, NULL),
  ('VRD2845', 'BUKIT SENTOSA - KUALA KHUBU BARU', 'ELC-12M (175 kWh)', 'MBHS', NULL, NULL, 'HS 01'),
  ('SS7977Y', 'KUALA KHUBU BARU - BUKIT SENTOSA', 'ELC-10M (350 kWh)', 'MBHS', NULL, NULL, 'HS 01B'),
  ('SS5753X', 'ANTARAGAPI - KTM BATANG KALI', 'ELC-10M (350 kWh)', 'MBHS', NULL, NULL, 'HS 02'),
  ('VLR2059', 'BUKIT SENTOSA - SUNGAI BUAYA', 'ELC-10M (175 kWh)', 'MBHS', NULL, NULL, 'HS 03A'),
  ('VKL475', 'BUKIT SENTOSA - TAMAN BUNGA RAYA', 'ELC-10M (175 kWh)', 'MBHS', NULL, NULL, NULL),
  ('VHG7840', 'SPARE / PARKING', 'ELC-10M (175 kWh)', 'MBHS', NULL, NULL, NULL),
  ('UKM4599', 'UKM', 'ELC-10M (255 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM6599', 'UKM', 'ELC-10M (255 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM7599', 'UKM', 'ELC-10M (255 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM5499', 'UKM', 'ELC-10M (175 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM4699', 'UKM', 'ELC-10M (175 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM5299', 'UKM', 'ELC-10M (255 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM5099', 'UKM', 'ELC-10M (175 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM4899', 'UKM', 'ELC-10M (255 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM8299', 'UKM', 'ELC-10M (255 kWh)', 'UKM', NULL, NULL, NULL),
  ('UKM4799', 'UKM', 'ELC-10M (175 kWh)', 'UKM', NULL, NULL, NULL);

-- ── Admin project access ─────────────────────────────────────────
-- Every existing admin gets access to all 12 real projects. Non-admin
-- users are intentionally left unassigned here — reassign them via
-- the app as needed.
INSERT INTO USER_PROJECT (user_id, project_id)
SELECT u.user_id, p.project_id
FROM `USER` u
CROSS JOIN PROJECT p
WHERE u.user_role = 'admin';
