"""
Download NYC borough boundaries and simplify them into a light basemap.

Source: NYC Open Data, "Borough Boundaries" (dataset gthc-hcne),
        https://data.cityofnewyork.us/d/gthc-hcne

The published file is ~3 MB, far more detail than a background layer needs. This
reduces it with Douglas-Peucker (implemented here to avoid a shapely/geopandas
dependency) and drops slivers -- small offshore islands that read as noise at the
scale the map is drawn.

The basemap is optional: app.js renders fine without data/boroughs.geojson.
"""

import json, math, os
import requests

URL = "https://data.cityofnewyork.us/api/geospatial/gthc-hcne?method=export&format=GeoJSON"
OUT = os.path.join("data", "boroughs.geojson")
CACHE = os.path.join("data", "cache", "boroughs_raw.geojson")

TOLERANCE = 0.0004      # degrees, ~35 m -- generous, this is a backdrop
MIN_RING_AREA = 2e-6    # squared degrees; drops slivers and tiny offshore islands


def perp_distance(p, a, b):
    """Perpendicular distance from point p to segment ab."""
    if a[0] == b[0] and a[1] == b[1]:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    num = abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1]))
    return num / math.hypot(b[0] - a[0], b[1] - a[1])


def simplify(points, tol):
    """Iterative Douglas-Peucker -- recursion would overflow on these rings."""
    if len(points) < 3:
        return points[:]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        far, far_d = -1, 0.0
        for i in range(lo + 1, hi):
            d = perp_distance(points[i], points[lo], points[hi])
            if d > far_d:
                far, far_d = i, d
        if far_d > tol:
            keep[far] = True
            stack.append((lo, far))
            stack.append((far, hi))
    return [p for p, k in zip(points, keep) if k]


def ring_area(ring):
    """Absolute shoelace area, in squared degrees."""
    s = 0.0
    for i in range(len(ring) - 1):
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(s) / 2


def clean_ring(ring):
    r = simplify([[round(x, 5), round(y, 5)] for x, y in ring], TOLERANCE)
    if len(r) < 4:
        return None
    if r[0] != r[-1]:
        r.append(r[0])
    if ring_area(r) < MIN_RING_AREA:
        return None
    return r


def clean_polygon(poly):
    rings = [clean_ring(r) for r in poly]
    rings = [r for r in rings if r]
    return rings or None


def main():
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    if os.path.exists(CACHE):
        geo = json.load(open(CACHE))
    else:
        r = requests.get(URL, timeout=300)
        r.raise_for_status()
        geo = r.json()
        json.dump(geo, open(CACHE, "w"))

    before = after = 0
    features = []
    for f in geo["features"]:
        gtype = f["geometry"]["type"]
        coords = f["geometry"]["coordinates"]
        if gtype == "Polygon":
            coords = [coords]
        parts = []
        for poly in coords:
            before += sum(len(r) for r in poly)
            cleaned = clean_polygon(poly)
            if cleaned:
                after += sum(len(r) for r in cleaned)
                parts.append(cleaned)
        if not parts:
            continue
        features.append({
            "type": "Feature",
            "properties": {"boroname": f["properties"].get("boroname")},
            "geometry": {"type": "MultiPolygon", "coordinates": parts},
        })

    out = {"type": "FeatureCollection", "features": features}
    os.makedirs("data", exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print("boroughs: %d  vertices %d -> %d  (%.0f%% removed)"
          % (len(features), before, after, 100 * (1 - after / before)))
    print("wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1e3))


if __name__ == "__main__":
    main()
