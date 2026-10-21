#!/usr/bin/env python3
"""Build the taco-stand theme pack from the halal-cart pack.

The M4 thesis test: a second game on the same engine with zero sim changes.
Every balance-bearing number in the taco pack is copied 1:1 from the halal
pack (rents, traffic, mixes, prices, willingness multipliers, patience,
headline effects) — only names, ids, emoji and flavor text are new. The
script asserts that parity, so the taco pack inherits the halal pack's
Monte Carlo validation by construction (and gets its own MC run anyway).
"""
import json
import sys
from copy import deepcopy

SRC = "data/halal-cart.json"
OUTS = ["data/taco-stand.json", "web/public/data/taco-stand.json"]

SUPPLY_MAP = {  # halal id -> (taco id, name)
    "chicken_lb": ("tinga_lb", "Chicken Tinga"),
    "rice_lb": ("rice_lb", "Mexican Rice"),
    "pita_each": ("tortilla_each", "Tortillas"),
    "white_sauce_oz": ("salsa_verde_oz", "Salsa Verde"),
    "hot_sauce_oz": ("salsa_roja_oz", "Salsa Roja"),
    "drink_each": ("agua_each", "Agua Fresca"),
    "container_each": ("tray_each", "Serving Trays"),
    "lamb_lb": ("asada_lb", "Carne Asada"),
    "falafel_mix_lb": ("bean_mix_lb", "Bean Mix"),
}
AXIS_MAP = {  # halal id -> (taco id, name, blurb)
    "white_sauce": ("salsa_verde", "Salsa verde", "Too little = bland, too much = soupy."),
    "hot_sauce": ("salsa_roja", "Salsa roja", "The slow burn. Respect it."),
    "meat": ("meat", "Meat", "The protein portion — where loyalty is won."),
    "rice": ("rice", "Rice", "The quiet filler that makes it a meal."),
}
PRODUCT_MAP = {  # halal id -> (taco id, name, emoji)
    "chicken_platter": ("tacos", "Street Tacos", "🌮"),
    "lamb_gyro": ("burrito", "Carne Asada Burrito", "🌯"),
    "falafel_rice": ("quesadilla", "Bean & Cheese Quesadilla", "🧀"),
    "drink": ("agua_fresca", "Agua Fresca", "🍹"),
}
LOCATION_MAP = [  # by ladder index -> (taco id, name)
    ("boyle_heights", "Boyle Heights Corner"),
    ("echo_park", "Echo Park"),
    ("silver_lake", "Silver Lake"),
    ("koreatown", "Koreatown"),
    ("usc", "USC Campus"),
    ("venice_beach", "Venice Beach"),
    ("dtla", "Downtown LA"),
    ("santa_monica", "Santa Monica"),
    ("hollywood", "Hollywood Boulevard"),
    ("beverly_hills", "Beverly Hills"),
]
CREW_MAP = {
    "expeditor": ("line_cook", "The Line Cook", "A second pair of hands on the plancha when the rush hits."),
    "hype_man": ("sign_spinner", "Sign Spinner", "Spins a giant arrow. Somehow it works."),
}
UPGRADE_MAP = {
    "awning": ("shade_canopy", "Shade Canopy", "Keep the line cool and patient."),
    "pos_register": ("card_reader", "Card Reader", "Tap, chip, done — the line keeps moving."),
    "led_sign": ("neon_sign", "Neon Sign", "Visible from three blocks. TACOS, in pink."),
    "second_grill": ("second_plancha", "Second Plancha", "Double the sear, half the wait."),
}
TIER_MAP = {
    "street": ("cart", "Taco Cart"),
    "pro": ("truck", "Taco Truck"),
    "double": ("double_truck", "Double Truck"),
}

