-- ============================================================
-- Add real per-bus data for 9 projects that had zero BUS rows,
-- sourced from BUS BATTERY INFO.xlsx and BUS DETAIL ( ADMIN 2 ).xlsx.
--
-- Projects covered (52 buses): UTP, EMUTIARA (BAS.MY), USM, UUM,
-- UNIMAP, MBSA, MBSJ, MBHS (Hulu Selangor), UKM.
--
-- NOT covered by this script:
--   - GOKL: deliberately excluded. The new
--     "LIST OF GOKL BUSES ALLOCATION AS AT 20 NOVEMBER 2024" PDF
--     assigns several already-seeded buses to DIFFERENT route numbers
--     than what's currently in the database (e.g. VJX7642/VJY3718/
--     VKB8935/VKD1845/VKF3205 are CHOCOLATE/GOKL 09 in the DB today,
--     but GOKL 13 in the new PDF). This looks like a genuine route
--     renumbering between snapshots, not a data-entry error — see
--     chat for the full comparison. Needs a decision on which
--     numbering is current before touching GOKL data.
--   - UMT: source data explicitly says "NONE OPERATIONAL YET" with no
--     registration number — nothing to insert yet.
--   - MBDK: no data found in either source file.
--
-- Flagged for your attention, not corrected here: the UUM bus
-- UUM7929's route/lane is listed as "UMT" in BUS BATTERY INFO.xlsx —
-- likely a typo for "UUM" in the source spreadsheet, kept as-is.
--
--   mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < seed_more_project_buses.sql
-- ============================================================

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
