#!/usr/bin/env python3
"""Turn readings-2026-07.csv into a runnable migration.

    python3 scripts/tyre-import/build_sql.py

Writes lambda/migrations/010_tyre_inspection_import_2026_07.sql.

What it has to infer, because the paper form doesn't record it:

* How many grooves a tyre has — taken from how many of the four Kiri/Kanan
  cells are filled in. Every tyre on the form has exactly 3 or 4; a blank
  cell means that tyre simply has one fewer groove, not a missed reading.
* Whether a tyre was changed between the two July inspections — inferred when
  the model printed for that position changed, or when the lowest reading in
  the later inspection is above the highest in the earlier one (a tyre cannot
  regain tread). Anything else is treated as the same tyre re-measured.
* A pass/monitor/reject verdict — the form has no verdict column, so this is
  derived from the readings and from whether the tyre came off afterwards.
"""
import csv, os, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "readings-2026-07.csv")
OUT = os.path.join(HERE, "..", "..", "lambda", "migrations", "010_tyre_inspection_import_2026_07.sql")

POSITIONS = ["FL", "FR", "RLO", "RLI", "RRO", "RRI"]
GEOMETRY = {
    "FL":  (1, "left",  "single"),
    "FR":  (1, "right", "single"),
    "RLO": (2, "left",  "outer"),
    "RLI": (2, "left",  "inner"),
    "RRO": (2, "right", "outer"),
    "RRI": (2, "right", "inner"),
}
BRANDS = {"LM 666": "Long March", "LM 668": "Long March", "GT 867": "GITI", "GITI": "GITI"}
# Printed "GT 687" for EV067's rear tyres — a transposition of GT 867, the only
# GITI model anywhere else on the form.
MODEL_FIXES = {"GT 687": "GT 867"}
LOW_TREAD_MM = 5  # lambda/index.mjs TYRE_LOW_TREAD_THRESHOLD_MM

SESSION_TIME = {1: "09:00:00", 2: "15:00:00"}
SWAP_TIME = {2: "14:00:00"}


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def load():
    buses = defaultdict(lambda: {"sessions": defaultdict(lambda: {"readings": defaultdict(dict), "models": {}})})
    with open(CSV) as f:
        for r in csv.DictReader(f):
            b = buses[r["plate"]]
            b["fleet_code"], b["lane"] = r["fleet_code"], r["lane"]
            s = b["sessions"][int(r["session_no"])]
            s["date"], s["odometer"] = r["inspection_date"], int(r["odometer_km"])
            s["models"][r["position"]] = MODEL_FIXES.get(r["tyre_model"], r["tyre_model"])
            s["readings"][r["position"]][int(r["tread_position"])] = float(r["thickness_mm"])
    return buses


def replaced(prev, cur, pos):
    """Was the tyre at `pos` changed between these two inspections?"""
    if prev["models"].get(pos) != cur["models"].get(pos):
        return True
    a, b = prev["readings"].get(pos), cur["readings"].get(pos)
    return bool(a and b and min(b.values()) > max(a.values()))


