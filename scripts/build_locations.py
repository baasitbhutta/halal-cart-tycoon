#!/usr/bin/env python3
"""Expand the spot ladder to 10 NYC locations. Run: python3 scripts/build_locations.py"""
import json

# id, name, rent/day, footTrafficPerHour, customerMix (office/student/tourist), popularityBonus
LOCS = [
    ("midtown_side", "Midtown Side Street", 0, 5, (0.55, 0.20, 0.25), 5),
    ("harlem_125", "125th Street, Harlem", 8, 5.5, (0.35, 0.40, 0.25), 4),
    ("central_park", "Central Park South", 15, 5, (0.15, 0.25, 0.60), 3),
    ("jackson_heights", "Jackson Heights, Queens", 18, 7, (0.30, 0.35, 0.35), 3),
    ("columbia", "Columbia University", 20, 8, (0.10, 0.70, 0.20), 2),
    ("coney_island", "Coney Island Boardwalk", 30, 7.5, (0.15, 0.35, 0.50), 2),
    ("fidi", "Financial District", 40, 9, (0.80, 0.05, 0.15), 0),
    ("herald_square", "Herald Square", 50, 10, (0.30, 0.20, 0.50), 0),
    ("times_square", "Times Square", 60, 13, (0.20, 0.20, 0.60), 0),
    ("rockefeller", "Rockefeller Center", 85, 15, (0.40, 0.05, 0.55), 0),
]

for lid, name, rent, traffic, (o, s, t), bonus in LOCS:
    assert abs(o + s + t - 1.0) < 1e-9, lid
    assert rent >= 0 and traffic > 0, lid
rents = [l[2] for l in LOCS]
assert rents == sorted(rents), "ladder must be rent-ordered"

deck = [
    {
        "id": lid,
        "name": name,
        "rent": rent,
        "footTrafficPerHour": traffic,
        "popularityBonus": bonus,
        "customerMix": {"office": o, "student": s, "tourist": t},
    }
    for lid, name, rent, traffic, (o, s, t), bonus in LOCS
]

for path in ("data/halal-cart.json", "web/public/data/halal-cart.json"):
    d = json.load(open(path))
    d["locations"] = deck
    json.dump(d, open(path, "w"), indent=2, ensure_ascii=False)
    open(path, "a").write("\n")
print(f"wrote {len(deck)} locations to both JSON copies")
