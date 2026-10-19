import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTuningLink, decodeTuning, encodeTuning, parseUrlParams, setOverridePath } from "../src/tuning-url.js";
import { TUNING, mergeTuning } from "../src/tuning.js";

describe("tuning URL round-trip", () => {
  it("encode -> decode is identity, incl. unicode", () => {
    const over = { pricing: { elasticity: 1.9 }, note: "héllo wörld 🌶️" };
    assert.deepEqual(decodeTuning(encodeTuning(over)), over);
  });

  it("decodeTuning returns null on garbage", () => {
    assert.equal(decodeTuning("!!!not-base64!!!"), null);
    assert.equal(decodeTuning(""), null);
  });

  it("parseUrlParams extracts tuning + seed, merges cleanly", () => {
    const over = { day: { openHour: 9 } };
    const search = `?tuning=${encodeTuning(over)}&seed=42`;
    const { tuning, seed } = parseUrlParams(search);
    assert.equal(seed, 42);
    const merged = mergeTuning(TUNING, tuning);
    assert.equal(merged.day.openHour, 9);
    assert.equal(merged.day.closeHour, TUNING.day.closeHour); // untouched
  });

  it("buildTuningLink round-trips through parseUrlParams", () => {
    const over = { popularity: { dailyGrowth: 9.9 } };
    const link = buildTuningLink("https://example.com/play", over, 7);
    const { tuning, seed } = parseUrlParams(new URL(link).search);
    assert.equal(seed, 7);
    assert.deepEqual(tuning, over);
  });

  it("parseUrlParams tolerates missing params", () => {
    const { tuning, seed } = parseUrlParams("");
    assert.equal(tuning, null);
    assert.equal(seed, null);
  });

  it("setOverridePath builds sparse overrides from {}", () => {
    let over: Record<string, unknown> = {};
    over = setOverridePath(TUNING, over, "day.openHour", 9);
    over = setOverridePath(TUNING, over, "weather.conditions.0.demand_mult", 2);
    const conds = TUNING.weather.conditions.map((c, i) =>
      i === 0 ? { ...c, demand_mult: 2 } : c,
    );
    assert.deepEqual(over, { day: { openHour: 9 }, weather: { conditions: conds } });
    // and it merges cleanly back over defaults
    const merged = mergeTuning(TUNING, over);
    assert.equal(merged.day.openHour, 9);
    assert.equal(merged.day.closeHour, TUNING.day.closeHour);
    assert.equal(merged.weather.conditions[0].demand_mult, 2);
    assert.equal(merged.weather.conditions[1].demand_mult, TUNING.weather.conditions[1].demand_mult);
    assert.ok(Array.isArray(merged.weather.conditions)); // arrays stay arrays
  });
});