def build():
    buses = load()
    tyres, mountings, sessions, inspections, treads = [], [], [], [], []
    swaps = []

    for plate in sorted(buses):
        bus = buses[plate]
        stem = plate.replace(" ", "")
        nos = sorted(bus["sessions"])
        first_date = bus["sessions"][nos[0]]["date"]

        for no in nos:
            s = bus["sessions"][no]
            sessions.append({"plate": plate, "no": no,
                             "dt": f"{s['date']} {SESSION_TIME[no]}", "odometer": s["odometer"]})

        for pos in POSITIONS:
            # Split the bus's inspections into fitments: a new fitment starts
            # wherever a replacement is detected at this position.
            fitments, current = [], []
            for idx, no in enumerate(nos):
                s = bus["sessions"][no]
                if pos not in s["readings"]:
                    continue
                if current and replaced(bus["sessions"][current[-1]], s, pos):
                    fitments.append(current)
                    current = []
                current.append(no)
            if current:
                fitments.append(current)

            for fit_idx, fit in enumerate(fitments):
                serial = f"{stem}-{pos}" if fit_idx == 0 else f"{stem}-{pos}-{fit_idx + 1}"
                model = bus["sessions"][fit[0]]["models"][pos]
                tread_count = max(len(bus["sessions"][n]["readings"][pos]) for n in fit)
                last = bus["sessions"][fit[-1]]
                min_mm = min(last["readings"][pos].values())
                is_last_fitment = fit_idx == len(fitments) - 1

                mounted_dt = (f"{first_date} 00:00:00" if fit_idx == 0
                              else f"{bus['sessions'][fit[0]]['date']} {SWAP_TIME[fit[0]]}")
                unmounted_dt = None
                if not is_last_fitment:
                    nxt = fitments[fit_idx + 1][0]
                    unmounted_dt = f"{bus['sessions'][nxt]['date']} {SWAP_TIME[nxt]}"

                # A tyre taken off below the low-tread threshold is scrap;
                # one taken off with tread left goes back to the spare pool.
                status = ("mounted" if is_last_fitment
                          else "rejected" if min_mm < LOW_TREAD_MM else "spare")

                tyres.append({"serial": serial, "brand": BRANDS.get(model), "model": model,
                              "tread_count": tread_count, "status": status})
                mountings.append({"serial": serial, "plate": plate, "pos": pos,
                                  "mounted_dt": mounted_dt, "unmounted_dt": unmounted_dt,
                                  "reason": None if is_last_fitment else "replaced (July 2026 inspection round)"})
                if not is_last_fitment:
                    swaps.append(f"{plate} {pos}: {serial} off at {min_mm}mm")

                for no in fit:
                    s = bus["sessions"][no]
                    readings = s["readings"][pos]
                    lo = min(readings.values())
                    result = ("reject" if (no == fit[-1] and not is_last_fitment)
                              else "monitor" if lo < LOW_TREAD_MM else "pass")
                    inspections.append({"plate": plate, "no": no, "serial": serial, "result": result,
                                        "reason": "Replaced after this inspection" if result == "reject" else None})
                    for tp in sorted(readings):
                        treads.append({"plate": plate, "no": no, "serial": serial,
                                       "tread_position": tp, "mm": readings[tp]})

    return buses, tyres, mountings, sessions, inspections, treads, swaps


def values(rows, cols):
    return ",\n".join("  (" + ", ".join(q(r[c]) for c in cols) + ")" for r in rows)


