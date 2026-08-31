"""
Build the MTA subway origin-destination network dataset.

Source: MTA Subway Origin-Destination Ridership Estimate (2025), data.ny.gov
        dataset y2qv-fytt.  https://data.ny.gov/d/y2qv-fytt

The source table is ~121 million rows keyed by
    year x month x day_of_week x hour_of_day x origin complex x destination complex

How it is queried matters a great deal.  Measured against the live API:

  * an aggregate with no `month` filter never returns -- it was still blocked after
    30 minutes and had to be killed;
  * filtering by a single origin complex is no better (~11 minutes for one origin,
    so ~14 hours for all 424) -- the origin column does not appear to be indexed;
  * filtering by `month` *is* fast: one month x one period, grouped by origin and
    destination and summed over all five weekdays, returns in about 10 seconds.

So the harvest is 12 months x 4 periods, each paged 50,000 rows at a time -- roughly
190 requests.  Every page is cached under data/cache/, so re-runs are free and an
interrupted run resumes where it stopped.

What we compute
---------------
Weekdays only (Mon-Fri), averaged over all months of 2025, binned into four periods:

    am   06:00-09:59   4 hours
    mid  10:00-15:59   6 hours
    pm   16:00-19:59   4 hours
    eve  20:00-05:59  10 hours

`estimated_average_ridership` is already an average for a given
(month, day_of_week, hour) cell, so summing the cells in a period and dividing by
(n_months * 5 weekdays) yields *average riders on a typical weekday* in that period.

Edges are the top N destinations per origin per period (see TOP_N).  The map keeps
all 424 complexes; only the network is pruned.  This asymmetry is deliberate.
"""

import json, os, re, time
from collections import defaultdict
import requests

URL     = "https://data.ny.gov/resource/y2qv-fytt.json"
DATASET = "y2qv-fytt"
YEAR    = 2025
TOP_N   = 50
CACHE   = os.path.join("data", "cache")
OUT     = os.path.join("data", "subway_network.json")

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
PERIODS = [
    ("am",  "AM peak", ["6", "7", "8", "9"]),
    ("mid", "Midday",  ["10", "11", "12", "13", "14", "15"]),
    ("pm",  "PM peak", ["16", "17", "18", "19"]),
    ("eve", "Evening", ["20", "21", "22", "23", "0", "1", "2", "3", "4", "5"]),
]

# MTA trunk-line colors, used to color network nodes by the first route serving
# the complex.  A complex served by several trunks takes its first listed route.
TRUNK = [
    (set("123"),  "#EE352E", "1/2/3"),
    (set("456"),  "#00933C", "4/5/6"),
    (set("7"),    "#B933AD", "7"),
    (set("ACE"),  "#0039A6", "A/C/E"),
    (set("BDFM"), "#FF6319", "B/D/F/M"),
    (set("NQRW"), "#FCCC0A", "N/Q/R/W"),
    (set("G"),    "#6CBE45", "G"),
    (set("JZ"),   "#996633", "J/Z"),
    (set("L"),    "#A7A9AC", "L"),
]
SIR = ("#0078C6", "Staten Island Ry")
SHUTTLE = ("#808183", "Shuttle")

# Staten Island Railway is only marginally present in this dataset -- complexes 501 (St George)
# and 502 (Tompkinsville) each appear in exactly ONE (month, day_of_week, hour) cell in all of
# 2025, against 1,440 possible. SIR fares are not collected the way subway fares are, so there is
# nothing to model destinations from. Including them would draw two ghost stations carrying
# essentially no riders; they are dropped, loudly, rather than silently averaged to near zero.
EXCLUDE = {"501": "St George (SIR)", "502": "Tompkinsville (SIR)"}

SESSION = requests.Session()


def soql(params, label, tries=8):
    """GET with retry -- data.ny.gov resets connections often under load."""
    for i in range(tries):
        try:
            r = SESSION.get(URL, params=params, timeout=300)
            if r.status_code == 200:
                return r.json()
            print("    %s: HTTP %s %s" % (label, r.status_code, r.text[:160]))
        except Exception as e:
            print("    %s: %s" % (label, type(e).__name__))
        time.sleep(min(5 * (i + 1), 30))
    raise SystemExit("giving up on " + label)


PAGE = 50000


def routes_of(name):
    m = re.search(r"\(([^()]*)\)\s*$", name)
    if not m:
        return []
    return [t.strip() for t in m.group(1).split(",") if t.strip()]


def trunk_of(routes):
    for r in routes:
        if r.upper().startswith("SIR"):
            return SIR
        head = r[0].upper()
        if head == "S":
            return SHUTTLE
        for members, color, label in TRUNK:
            if head in members:
                return color, label
    return SHUTTLE


def fetch_stations():
    """Distinct complexes, unioned over a few filtered slices (unfiltered times out)."""
    path = os.path.join(CACHE, "stations.json")
    if os.path.exists(path):
        return json.load(open(path))
    st = {}
    slices = [
        "month='1' AND day_of_week='Wednesday' AND hour_of_day='8'",
        "month='6' AND day_of_week='Wednesday' AND hour_of_day='17'",
        "month='10' AND day_of_week='Saturday' AND hour_of_day='14'",
    ]
    for wh in slices:
        d = soql({
            "$select": "origin_station_complex_id as id,origin_station_complex_name as name,"
                       "origin_latitude as lat,origin_longitude as lon",
            "$where": wh, "$group": "id,name,lat,lon", "$limit": 50000,
        }, "stations")
        for x in d:
            st.setdefault(x["id"], x)
    out = sorted(st.values(), key=lambda x: int(x["id"]))
    json.dump(out, open(path, "w"))
    return out


