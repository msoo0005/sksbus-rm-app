-- ============================================================
-- Replace all GOKL bus data with "LIST OF GOKL BUSES ALLOCATION
-- AS AT 20 NOVEMBER 2024" — the routes were renumbered since the
-- earlier spreadsheet this project's GOKL data was originally seeded
-- from, so several buses are on different route numbers now (e.g.
-- VJX7642/VJY3718/VKB8935/VKD1845/VKF3205 were CHOCOLATE/GOKL 09,
-- now GOKL 13; VHR6314/VLX2850/VLW7501/VHK9147 were SOFT PEACH/
-- GOKL 14, now GOKL 09). Confirmed as a genuine renumbering, not a
-- data error — replacing rather than merging.
--
-- This PDF has no route colour data, so bus_route_colour is NULL for
-- every GOKL bus after this runs (previously RED/BLUE/etc).
--
-- Route/model inference: the source PDF gives battery size (kWh) per
-- bus but not the model text. GOKL 01-14 buses are assumed ELC-10M
-- and GOKL 15 (Alam Damai/HUKM) buses ELC-6M, matching the model
-- sizes already on record for those exact registrations from the
-- prior seed.
--
-- VKV8579 (EV074) is explicitly marked "SHARING BUS GOKL 03, 04" in
-- the source — since a bus can only have one route in this schema,
-- it's recorded as project GOKL with bus_route_number
-- 'GOKL 03 / GOKL 04' and a "(shared)" note in bus_route, rather than
-- silently picked for one route only.
--
-- The 2 buses listed under "SMART SELANGOR" in this same PDF
-- (VHG7840, VLR2059) are NOT included here — they match entries
-- already in BUS DETAIL ( ADMIN 2 ).xlsx under Majlis Bandaraya Hulu
-- Selangor (MBHS), so they're seeded there instead
-- (see seed_more_project_buses.sql) rather than as GOKL buses.
--
--   mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < replace_gokl_buses.sql
-- ============================================================

-- FK checks off: all 80 previously-seeded bus_ids reappear unchanged
-- below (just with updated route data), so any existing REPORT/JOB/
-- TYRE_MOUNTING row referencing one still resolves correctly once
-- this script finishes — but the DELETE itself would otherwise be
-- rejected outright if any such reference already exists.
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM BUS WHERE project_id = 'GOKL';

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
  -- Kept under MBHS (seed_more_project_buses.sql) since a bus_id can't have
  -- two rows; needs manual verification of which project this bus is on.
  ('VKM362', 'KOMPLEKS KOMUNITI MUHIBBAH / PPR PINGGIRAN BUKIT JALIL', 'ELC-10M (229 kWh)', 'GOKL', 'EV071', NULL, 'GOKL 14'),
  ('VKP4367', 'KOMPLEKS KOMUNITI MUHIBBAH / PPR PINGGIRAN BUKIT JALIL', 'ELC-10M (229 kWh)', 'GOKL', 'EV072', NULL, 'GOKL 14'),
  ('VKQ2484', 'KOMPLEKS KOMUNITI MUHIBBAH / PPR PINGGIRAN BUKIT JALIL', 'ELC-10M (229 kWh)', 'GOKL', 'EV073', NULL, 'GOKL 14'),
  ('VMR6950', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV004M', NULL, 'GOKL 15'),
  ('VMW6443', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV005M', NULL, 'GOKL 15'),
  ('VKY4089', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV000M', NULL, 'GOKL 15'),
  ('VMQ6631', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV001M', NULL, 'GOKL 15'),
  ('VMQ6372', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV002M', NULL, 'GOKL 15'),
  ('VMQ6378', 'ALAM DAMAI / HUKM', 'ELC-6M (175 kWh)', 'GOKL', 'EV003M', NULL, 'GOKL 15');

SET FOREIGN_KEY_CHECKS = 1;
