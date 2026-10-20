#!/usr/bin/env python3
"""Add 2 more menu items (lamb gyro, falafel over rice) with their supplies.

Run: python3 scripts/build_menu.py
"""
import json

# --- new supplies ------------------------------------------------------------
lamb = {
    "id": "lamb_lb",
    "name": "Lamb",
    "unit": "lb",
    "storageCap": 16,
    "shelfLifeDays": 1,
    "bundles": [
        {"qty": 2.5, "price": 11.0},
        {"qty": 8, "price": 32.0},
    ],
}
falafel_mix = {
    "id": "falafel_mix_lb",
    "name": "Falafel mix",
    "unit": "lb",
    "storageCap": 20,
    "shelfLifeDays": 14,
    "bundles": [
        {"qty": 4, "price": 5.0},
        {"qty": 16, "price": 16.0},
    ],
}

# --- new products ------------------------------------------------------------
gyro = {
    "id": "lamb_gyro",
    "name": "Lamb Gyro",
    "emoji": "🥙",
    "flagship": True,
    "defaultPrice": 11.5,
    "refPriceMult": 1.2,
    "typePref": {"office": 0.9, "tourist": 1.0, "student": 0.5},
    "components": [
        {"supplyId": "lamb_lb", "qty": 0.45, "scaledBy": "meat"},
        {"supplyId": "pita_each", "qty": 1},
        {"supplyId": "white_sauce_oz", "qty": 1.5, "scaledBy": "white_sauce"},
        {"supplyId": "hot_sauce_oz", "qty": 0.3, "scaledBy": "hot_sauce"},
        {"supplyId": "container_each", "qty": 1},
    ],
}
falafel = {
    "id": "falafel_rice",
    "name": "Falafel Over Rice",
    "emoji": "🧆",
    "flagship": True,
    "defaultPrice": 8.0,
    "refPriceMult": 0.88,
    "typePref": {"office": 0.6, "tourist": 0.8, "student": 1.0},
    "components": [
        {"supplyId": "falafel_mix_lb", "qty": 0.4},
        {"supplyId": "rice_lb", "qty": 0.3, "scaledBy": "rice"},
        {"supplyId": "pita_each", "qty": 1},
        {"supplyId": "white_sauce_oz", "qty": 1, "scaledBy": "white_sauce"},
        {"supplyId": "container_each", "qty": 1},
    ],
}

for path in ("data/halal-cart.json", "web/public/data/halal-cart.json"):
    d = json.load(open(path))

    supplies = d["supplies"]
    by_id = {s["id"]: s for s in supplies}
    by_id.setdefault("lamb_lb", lamb)
    by_id.setdefault("falafel_mix_lb", falafel_mix)
    d["supplies"] = supplies if "lamb_lb" in {s["id"] for s in supplies} else supplies + [lamb, falafel_mix]

    prods = d["products"]
    p_by_id = {p["id"]: p for p in prods}
    # enrich the existing chicken platter with choice prefs
    cp = p_by_id["chicken_platter"]
    cp.setdefault("emoji", "🍗")
    cp.setdefault("refPriceMult", 1.0)
    cp.setdefault("typePref", {"office": 1.0, "tourist": 0.9, "student": 0.7})
    drink = p_by_id["drink"]
    drink.setdefault("emoji", "🥤")
    if "lamb_gyro" not in p_by_id:
        prods.append(gyro)
    if "falafel_rice" not in p_by_id:
        prods.append(falafel)
    d["products"] = prods

    json.dump(d, open(path, "w"), indent=2, ensure_ascii=False)
    open(path, "a").write("\n")

print("menu: chicken platter + lamb gyro + falafel over rice + drink")
