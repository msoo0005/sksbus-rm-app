-- 019: restore GOKL route colours.
--
-- WHAT HAPPENED. scripts/replace_gokl_buses.sql and
-- scripts/reset_and_seed_real_data.sql delete and reinsert every GOKL bus from
-- the November 2024 allocation list, which carries no colours, so every GOKL
-- bus came back with bus_route_colour NULL.
--
-- WHERE THE COLOURS COME FROM. The July 2026 GOKL tyre inspection form
-- (scripts/tyre-import/readings-2026-07.csv) labels lanes like
-- "1. RED (GOKL 03)". Every colour-labelled plate on that form was checked
-- against its bus_route_number here, with zero conflicts, so colour is a pure
-- function of route number.
--
-- KNOWN GAPS, left NULL on purpose rather than guessed:
--   - GOKL 07: the form names the route but gives no colour.
--   - VKV8579 ('GOKL 03 / GOKL 04'): shared between RED and BLUE. Not matched
--     by the exact route numbers below. Set it by hand once decided, e.g.
--       UPDATE BUS SET bus_route_colour='RED' WHERE bus_id='VKV8579';
--
-- SAFE TO RE-RUN. Only fills colours that are currently NULL, so a colour
-- someone has since set by hand in the app is never overwritten.

UPDATE BUS
SET bus_route_colour = CASE bus_route_number
    WHEN 'GOKL 01' THEN 'GREEN'
    WHEN 'GOKL 02' THEN 'PURPLE'
    WHEN 'GOKL 03' THEN 'RED'
    WHEN 'GOKL 04' THEN 'BLUE'
    WHEN 'GOKL 05' THEN 'ORANGE'
    WHEN 'GOKL 06' THEN 'TURQUOISE'
    WHEN 'GOKL 08' THEN 'MAROON'
    WHEN 'GOKL 09' THEN 'CHOCOLATE'
    WHEN 'GOKL 10' THEN 'PARROT GREEN'
    WHEN 'GOKL 11' THEN 'GREY'
    WHEN 'GOKL 12' THEN 'CREAM'
    WHEN 'GOKL 13' THEN 'MAGENTA'
    WHEN 'GOKL 14' THEN 'SOFT PEACH'
    WHEN 'GOKL 15' THEN 'WHITE'
  END
WHERE project_id = 'GOKL'
  AND bus_route_colour IS NULL
  AND bus_route_number IN ('GOKL 01','GOKL 02','GOKL 03','GOKL 04','GOKL 05',
                           'GOKL 06','GOKL 08','GOKL 09','GOKL 10','GOKL 11',
                           'GOKL 12','GOKL 13','GOKL 14','GOKL 15');

-- VERIFY. Expect only GOKL 07 and 'GOKL 03 / GOKL 04' left without a colour:
--   SELECT bus_route_number, bus_route_colour, COUNT(*) AS buses
--   FROM BUS WHERE project_id = 'GOKL'
--   GROUP BY bus_route_number, bus_route_colour
--   ORDER BY bus_route_number;