def main():
    buses, tyres, mountings, sessions, inspections, treads, swaps = build()
    plates = sorted(buses)
    n_swapped = len(swaps)

    sql = f"""-- Import of the GOKL "Tyres inspection form", July 2026 round.
--
-- Generated by scripts/tyre-import/build_sql.py from
-- scripts/tyre-import/readings-2026-07.csv (extracted from
-- "TYRES RECORD (GOKL).numbers"). Do not hand-edit — regenerate instead.
--
-- Loads {len(plates)} buses / {len(tyres)} tyres / {len(sessions)} inspection sessions /
-- {len(treads)} groove readings.
--
-- BUSES ---------------------------------------------------------------------
-- Buses are matched on BUS.bus_id = the registration plate, compared with
-- spaces stripped and case folded, so 'VHG 3294' and 'VHG3294' both match.
-- A bus that doesn't match is silently skipped — nothing is invented and no
-- BUS row is ever created or modified. The final SELECT lists every plate
-- that failed to match, so check that report before assuming a clean run.
--
-- SERIALS -------------------------------------------------------------------
-- The form carries no tyre serial numbers, so each tyre gets a positional
-- placeholder: '<plate><position>', e.g. 'VHG3294-FL', with '-2' appended for
-- a replacement tyre fitted at the same position later. Overwrite these as
-- real DOT serials get captured.
--
-- WHAT'S INFERRED -----------------------------------------------------------
-- * Groove count per tyre comes from how many of the four Kiri/Kanan cells
--   are filled. Every tyre on the form has exactly 3 or 4.
-- * {n_swapped} tyres are modelled as having been changed between the two July
--   inspections, inferred from a changed tyre model or from readings that
--   rise between inspections (a tyre cannot regain tread). They are unmounted
--   and a fresh tyre is mounted in their place.
-- * pass/monitor/reject is derived — the form has no verdict column. Anything
--   under {LOW_TREAD_MM}mm is 'monitor'; a tyre that came off afterwards is 'reject'.
-- * mounted_at is the bus's first inspection date, i.e. the earliest date the
--   tyre is known to have been on the bus, NOT its actual fitment date.
-- * Tyre pressure and retread counts are not on this form and are left NULL.
--
-- Re-running is safe: every insert is guarded, so a second run adds nothing.

SET @imp_user := COALESCE(
  (SELECT user_id FROM `USER` WHERE user_role='technician' ORDER BY user_id LIMIT 1),
  (SELECT user_id FROM `USER` WHERE user_role IN ('rm_manager','admin') ORDER BY user_id LIMIT 1),
  (SELECT user_id FROM `USER` ORDER BY user_id LIMIT 1)
);

DROP TABLE IF EXISTS _IMP_TREAD, _IMP_INSPECTION, _IMP_SESSION, _IMP_MOUNTING, _IMP_TYRE;

CREATE TABLE _IMP_TYRE (
  serial VARCHAR(64) PRIMARY KEY, brand VARCHAR(100) NULL, model VARCHAR(100) NULL,
  tread_count INT UNSIGNED NOT NULL, status VARCHAR(20) NOT NULL
);
CREATE TABLE _IMP_MOUNTING (
  serial VARCHAR(64) NOT NULL, plate VARCHAR(32) NOT NULL, plate_norm VARCHAR(32) NOT NULL,
  axle_number TINYINT UNSIGNED NOT NULL, axle_side VARCHAR(10) NOT NULL, wheel_position VARCHAR(10) NOT NULL,
  mounted_dt DATETIME NOT NULL, unmounted_dt DATETIME NULL, unmount_reason VARCHAR(255) NULL,
  PRIMARY KEY (serial)
);
CREATE TABLE _IMP_SESSION (
  plate VARCHAR(32) NOT NULL, plate_norm VARCHAR(32) NOT NULL, session_no TINYINT NOT NULL,
  inspection_dt DATETIME NOT NULL, odometer INT UNSIGNED NULL,
  PRIMARY KEY (plate, session_no)
);
CREATE TABLE _IMP_INSPECTION (
  plate VARCHAR(32) NOT NULL, session_no TINYINT NOT NULL, serial VARCHAR(64) NOT NULL,
  result VARCHAR(10) NOT NULL, reject_reason VARCHAR(255) NULL,
  PRIMARY KEY (plate, session_no, serial)
);
CREATE TABLE _IMP_TREAD (
  plate VARCHAR(32) NOT NULL, session_no TINYINT NOT NULL, serial VARCHAR(64) NOT NULL,
  tread_position TINYINT UNSIGNED NOT NULL, thickness_mm DECIMAL(4,1) NOT NULL,
  PRIMARY KEY (plate, session_no, serial, tread_position)
);

INSERT INTO _IMP_TYRE (serial, brand, model, tread_count, status) VALUES
{values(tyres, ['serial','brand','model','tread_count','status'])};

INSERT INTO _IMP_MOUNTING (serial, plate, plate_norm, axle_number, axle_side, wheel_position, mounted_dt, unmounted_dt, unmount_reason) VALUES
{values([dict(m, plate_norm=m['plate'].replace(' ', '').upper(),
              axle_number=GEOMETRY[m['pos']][0], axle_side=GEOMETRY[m['pos']][1],
              wheel_position=GEOMETRY[m['pos']][2]) for m in mountings],
        ['serial','plate','plate_norm','axle_number','axle_side','wheel_position','mounted_dt','unmounted_dt','reason'])};

INSERT INTO _IMP_SESSION (plate, plate_norm, session_no, inspection_dt, odometer) VALUES
{values([dict(s, plate_norm=s['plate'].replace(' ', '').upper()) for s in sessions],
        ['plate','plate_norm','no','dt','odometer'])};

INSERT INTO _IMP_INSPECTION (plate, session_no, serial, result, reject_reason) VALUES
{values(inspections, ['plate','no','serial','result','reason'])};

INSERT INTO _IMP_TREAD (plate, session_no, serial, tread_position, thickness_mm) VALUES
{values(treads, ['plate','no','serial','tread_position','mm'])};

-- --------------------------------------------------------------------------
-- 1. Tyres. UNIQUE(tyre_serial_number) makes this idempotent.
-- --------------------------------------------------------------------------
INSERT IGNORE INTO TYRE (tyre_serial_number, tyre_brand, tyre_model, tyre_retread_count, tyre_tread_count, tyre_status)
SELECT s.serial, s.brand, s.model, 0, s.tread_count, s.status FROM _IMP_TYRE s;

-- --------------------------------------------------------------------------
-- 2. Mountings. Bus resolved by normalised plate; unmatched buses drop out of
--    the join, taking their sessions and readings with them.
-- --------------------------------------------------------------------------
INSERT INTO TYRE_MOUNTING (tyre_id, bus_id, axle_number, axle_side, wheel_position, mounted_at, mounted_by, unmounted_at, unmounted_by, unmount_reason)
SELECT t.tyre_id, b.bus_id, s.axle_number, s.axle_side, s.wheel_position, s.mounted_dt, @imp_user,
       s.unmounted_dt, CASE WHEN s.unmounted_dt IS NULL THEN NULL ELSE @imp_user END, s.unmount_reason
FROM _IMP_MOUNTING s
JOIN TYRE t ON t.tyre_serial_number = s.serial
JOIN BUS  b ON REPLACE(UPPER(b.bus_id), ' ', '') = s.plate_norm
LEFT JOIN TYRE_MOUNTING m ON m.tyre_id = t.tyre_id AND m.bus_id = b.bus_id AND m.mounted_at = s.mounted_dt
WHERE m.tyre_mounting_id IS NULL;

-- Keep TYRE.tyre_status in step with what actually got mounted.
UPDATE TYRE t JOIN _IMP_TYRE s ON s.serial = t.tyre_serial_number
SET t.tyre_status = s.status
WHERE EXISTS (SELECT 1 FROM TYRE_MOUNTING m WHERE m.tyre_id = t.tyre_id);

-- --------------------------------------------------------------------------
-- 3. Inspection sessions.
-- --------------------------------------------------------------------------
INSERT INTO TYRE_INSPECTION_SESSION (bus_id, technician_user_id, inspection_datetime, odometer_reading)
SELECT b.bus_id, @imp_user, s.inspection_dt, s.odometer
FROM _IMP_SESSION s
JOIN BUS b ON REPLACE(UPPER(b.bus_id), ' ', '') = s.plate_norm
LEFT JOIN TYRE_INSPECTION_SESSION x ON x.bus_id = b.bus_id AND x.inspection_datetime = s.inspection_dt
WHERE @imp_user IS NOT NULL AND x.tyre_inspection_session_id IS NULL;

-- --------------------------------------------------------------------------
-- 4. Per-tyre inspections. UNIQUE(session_id, tyre_id) makes this idempotent.
-- --------------------------------------------------------------------------
INSERT IGNORE INTO TYRE_INSPECTION (session_id, tyre_id, tyre_pressure, retread_count_observed, inspection_result, reject_reason)
SELECT sess.tyre_inspection_session_id, t.tyre_id, NULL, NULL, i.result, i.reject_reason
FROM _IMP_INSPECTION i
JOIN _IMP_SESSION s ON s.plate = i.plate AND s.session_no = i.session_no
JOIN BUS b ON REPLACE(UPPER(b.bus_id), ' ', '') = s.plate_norm
JOIN TYRE_INSPECTION_SESSION sess ON sess.bus_id = b.bus_id AND sess.inspection_datetime = s.inspection_dt
JOIN TYRE t ON t.tyre_serial_number = i.serial;

-- --------------------------------------------------------------------------
-- 5. Groove readings. UNIQUE(tyre_inspection_id, tread_position) idempotent.
-- --------------------------------------------------------------------------
INSERT IGNORE INTO TYRE_TREAD (tyre_inspection_id, tread_position, tread_thickness_mm)
SELECT insp.tyre_inspection_id, r.tread_position, r.thickness_mm
FROM _IMP_TREAD r
JOIN _IMP_SESSION s ON s.plate = r.plate AND s.session_no = r.session_no
JOIN BUS b ON REPLACE(UPPER(b.bus_id), ' ', '') = s.plate_norm
JOIN TYRE_INSPECTION_SESSION sess ON sess.bus_id = b.bus_id AND sess.inspection_datetime = s.inspection_dt
JOIN TYRE t ON t.tyre_serial_number = r.serial
JOIN TYRE_INSPECTION insp ON insp.session_id = sess.tyre_inspection_session_id AND insp.tyre_id = t.tyre_id;

-- --------------------------------------------------------------------------
-- 6. Report. Read this before treating the import as done.
-- --------------------------------------------------------------------------
SELECT 'buses on form' AS metric, COUNT(DISTINCT plate) AS value FROM _IMP_SESSION
UNION ALL SELECT 'buses matched in BUS', COUNT(DISTINCT s.plate) FROM _IMP_SESSION s JOIN BUS b ON REPLACE(UPPER(b.bus_id),' ','') = s.plate_norm
UNION ALL SELECT 'tyres created', COUNT(*) FROM TYRE t JOIN _IMP_TYRE s ON s.serial = t.tyre_serial_number
UNION ALL SELECT 'mountings', COUNT(*) FROM TYRE_MOUNTING m JOIN TYRE t ON t.tyre_id=m.tyre_id JOIN _IMP_TYRE s ON s.serial=t.tyre_serial_number
UNION ALL SELECT 'sessions', COUNT(*) FROM TYRE_INSPECTION_SESSION x JOIN _IMP_SESSION s ON x.inspection_datetime = s.inspection_dt AND REPLACE(UPPER(x.bus_id),' ','') = s.plate_norm
UNION ALL SELECT 'groove readings', COUNT(*) FROM TYRE_TREAD d JOIN TYRE_INSPECTION i ON i.tyre_inspection_id=d.tyre_inspection_id JOIN TYRE t ON t.tyre_id=i.tyre_id JOIN _IMP_TYRE s ON s.serial=t.tyre_serial_number;

SELECT s.plate AS bus_plate_not_found_in_BUS, s.plate_norm
FROM _IMP_SESSION s
LEFT JOIN BUS b ON REPLACE(UPPER(b.bus_id), ' ', '') = s.plate_norm
WHERE b.bus_id IS NULL AND s.session_no = 1
ORDER BY s.plate;

DROP TABLE _IMP_TREAD, _IMP_INSPECTION, _IMP_SESSION, _IMP_MOUNTING, _IMP_TYRE;
"""

    with open(OUT, "w") as f:
        f.write(sql)
    print(f"{len(plates)} buses, {len(tyres)} tyres, {len(mountings)} mountings, "
          f"{len(sessions)} sessions, {len(inspections)} inspections, {len(treads)} readings")
    print(f"{n_swapped} tyres modelled as replaced:")
    for s in swaps:
        print("   ", s)
    print("->", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
