#!/usr/bin/env python3
"""Extract the GOKL tyre inspection form (.numbers) into a flat CSV.

    pip install numbers-parser
    python3 scripts/tyre-import/extract.py "~/Downloads/TYRES RECORD (GOKL).numbers"

Writes readings-2026-07.csv next to this script — one row per groove reading.
That CSV is the committed, diffable source of truth for build_sql.py, so the
SQL can be regenerated without the original .numbers file.

Sheet layout (sheet 1, "Tyres Inspection Checklist"): each bus is a 5-row
block — a "Model Tayar" header row carrying the bus, date, odometer and the
six tyre models, then four reading rows (Kiri 1, Kiri 2, Kanan 1, Kanan 2)
giving one groove reading per tyre. Columns 6-11 are the first inspection,
columns 17-22 an optional re-inspection of the same bus.
"""
import csv, os, re, sys

POSITIONS = ["FL", "FR", "RLO", "RLI", "RRO", "RRI"]
LABELS = ("Kiri 1", "Kiri 2", "Kanan 1", "Kanan 2")
DATE_RE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "readings-2026-07.csv")


def cell(row, i):
    return str(row[i]).strip() if i < len(row) and row[i] is not None else ""


def mm(v):
    if not v:
        return None
    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*mm$", v, re.I) or re.match(r"^([0-9]+(?:\.[0-9]+)?)$", v)
    if not m:
        raise ValueError(f"unparsable reading {v!r}")
    return float(m.group(1))


def iso(v):
    m = DATE_RE.match(v)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def odo(v):
    m = re.match(r"^([0-9,]+)\s*km$", v, re.I)
    return int(m.group(1).replace(",", "")) if m else None


def split_bus(v):
    """'EV004 - VHG 3294' / 'EV019 -VHL 8649' / 'EV8M (0000) - VKY 4089'."""
    v = " ".join(v.split())
    m = re.match(r"^(.*?)\s*-\s*([A-Z]{2,3}\s*\d{1,4})$", v)
    if not m:
        raise ValueError(f"unparsable bus {v!r}")
    return re.sub(r"\s*\(.*?\)", "", m.group(1)).strip(), " ".join(m.group(2).split())


def read_rows(path):
    from numbers_parser import Document
    return list(Document(path).sheets[0].tables[0].rows(values_only=True))


def main(path):
    rows = read_rows(path)
    out, lane, i = [], None, 0

    while i < len(rows):
        r = rows[i]
        if cell(r, 1):
            lane = " ".join(cell(r, 1).split())
        if cell(r, 5) != "Model Tayar":
            i += 1
            continue

        fleet, plate = split_bus(cell(r, 2))
        sessions = [(1, iso(cell(r, 3)), odo(cell(r, 4)), [cell(r, 6 + k) for k in range(6)], 6)]
        if iso(cell(r, 14)):
            assert split_bus(cell(r, 13))[1] == plate
            sessions.append((2, iso(cell(r, 14)), odo(cell(r, 15)), [cell(r, 17 + k) for k in range(6)], 17))

        for tread_pos, label in enumerate(LABELS, start=1):
            rr = rows[i + 1 + tread_pos - 1]
            shifted = cell(rr, 5) != label
            if shifted:
                # EV067 / VKB 8941 is the one bus whose reading rows are shifted
                # a column left in the source — the Kiri/Kanan label cell is
                # missing, so readings sit at idx5..11 (seven cells) instead of
                # idx6..11. Shifting back recovers the two front columns exactly;
                # every non-blank rear cell across all four rows reads 18mm, so
                # the rear is a flat 18mm under any alignment.
                assert plate == "VKB 8941", (plate, label, cell(rr, 5))
            for no, date, odometer, models, base in sessions:
                for p in range(6):
                    if shifted:
                        v = mm(cell(rr, 5 + p)) if p < 2 else 18.0
                    else:
                        v = mm(cell(rr, base + p))
                    if v is None:
                        continue  # blank = this tyre simply has fewer grooves
                    out.append({
                        "plate": plate, "fleet_code": fleet, "lane": lane,
                        "session_no": no, "inspection_date": date, "odometer_km": odometer,
                        "position": POSITIONS[p], "tyre_model": models[p],
                        "tread_position": tread_pos, "thickness_mm": v,
                    })
        i += 5

    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(sorted(out, key=lambda d: (d["plate"], d["session_no"], POSITIONS.index(d["position"]), d["tread_position"])))
    print(f"{len(out)} readings -> {OUT}")


if __name__ == "__main__":
    main(os.path.expanduser(sys.argv[1]))
