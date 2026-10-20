#!/usr/bin/env python3
"""Build the 100-headline deck for data/halal-cart.json (+ web/public copy).

Effect distribution is calibrated to the original 7-headline deck that the
Monte Carlo balance was validated against:
  demandMult mean ~1.05, payMult mean ~1.00, ranges kept inside the
  original bands (demand 0.70-1.30, pay 0.72-1.30). Run: python3 scripts/build_headlines.py
"""
import json, statistics, shutil, sys

# (id, text, effects)
H = [
    # ---- existing 7 (kept verbatim) ----
    ("heat_wave", "Heat Wave Warning: 95°F by Noon", {"demandMult": 1.2, "tempOverrideF": 95, "payMult": 1.1}),
    ("subway_meltdown", "Subway Meltdown Strands Midtown Commuters", {"demandMult": 1.18}),
    ("tiktok_hype", "TikTok Foodie Declares Your Cart 'Elite'", {"demandMult": 1.23, "popularityAdd": 3}),
    ("tiktok_slam", "Viral Critic Calls Halal Carts 'Overrated'", {"payMult": 0.75, "demandMult": 0.94}),
    ("tax_refund", "Tax Refunds Hit Bank Accounts Citywide", {"payMult": 1.25, "demandMult": 1.08}),
    ("stress_study", "Doctors Say Waiting in Line Reduces Stress", {"patienceAddMin": 3}),
    ("rain_misery", "April Showers Drench the City", {"demandMult": 0.75, "tempOverrideF": 58}),

    # ---- viral / food media ----
    ("listicle_top10", "Your Cart Lands on 'Top 10 Street Eats' Listicle", {"demandMult": 1.15, "popularityAdd": 2}),
    ("food_blog_raves", "Neighborhood Blog Raves About 'That White Sauce'", {"demandMult": 1.12}),
    ("celeb_spotted", "Famous Rapper Photographed Holding Your Platter", {"demandMult": 1.25, "popularityAdd": 4, "payMult": 1.15}),
    ("queue_goes_viral", "Photo of Your Lunch Line Goes Viral", {"demandMult": 1.2}),
    ("critic_retracts", "Critic Eats Words, Then Eats Second Platter", {"payMult": 1.22}),
    ("morning_show", "Local Morning Show Films Segment at Your Cart", {"demandMult": 1.18, "popularityAdd": 3}),
    ("sauce_meme", "White Sauce Meme Sweeps the Internet", {"demandMult": 1.1}),
    ("five_star_surge", "Five-Star Reviews Flood In Overnight", {"popularityAdd": 3, "demandMult": 1.18}),
    ("food_podcast", "Food Podcast Devotes Episode to Cart Culture", {"demandMult": 1.08}),
    ("influencer_feud", "Two Influencers Feud Over 'Best Cart' Crown", {"demandMult": 1.12}),
    ("review_bomb_backfire", "Rival Cart Review-Bombs You; Fans Rally", {"popularityAdd": 2, "demandMult": 1.05}),
    ("sauce_ranking", "City Mag Ranks Your White Sauce #1", {"demandMult": 1.16, "popularityAdd": 2}),
    ("food_show_feature", "New Food Show Episode Features NYC Street Food", {"demandMult": 1.15, "popularityAdd": 2}),

    # ---- weather ----
    ("perfect_day", "70° and Sunny: The City Eats Outside Today", {"demandMult": 1.28}),
    ("heat_wave_two", "Second Heat Wave: Ice Sellers Sold Out Citywide", {"demandMult": 1.18, "tempOverrideF": 97}),
    ("cold_snap", "Arctic Blast: Only the Brave (and Hungry) Venture Out", {"demandMult": 0.8, "tempOverrideF": 38}),
    ("downpour", "Flash Flood Warning: Sidewalks Become Rivers", {"demandMult": 0.7, "tempOverrideF": 61}),
    ("snow_day", "Surprise Snow Day: Schools Closed, Streets Empty", {"demandMult": 0.72}),
    ("golden_day", "Postcard Weather Draws Record Park Crowds", {"demandMult": 1.15, "tempOverrideF": 74}),
    ("humidity", "Humidity So Thick You Could Spread It on Pita", {"demandMult": 0.9, "tempOverrideF": 91}),
    ("wind_tunnel", "Wind Tunnel Effect Knocks Over Umbrellas Uptown", {"demandMult": 0.88}),
    ("first_spring", "First Real Day of Spring: Everyone's Outside", {"demandMult": 1.2, "tempOverrideF": 68}),
    ("indian_summer", "Indian Summer Extends Patio Season Another Week", {"demandMult": 1.12, "tempOverrideF": 82}),
    ("heat_dome", "Heat Dome Settles Over the Tri-State Area", {"demandMult": 1.15, "tempOverrideF": 93}),
    ("wintry_mix", "Wintry Mix: The Worst of Both Weathers", {"demandMult": 0.78, "tempOverrideF": 36}),
    ("first_snow", "First Snow: City Briefly Forgets How to Function", {"demandMult": 0.85, "tempOverrideF": 31}),

    # ---- transit / city life ----
    ("transit_strike", "Bus Strike Snarls Commutes; Offices Half-Empty", {"demandMult": 0.82}),
    ("parade_day", "Parade Route Brings Thousands Past Your Corner", {"demandMult": 1.3, "payMult": 1.1}),
    ("marathon", "Marathon Sunday: Hungry Runners, Hungrier Spectators", {"demandMult": 1.15}),
    ("un_week", "UN General Assembly: Delegates Crave Street Food", {"demandMult": 1.2, "payMult": 1.18}),
    ("fashion_week", "Fashion Week: Models Secretly Eating Platters", {"demandMult": 1.1}),
    ("comic_con", "Comic Con: Caped Crusaders Need Carbs", {"demandMult": 1.14}),
    ("office_return", "Bosses Order Everyone Back to the Office", {"demandMult": 1.18}),
    ("wfh_friday", "Work-From-Home Friday Empties Midtown", {"demandMult": 0.85}),
    ("construction", "Scaffolding Goes Up Across the Street", {"demandMult": 0.82}),
    ("film_shoot", "Movie Shoot Closes Street — Crew Eats Local", {"demandMult": 1.1}),
    ("street_fair_elsewhere", "Street Fair Two Blocks Over Siphons the Lunch Crowd", {"demandMult": 0.88}),
    ("farmers_market", "New Farmers Market Draws the Lunch Crowd Away", {"demandMult": 0.9}),
    ("tech_conference", "Tech Conference Serves Free Lunch (Traitors)", {"demandMult": 0.85}),
    ("free_pizza_office", "Office Orders 200 Pizzas; Lunch Crowd Vanishes", {"demandMult": 0.82}),
    ("gridlock", "Gridlock Alert: Nobody's Going Anywhere for Lunch", {"demandMult": 0.88}),
    ("blackout", "Brief Blackout: Office Fridges Die, Everyone Eats Out", {"demandMult": 1.2, "payMult": 1.12}),
    ("water_main", "Water Main Break Floods the Other Guys' Block", {"demandMult": 1.1}),
    ("election_day", "Election Day: Poll Workers Run on Street Food", {"demandMult": 1.1}),
    ("graduation", "Graduation Season: Families Celebrate with Platters", {"demandMult": 1.12, "payMult": 1.12}),

    # ---- money mood ----
    ("payday_friday", "Payday Friday: Wallets Feel Heavy", {"payMult": 1.25, "demandMult": 1.15}),
    ("wall_st_bonus", "Wall Street Bonuses Land; Suits Splurge", {"payMult": 1.28, "demandMult": 1.12}),
    ("rent_day", "Rent Day: City Collectively Counts Pennies", {"payMult": 0.72, "demandMult": 0.9}),
    ("layoffs", "Tech Layoffs Announced; Lunch Budgets Shrink", {"payMult": 0.75, "demandMult": 0.88}),
    ("crypto_crash", "Crypto Crashes; Bros Eat Sad Desk Salads", {"payMult": 0.72, "demandMult": 0.9}),
    ("crypto_moon", "Crypto Moons; Bros Buy Rounds for the Line", {"payMult": 1.3, "demandMult": 1.1}),
    ("lottery_fever", "Mega Jackpot Fever: Everyone Feels Lucky (and Generous)", {"payMult": 1.25}),
    ("tourists_flush", "Exchange Rate Sends Tourists on a Spending Spree", {"payMult": 1.3}),
    ("grocery_prices", "Grocery Prices Up Again; Eating Out Feels Smarter", {"demandMult": 1.08}),

    # ---- health / food trends / patience ----
    ("protein_craze", "High-Protein Craze Peaks: Chicken Is King", {"demandMult": 1.18}),
    ("sauce_superfood", "'White Sauce Is a Superfood,' Claims Man, Probably", {"demandMult": 1.1}),
    ("slow_food", "Slow Food Movement: Savor the Wait", {"patienceAddMin": 3}),
    ("meditation_app", "Meditation App Update Makes Everyone Patient", {"patienceAddMin": 2}),
    ("zen_line", "Study: People in Lines Report 'Weirdly Zen' Feeling", {"patienceAddMin": 3}),
    ("spicy_challenge", "Extreme Spice Challenge Trends Online", {"demandMult": 1.12}),
    ("gym_cheat_day", "New Year Gym Crowd Discovers 'Cheat Day'", {"demandMult": 1.08}),
    ("salad_scare", "Food Scare at a Salad Chain Uptown; City Switches to Rice", {"demandMult": 1.15}),
    ("salad_chain_closed", "Salad Chain Closes 40 Stores; Refugees Seek Rice", {"demandMult": 1.12}),
    ("kale_backlash", "Kale Backlash Enters Third Year", {"demandMult": 1.05}),
    ("book_club", "Citywide Book Club Picks 900-Page Novel; Parks Fill with Readers", {"patienceAddMin": 2}),
    ("yoga_retreat", "Corporate Yoga Retreat: Meetings Cancelled, Moods Great", {"patienceAddMin": 3, "demandMult": 0.95}),

    # ---- competition ----
    ("rival_cart", "Flashy New Rival Cart Parks Across the Street", {"demandMult": 0.85}),
    ("rival_closed", "Rival Cart Closed for 'Permit Issues' 👀", {"demandMult": 1.15}),
    ("food_hall", "New Food Hall Opens — With $19 Salads", {"demandMult": 1.1}),
    ("hot_dog_feud", "Hot Dog Cart Feud Enters Day 12; Crowds Watch Free", {"demandMult": 1.08}),
    ("copycat_cart", "Copycat Cart Steals Your Color Scheme", {"demandMult": 0.92}),
    ("dollar_pizza", "Dollar Pizza Raises Price to $1.50; City Mourns, Moves On", {"demandMult": 1.12}),
    ("permit_day", "Permit Renewal Day: Half the Carts in the City Closed", {"demandMult": 1.18}),
    ("app_crash", "Food Delivery Apps Crash at Noon. Sidewalks Win.", {"demandMult": 1.22}),
    ("bee_swarm", "Bee Swarm Relocates to Tree Near Rival Cart", {"demandMult": 1.12}),

    # ---- faith / culture ----
    ("ramadan_iftar", "Ramadan: Iftar Rush Expected at Sunset", {"demandMult": 1.15}),
    ("eid_festival", "Eid Festival Fills the Park with Families", {"demandMult": 1.2, "payMult": 1.1}),
    ("halal_guide", "City Publishes Halal Certification Guide; Carts Boom", {"demandMult": 1.12, "popularityAdd": 2}),
    ("interfaith_fair", "Interfaith Food Fair Celebrates Street Vendors", {"demandMult": 1.1}),
    ("friday_prayers", "Friday Prayers Let Out Early; Hungry Congregation", {"demandMult": 1.12}),
    ("inspection_a", "Health Inspector Gives Your Cart an A — You Post It Proudly", {"popularityAdd": 3, "demandMult": 1.1}),

    # ---- pigeons & street life (flavor) ----
    ("pigeon_union", "Pigeons Unionize; Demand Crumbs, Better Scraps", {"demandMult": 1.02}),
    ("pizza_rat_jr", "Beloved Subway Rat 'Pizza Rat Jr.' Spotted Uptown", {"demandMult": 1.03}),
    ("chess_hustlers", "Chess Hustlers Declare Your Corner 'Lucky'", {"demandMult": 1.05}),
    ("busker_viral", "Saxophonist Outside Your Cart Goes Viral", {"demandMult": 1.1}),
    ("lost_tourist", "Tour Group of 40 Follows Your Umbrella, Mistakes It for a Flag", {"demandMult": 1.15}),
    ("dog_parade", "Dog Costume Parade Halts Traffic, Delights All", {"demandMult": 1.08}),
    ("subway_series", "Subway Series Tonight: Half the City Calls Out 'Sick'", {"demandMult": 1.1}),
    ("tour_bus", "Double-Decker Tour Buses Discover Your Block", {"demandMult": 1.12}),
    ("office_party", "Office Party Season: Assistants Order Platters by the Dozen", {"demandMult": 1.15}),
    ("rain_check", "Rain Check: City Makes Up for Yesterday's Lost Lunches", {"demandMult": 1.1}),
    ("sample_rival", "Free-Sample Rival Shuts Down; Your Line Absorbs the Crowd", {"demandMult": 1.08}),
    ("nothing_happened", "Nothing Happened Today. Beautiful.", {}),
]