# (taco headline id, text) — index-aligned with the halal deck; effects are
# copied verbatim from the halal headline at the same index.
TACO_HEADLINES = [
    ("heat_wave", "Heat Wave Warning: 102°F by Noon — Hydrate, Then Eat Tacos"),
    ("metro_meltdown", "Metro Meltdown Strands Downtown Commuters at Lunch"),
    ("tiktok_hype", "TikTok Foodie Declares Your Taco Stand 'The One'"),
    ("tiktok_slam", "Viral Critic Calls Street Tacos 'Just Hype'"),
    ("tax_refund", "Tax Refunds Hit Bank Accounts Across LA"),
    ("stress_study", "Doctors Say Waiting in Line Reduces Stress"),
    ("rain_misery", "Atmospheric River Drenches the City"),
    ("listicle_top10", "Your Stand Lands on 'Top 10 Tacos in LA' List"),
    ("food_blog_raves", "Neighborhood Blog Raves About 'That Salsa Verde'"),
    ("celeb_spotted", "Famous Actor Photographed Holding Your Burrito"),
    ("queue_goes_viral", "Photo of Your Lunch Line Goes Viral"),
    ("critic_retracts", "Critic Eats Words, Then Eats a Second Burrito"),
    ("morning_show", "Local Morning Show Films Segment at Your Stand"),
    ("sauce_meme", "Salsa Verde Meme Sweeps the Internet"),
    ("five_star_surge", "Five-Star Reviews Flood In Overnight"),
    ("food_podcast", "Food Podcast Devotes Episode to Taco Truck Culture"),
    ("influencer_feud", "Two Influencers Feud Over 'Best Taco Truck' Crown"),
    ("review_bomb_backfire", "Rival Truck Review-Bombs You; Fans Rally"),
    ("sauce_ranking", "City Mag Ranks Your Salsa Roja #1"),
    ("food_show_feature", "New Food Show Episode Features LA Street Food"),
    ("perfect_day", "75° and Sunny: The Whole City Eats Outside Today"),
    ("heat_wave_two", "Second Heat Wave: Paleta Sellers Sold Out Citywide"),
    ("cold_snap", "LA Cold Snap: Residents Wear Their One Sweater"),
    ("downpour", "Flash Flood Warning: Streets Become Rivers"),
    ("hail_storm", "Miracle Hailstorm: Schools Closed, Streets Empty"),
    ("golden_day", "Postcard Weather Draws Record Beach Crowds"),
    ("humidity", "Humidity So Thick You Could Spread It on a Tortilla"),
    ("santa_ana", "Santa Ana Winds Knock Over Umbrellas Across LA"),
    ("first_spring", "First Real Day of Spring: Everyone's Outside"),
    ("october_heat", "October Heat Wave Extends Patio Season Another Week"),
    ("heat_dome", "Heat Dome Settles Over the Southland"),
    ("wintry_mix", "Rain and Cold: The Worst of Both Weathers"),
    ("first_frost", "First Frost: City Briefly Forgets How to Function"),
    ("transit_strike", "Bus Strike Snarls Commutes; Offices Half-Empty"),
    ("parade_day", "Parade Practice Brings Thousands Past Your Corner"),
    ("marathon", "LA Marathon Sunday: Hungry Runners, Hungrier Spectators"),
    ("summit_week", "Summit Week: Delegates Crave Street Food"),
    ("fashion_week", "Fashion Week: Models Secretly Eating Burritos"),
    ("comic_con", "Comic Con: Caped Crusaders Need Carbs"),
    ("office_return", "Bosses Order Everyone Back to the Office"),
    ("wfh_friday", "Work-From-Home Friday Empties Downtown"),
    ("construction", "Scaffolding Goes Up Across the Street"),
    ("film_shoot", "Film Shoot Closes Street — Crew Eats Local"),
    ("street_fair_elsewhere", "Street Fair Two Blocks Over Siphons the Lunch Crowd"),
    ("farmers_market", "New Farmers Market Draws the Lunch Crowd Away"),
    ("tech_conference", "Tech Conference Serves Free Lunch (Traitors)"),
    ("free_pizza_office", "Office Orders 200 Pizzas; Lunch Crowd Vanishes"),
    ("gridlock", "Gridlock Alert: Nobody's Going Anywhere for Lunch"),
    ("blackout", "Brief Blackout: Office Fridges Die, Everyone Eats Out"),
    ("water_main", "Water Main Break Floods the Other Guys' Block"),
    ("election_day", "Election Day: Poll Workers Run on Street Food"),
    ("graduation", "Graduation Season: Families Celebrate with Burritos"),
    ("payday_friday", "Payday Friday: Wallets Feel Heavy"),
    ("studio_bonus", "Studio Bonuses Land; Executives Splurge"),
    ("rent_day", "Rent Day: LA Collectively Counts Pennies"),
    ("layoffs", "Studio Layoffs Announced; Lunch Budgets Shrink"),
    ("crypto_crash", "Crypto Crashes; Bros Eat Sad Desk Salads"),
    ("crypto_moon", "Crypto Moons; Bros Buy Rounds for the Line"),
    ("lottery_fever", "Mega Jackpot Fever: Everyone Feels Lucky (and Generous)"),
    ("tourists_flush", "Exchange Rate Sends Tourists on a Spending Spree"),
    ("grocery_prices", "Grocery Prices Up Again; Eating Out Feels Smarter"),
    ("protein_craze", "High-Protein Craze Peaks: Carne Asada Is King"),
    ("sauce_superfood", "'Salsa Is a Superfood,' Claims Man, Probably"),
    ("slow_food", "Slow Food Movement: Savor the Wait"),
    ("meditation_app", "Meditation App Update Makes Everyone Patient"),
    ("zen_line", "Study: People in Lines Report 'Weirdly Zen' Feeling"),
    ("spicy_challenge", "Extreme Spice Challenge Trends Online"),
    ("gym_cheat_day", "New Year Gym Crowd Discovers 'Cheat Day'"),
    ("salad_scare", "Food Scare at a Salad Chain; City Switches to Tacos"),
    ("salad_chain_closed", "Salad Chain Closes 40 Stores; Refugees Seek Tacos"),
    ("kale_backlash", "Kale Backlash Enters Third Year"),
    ("book_club", "Citywide Book Club Picks 900-Page Novel; Parks Fill with Readers"),
    ("yoga_retreat", "Corporate Yoga Retreat: Meetings Cancelled, Moods Great"),
    ("rival_truck", "Flashy New Rival Truck Parks Across the Street"),
    ("rival_closed", "Rival Truck Closed for 'Permit Issues' 👀"),
    ("food_hall", "New Food Hall Opens — With $21 Salads"),
    ("elote_feud", "Elote Cart Feud Enters Day 12; Crowds Watch Free"),
    ("copycat_truck", "Copycat Truck Steals Your Color Scheme"),
    ("dollar_slice", "Dollar Slice Raises Price to $1.50; City Mourns, Moves On"),
    ("permit_day", "Permit Renewal Day: Half the Trucks in the City Closed"),
    ("app_crash", "Food Delivery Apps Crash at Noon. Sidewalks Win."),
    ("bee_swarm", "Bee Swarm Relocates to Tree Near Rival Truck"),
    ("ramadan_iftar", "Ramadan: Iftar Rush Expected at Sunset"),
    ("eid_festival", "Eid Festival Fills the Park with Families"),
    ("taco_guide", "City Publishes Taco Truck Guide; Stands Boom"),
    ("interfaith_fair", "Interfaith Food Fair Celebrates Street Vendors"),
    ("friday_prayers", "Friday Prayers Let Out Early; Hungry Congregation"),
    ("inspection_a", "Health Inspector Gives Your Stand an A — You Post It Proudly"),
    ("pigeon_union", "Pigeons Unionize; Demand Crumbs, Better Scraps"),
    ("taco_coyote", "Beloved Coyote 'Taco Coyote' Spotted in Echo Park"),
    ("domino_hustlers", "Domino Hustlers Declare Your Corner 'Lucky'"),
    ("mariachi_viral", "Mariachi Trio Outside Your Stand Goes Viral"),
    ("lost_tourist", "Tour Group of 40 Follows Your Umbrella, Mistakes It for a Flag"),
    ("dog_parade", "Dog Costume Parade Halts Traffic, Delights All"),
    ("dodgers_game", "Dodgers Game Tonight: Half the City Calls Out 'Sick'"),
    ("tour_bus", "Double-Decker Tour Buses Discover Your Block"),
    ("office_party", "Office Party Season: Assistants Order Burritos by the Dozen"),
    ("rain_check", "Rain Check: City Makes Up for Yesterday's Lost Lunches"),
    ("sample_rival", "Free-Sample Rival Shuts Down; Your Line Absorbs the Crowd"),
    ("nothing_happened", "Nothing Happened Today. Beautiful."),
]


