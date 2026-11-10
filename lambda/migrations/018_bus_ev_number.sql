-- 018: make sure BUS.bus_ev_no exists.
--
-- WHAT THIS IS. bus_ev_no is the fleet's own sequential number for a vehicle —
-- EV000..EV083 across the 84 GOKL units — and it is how the depot actually
-- identifies a bus. The GOKL tyre inspection form names every bus
-- "EV004 - VHG 3294": the EV number first, the plate second.
--
-- It is NOT bus_route_number. That column holds GOKL 01..GOKL 15, which is the
-- ROUTE: only 16 distinct values across 83 buses, each mapping to exactly one
-- route name, shared by 3 to 9 vehicles — and one bus (VKV8579) holds
-- 'GOKL 03 / GOKL 04' because it runs both. The app had been showing that
-- route code as though it identified the vehicle, so two different buses on the
-- same route were indistinguishable.
--
-- WHY IT MIGHT ALREADY EXIST. The column was introduced in
-- scripts/reset_and_seed_real_data.sql rather than a numbered migration, and
-- scripts/replace_gokl_buses.sql populates it. Any database those were run
-- against already has it, fully populated. This migration exists so a database
-- that missed them does not 500 the moment the Lambda starts selecting the
-- column — which it now does on every bus, tyre and inspection query.
--
-- IDEMPOTENT. MySQL 8 has no ADD COLUMN IF NOT EXISTS, so the add is guarded on
-- information_schema and skipped when the column is present. Safe to re-run.

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'BUS'
    AND COLUMN_NAME  = 'bus_ev_no'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE BUS ADD COLUMN bus_ev_no VARCHAR(20) NULL AFTER bus_model',
  'SELECT "BUS.bus_ev_no already present — nothing to do" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Looked up constantly once the app identifies buses by it, and the fleet
-- treats it as unique — but left as a plain index rather than UNIQUE on
-- purpose: a database that reaches this migration with the column missing has
-- no values yet, and a later backfill that duplicates one number should fail
-- loudly at review time, not halfway through an ALTER.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'BUS'
    AND INDEX_NAME   = 'idx_bus_ev_no'
);

SET @ddl := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_bus_ev_no ON BUS (bus_ev_no)',
  'SELECT "idx_bus_ev_no already present — nothing to do" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- VERIFY (expect 83 rows, every bus_ev_no distinct, no NULLs for GOKL):
--   SELECT COUNT(*) AS buses,
--          COUNT(DISTINCT bus_ev_no) AS distinct_ev,
--          SUM(bus_ev_no IS NULL) AS missing_ev
--   FROM BUS WHERE project_id = 'GOKL';
--
-- If missing_ev > 0, the seed never ran here — repopulate from
-- scripts/replace_gokl_buses.sql before deploying the Lambda, or those buses
-- will render with a blank code.