def main():
    ids = [h[0] for h in H]
    assert len(ids) == len(set(ids)), "duplicate ids"
    print(f"deck size: {len(H)}")
    dm = [h[2].get("demandMult", 1.0) for h in H]
    pm = [h[2].get("payMult", 1.0) for h in H]
    print(f"demandMult mean={statistics.mean(dm):.3f} (target ~1.05) min={min(dm)} max={max(dm)}")
    print(f"payMult    mean={statistics.mean(pm):.3f} (target ~1.00) min={min(pm)} max={max(pm)}")
    assert 1.03 <= statistics.mean(dm) <= 1.07, "demandMult mean out of band"
    assert 0.98 <= statistics.mean(pm) <= 1.02, "payMult mean out of band"
    for hid, _text, eff in H:
        for k, v in eff.items():
            assert k in ("demandMult", "payMult", "patienceAddMin", "popularityAdd", "tempOverrideF"), (hid, k)
            if k == "demandMult": assert 0.7 <= v <= 1.3, (hid, v)
            if k == "payMult": assert 0.72 <= v <= 1.3, (hid, v)
            if k == "patienceAddMin": assert 1 <= v <= 4, (hid, v)
            if k == "popularityAdd": assert 1 <= v <= 5, (hid, v)

    deck = [{"id": hid, "text": text, "effects": eff} for hid, text, eff in H]
    for path in ("data/halal-cart.json", "web/public/data/halal-cart.json"):
        d = json.load(open(path))
        d["headlines"] = deck
        json.dump(d, open(path, "w"), indent=2, ensure_ascii=False)
        open(path, "a").write("\n")
    print("wrote both JSON copies")

if __name__ == "__main__":
    main()