def main() -> None:
    halal = json.load(open(SRC))
    t = {"id": "taco-stand", "name": "Taco Stand Tycoon",
         "tagline": "Sunshine, salsa, and cheerful capitalism — one taco at a time.",
         "emoji": "🌮",
         "scene": {"signText": "TACOS", "cart": "#c85a1e", "cartDark": "#8f3c10",
                   "cartLight": "#e07f3a", "stripe": "#f7ead9"}}

    # supplies: numbers verbatim, ids/names remapped
    t["supplies"] = []
    for s in halal["supplies"]:
        nid, name = SUPPLY_MAP[s["id"]]
        ns = deepcopy(s); ns["id"] = nid; ns["name"] = name
        t["supplies"].append(ns)

    # recipe axes
    t["recipeAxes"] = []
    for a in halal["recipeAxes"]:
        nid, name, blurb = AXIS_MAP[a["id"]]
        na = deepcopy(a); na["id"] = nid; na["name"] = name; na["blurb"] = blurb
        t["recipeAxes"].append(na)

    # customer types: numbers verbatim, recipeIdeal keys remapped
    t["customerTypes"] = []
    for c in halal["customerTypes"]:
        nc = deepcopy(c)
        nc["recipeIdeal"] = {AXIS_MAP[k][0]: v for k, v in c["recipeIdeal"].items()}
        t["customerTypes"].append(nc)

    # products: numbers verbatim, component ids remapped
    t["products"] = []
    for p in halal["products"]:
        nid, name, emoji = PRODUCT_MAP[p["id"]]
        np_ = deepcopy(p); np_["id"] = nid; np_["name"] = name; np_["emoji"] = emoji
        for comp in np_["components"]:
            comp["supplyId"] = SUPPLY_MAP[comp["supplyId"]][0]
            if "scaledBy" in comp:
                comp["scaledBy"] = AXIS_MAP[comp["scaledBy"]][0]
        t["products"].append(np_)

    # locations: numbers verbatim by ladder index
    assert len(halal["locations"]) == len(LOCATION_MAP)
    t["locations"] = []
    for loc, (nid, name) in zip(halal["locations"], LOCATION_MAP):
        nl = deepcopy(loc); nl["id"] = nid; nl["name"] = name
        t["locations"].append(nl)

    # crew / upgrades / tiers: numbers verbatim
    t["crew"] = []
    for c in halal["crew"]:
        nid, name, blurb = CREW_MAP[c["id"]]
        nc = deepcopy(c); nc["id"] = nid; nc["name"] = name; nc["blurb"] = blurb
        t["crew"].append(nc)
    t["upgrades"] = []
    for u in halal["upgrades"]:
        nid, name, blurb = UPGRADE_MAP[u["id"]]
        nu = deepcopy(u); nu["id"] = nid; nu["name"] = name; nu["blurb"] = blurb
        t["upgrades"].append(nu)
    t["cartTiers"] = []
    for tier in halal["cartTiers"]:
        nid, name = TIER_MAP[tier["id"]]
        nt = deepcopy(tier); nt["id"] = nid; nt["name"] = name
        t["cartTiers"].append(nt)

    # headlines: effects verbatim by index, text/id new
    assert len(halal["headlines"]) == len(TACO_HEADLINES) == 100
    t["headlines"] = [
        {"id": nid, "text": text, "effects": deepcopy(h["effects"])}
        for h, (nid, text) in zip(halal["headlines"], TACO_HEADLINES)
    ]

    # challenges: numbers verbatim from the halal set, start location mapped
    # by ladder index, copy re-voiced for LA — same scenarios, same difficulty
    TACO_CHALLENGE_COPY = [
        ("Quick Flip", "🏃", "Turn $200 into $500 in 16 days from the corner. Pure hustle."),
        ("Campus Crush", "🎓", "USC students are broke but loyal. Serve 160 of them in 21 days."),
        ("Five-Star Stand", "⭐", "Make them love you: reach 85% satisfaction at any spot within 21 days."),
        ("Big Time", "🎬", "Hollywood rent eats the unprepared. Start with $600, end with $2,000 in 21 days."),
    ]
    assert len(halal["challenges"]) == len(TACO_CHALLENGE_COPY) == 4
    halal_loc_index = {l["id"]: i for i, l in enumerate(halal["locations"])}
    t["challenges"] = []
    for hc, (name, emoji, blurb) in zip(halal["challenges"], TACO_CHALLENGE_COPY):
        nc = deepcopy(hc)
        nc["name"], nc["emoji"], nc["blurb"] = name, emoji, blurb
        nc["startLocationId"] = t["locations"][halal_loc_index[hc["startLocationId"]]]["id"]
        t["challenges"].append(nc)

    # ---- parity + referential validation ----
    errs = []
    for a, b in zip(halal["headlines"], t["headlines"]):
        if a["effects"] != b["effects"]:
            errs.append(f"headline effect drift at {b['id']}")
    if len({h["id"] for h in t["headlines"]}) != 100:
        errs.append("headline ids not unique")
    for a, b in zip(halal["locations"], t["locations"]):
        for k in ("rent", "footTrafficPerHour", "popularityBonus", "customerMix"):
            if a[k] != b[k]:
                errs.append(f"location drift {b['id']}.{k}")
    supply_ids = {s["id"] for s in t["supplies"]}
    axis_ids = {a["id"] for a in t["recipeAxes"]}
    type_ids = {c["id"] for c in t["customerTypes"]}
    for p in t["products"]:
        for comp in p["components"]:
            if comp["supplyId"] not in supply_ids:
                errs.append(f"{p['id']} references missing supply {comp['supplyId']}")
            if "scaledBy" in comp and comp["scaledBy"] not in axis_ids:
                errs.append(f"{p['id']} references missing axis {comp['scaledBy']}")
    for loc in t["locations"]:
        for tid in loc["customerMix"]:
            if tid not in type_ids:
                errs.append(f"{loc['id']} mix references missing type {tid}")
    for a, b in zip(halal["customerTypes"], t["customerTypes"]):
        for k in ("patienceMin", "refPrice", "recipeTolerance"):
            if a[k] != b[k]:
                errs.append(f"customer type drift {b['id']}.{k}")
        if set(b["recipeIdeal"].values()) != set(a["recipeIdeal"].values()):
            errs.append(f"recipeIdeal drift {b['id']}")
    taco_loc_index = {l["id"]: i for i, l in enumerate(t["locations"])}
    for a, b in zip(halal["challenges"], t["challenges"]):
        for k in ("id", "days", "startCash", "goal"):
            if a[k] != b[k]:
                errs.append(f"challenge drift {b['id']}.{k}")
        if halal_loc_index[a["startLocationId"]] != taco_loc_index[b["startLocationId"]]:
            errs.append(f"challenge start-ladder drift {b['id']}")
    if errs:
        print("VALIDATION FAILED:")
        [print(" -", e) for e in errs]
        sys.exit(1)

    for out in OUTS:
        json.dump(t, open(out, "w"), indent=2, ensure_ascii=False)
    print(f"taco pack written to {OUTS}: 100 headlines, {len(t['locations'])} locations, "
          f"{len(t['products'])} products, {len(t['supplies'])} supplies — parity validated")


if __name__ == "__main__":
    main()
