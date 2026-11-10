-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs.
--
-- Three things the forms now capture that had nowhere to go:
--
-- 1. Sidewall / tyre condition is asked on BOTH forms, for every tyre. It was
--    previously only recorded for the tyre coming OFF during a swap, so a
--    routine inspection had no way to flag a damaged sidewall, and a tyre
--    being fitted had no condition recorded at all.
-- 2. Retread count observed at fitment, so the swap itself records how many
--    times the tyre going on has been retreaded rather than relying on
--    whatever TYRE.tyre_retread_count happened to say.
-- 3. A photo of the retread sticker, evidencing that count.

ALTER TABLE TYRE_INSPECTION
  ADD COLUMN sidewall_condition ENUM('ok','not_ok') NULL AFTER tyre_pressure;

ALTER TABLE TYRE_SWAP
  ADD COLUMN incoming_sidewall_condition ENUM('ok','not_ok') NULL AFTER incoming_tyre_pressure,
  -- The count as read off the tyre at fitment. Also written back to
  -- TYRE.tyre_retread_count, but kept here so the swap record stays a
  -- point-in-time statement of what was fitted.
  ADD COLUMN incoming_retread_count INT UNSIGNED NULL AFTER incoming_sidewall_condition,
  ADD COLUMN retread_sticker_s3_bucket VARCHAR(255) NULL AFTER incoming_retread_count,
  ADD COLUMN retread_sticker_s3_key VARCHAR(255) NULL AFTER retread_sticker_s3_bucket;

-- A tyre sent away for retreading is expected to come back and go on again,
-- so 'retreading' is no longer a terminal state in the Lambda's mount checks
-- (see TYRE_UNMOUNTABLE_STATUSES). No data change is needed for that — it's
-- noted here so the two stay in step.