def fetch_months():
    path = os.path.join(CACHE, "months.json")
    if os.path.exists(path):
        return json.load(open(path))
    d = soql({"$select": "month", "$where": "hour_of_day='8' AND day_of_week='Wednesday'",
              "$group": "month", "$limit": 50}, "months")
    months = sorted(int(x["month"]) for x in d)
    json.dump(months, open(path, "w"))
    return months


def fetch_slice(month, pkey, hours):
    """All weekday flows for one month and one period, paged.

    Grouped by origin and destination and summed over the five weekdays and the
    hours of the period, so one row is one (origin, destination) pair for that
    month-period.  Ordered so that $offset paging is deterministic.
    """
    wd = ",".join("'%s'" % d for d in WEEKDAYS)
    hrs = ",".join("'%s'" % h for h in hours)
    where = ("month='%d' AND day_of_week in(%s) AND hour_of_day in(%s)"
             % (month, wd, hrs))
    rows, offset = [], 0
    while True:
        path = os.path.join(CACHE, "m%02d_%s_p%d.json" % (month, pkey, offset // PAGE))
        if os.path.exists(path):
            page = json.load(open(path))
        else:
            page = soql({
                "$select": "origin_station_complex_id as o,"
                           "destination_station_complex_id as d,"
                           "sum(estimated_average_ridership) as r",
                "$where": where, "$group": "o,d", "$order": "o,d",
                "$limit": PAGE, "$offset": offset,
            }, "month %d %s offset %d" % (month, pkey, offset))
            json.dump(page, open(path, "w"))
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def main():
    os.makedirs(CACHE, exist_ok=True)
    stations = fetch_stations()
    months = fetch_months()
    divisor = len(months) * len(WEEKDAYS)   # month-weekday cells averaged over
    print("%d complexes; months present: %s -> divide sums by %d"
          % (len(stations), months, divisor))

    idx = dict((s["id"], i) for i, s in enumerate(stations))
    pkeys = [p[0] for p in PERIODS]

    # (period, originIdx) -> {destIdx: riders}, summed across the 12 months
    flows = dict((pk, defaultdict(lambda: defaultdict(float))) for pk in pkeys)
    unknown = set()

    for pkey, _, hours in PERIODS:
        for month in months:
            rows = fetch_slice(month, pkey, hours)
            for x in rows:
                o, d = x["o"], x["d"]
                if o in EXCLUDE or d in EXCLUDE:
                    continue
                if o not in idx or d not in idx:
                    unknown.add(o if o not in idx else d)
                    continue
                flows[pkey][idx[o]][idx[d]] += float(x["r"])
            print("  %s month %2d: %d pairs cumulative %d"
                  % (pkey, month, len(rows), len(flows[pkey])))

    out_tot = defaultdict(lambda: defaultdict(float))   # sid -> per -> riders
    in_tot = defaultdict(lambda: defaultdict(float))
    ego = {}                                            # nodeIdx -> per -> [[destIdx, riders]]
    coverage = defaultdict(list)

    for i, s in enumerate(stations):
        e = {}
        for pk in pkeys:
            dests = flows[pk].get(i, {})
            lst = sorted(((j, r / divisor) for j, r in dests.items() if r > 0),
                         key=lambda t: -t[1])
            for j, r in lst:
                out_tot[s["id"]][pk] += r
                in_tot[stations[j]["id"]][pk] += r
            top = lst[:TOP_N]
            tot = sum(r for _, r in lst)
            if tot > 0:
                coverage[pk].append(sum(r for _, r in top) / tot)
            e[pk] = [[j, round(r, 2)] for j, r in top]
        ego[str(i)] = e

    print("excluded %d complexes with negligible coverage: %s"
          % (len(EXCLUDE), ", ".join(sorted(EXCLUDE.values()))))
    if unknown:
        # Anything here is a genuine gap in the station list, not a known exclusion.
        raise SystemExit("ERROR: %d complex ids absent from the station list: %s"
                         % (len(unknown), sorted(unknown)))

    for s in stations:
        s["routes"] = routes_of(s["name"])
        s["trunk"], s["trunk_label"] = trunk_of(s["routes"])
        s["lat"] = round(float(s["lat"]), 6)
        s["lon"] = round(float(s["lon"]), 6)
        s["out"] = [round(out_tot[s["id"]].get(p, 0.0), 1) for p in pkeys]
        s["in"] = [round(in_tot[s["id"]].get(p, 0.0), 1) for p in pkeys]

    cov = dict((p, round(sorted(coverage[p])[len(coverage[p]) // 2], 4)) for p in pkeys)
    print("median top-%d coverage per period: %s" % (TOP_N, cov))

    doc = {
        "meta": {
            "source": "MTA Subway Origin-Destination Ridership Estimate",
            "source_url": "https://data.ny.gov/d/" + DATASET,
            "dataset_id": DATASET,
            "year": YEAR,
            "months_included": months,
            "day_types": "weekdays only (Monday-Friday)",
            "units": "estimated average riders on a typical weekday, per period",
            "top_n": TOP_N,
            "median_top_n_coverage": cov,
            "note": ("estimated_average_ridership is modeled, not counted: origins come from "
                     "fare transactions, destinations are inferred by MTA. Values are "
                     "fractional and should be read as estimates."),
            "generated": time.strftime("%Y-%m-%d"),
        },
        "periods": [{"key": k, "label": l, "n_hours": len(h)} for k, l, h in PERIODS],
        "stations": stations,
        "ego": ego,
    }
    os.makedirs("data", exist_ok=True)
    json.dump(doc, open(OUT, "w"), separators=(",", ":"))
    print("wrote %s (%.2f MB)" % (OUT, os.path.getsize(OUT) / 1e6))


if __name__ == "__main__":
    main()
