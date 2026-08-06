import assert from "node:assert/strict";
import test from "node:test";
import { createSampleBundle } from "../src/data/sample.ts";
import { applyDecisionWindow, assessData, buildRecommendation, calculateFactors, getDecisionWindow, maxDrawdown, rsi, sma } from "../src/lib/strategy.ts";

function portfolio(marketValue, cash) {
  return { version: "1.0", updatedAt: new Date().toISOString(), marketValue, cash, fundShares: 0, averageCost: 1, peakValue: marketValue, ledger: [] };
}

function liveBundle() {
  const bundle = structuredClone(createSampleBundle());
  bundle.mode = "live";
  const now = new Date().toISOString();
  bundle.daily[bundle.daily.length - 1].time = now.slice(0, 10);
  for (const item of [bundle.quote, bundle.backupQuote, bundle.iopv, bundle.premiumRate, ...Object.values(bundle.metrics)]) {
    item.asOf = now;
    item.quality = "verified";
  }
  return bundle;
}

test("technical helpers are deterministic", () => {
  assert.equal(sma([1, 2, 3, 4], 3), 3);
  assert.equal(rsi([1, 2, 3, 4, 5]), 100);
  assert.equal(maxDrawdown([100, 120, 90, 110]), -0.25);
});

test("target position preserves the fifty-percent core and swing-unit limits", () => {
  const recommendation = buildRecommendation(liveBundle(), portfolio(0, 100_000));
  assert.ok(recommendation.targetPosition >= 50 && recommendation.targetPosition <= 100);
  assert.equal(recommendation.targetPosition % 5, 0);
  assert.ok(Math.abs(recommendation.suggestedPositionChange) <= 15);
});

test("ordinary sell advice cannot redeem the fifty-percent core", () => {
  const bundle = liveBundle();
  for (const bar of bundle.daily) bar.close = Math.max(0.1, 3 - bundle.daily.indexOf(bar) * 0.01);
  const recommendation = buildRecommendation(bundle, portfolio(50_000, 50_000));
  assert.ok(recommendation.suggestedPositionChange >= 0);
  assert.notEqual(recommendation.action, "redeem");
  assert.equal(recommendation.suggestedAmount, undefined);
});

test("anonymous advice keeps the same five-percent swing-unit rhythm", () => {
  const bundle = liveBundle();
  const recommendation = buildRecommendation(bundle);
  assert.equal(recommendation.suggestedPositionChange % 5, 0);
  assert.ok(Math.abs(recommendation.suggestedPositionChange) <= 15);
  assert.match(recommendation.title, /50\/50策略/);
});

test("quote conflict over 0.3 percent blocks amount advice", () => {
  const bundle = liveBundle();
  bundle.backupQuote.value = bundle.quote.value * 1.004;
  const recommendation = buildRecommendation(bundle, portfolio(20_000, 80_000));
  assert.equal(recommendation.status, "blocked");
  assert.equal(recommendation.suggestedAmount, undefined);
  assert.ok(recommendation.warnings.some((warning) => warning.includes("0.3%")));
});

test("stale quote during trading blocks final advice", () => {
  const bundle = liveBundle();
  bundle.quote.asOf = "2026-08-03T15:00:00+08:00";
  const recommendation = buildRecommendation(bundle, portfolio(50_000, 50_000), new Date("2026-08-04T10:00:00+08:00"));
  assert.equal(recommendation.status, "blocked");
  assert.equal(recommendation.suggestedAmount, undefined);
});

test("daily bars older than ten days block final advice", () => {
  const bundle = liveBundle();
  bundle.daily[bundle.daily.length - 1].time = "2026-07-01";
  const recommendation = buildRecommendation(bundle, portfolio(50_000, 50_000), new Date("2026-08-04T14:50:00+08:00"));
  assert.equal(recommendation.status, "blocked");
  assert.equal(recommendation.suggestedAmount, undefined);
  assert.ok(recommendation.warnings.some((warning) => warning.includes("日K")));
});

test("non-point-in-time-safe information remains a shadow factor", () => {
  const first = liveBundle();
  first.metrics.pe.pointInTimeSafe = false;
  first.metrics.dividendYield.pointInTimeSafe = false;
  first.metrics.tenYearYield.pointInTimeSafe = false;
  const second = structuredClone(first);
  first.metrics.pe.value = 4;
  second.metrics.pe.value = 80;
  const a = calculateFactors(first).find((item) => item.id === "valuation");
  const b = calculateFactors(second).find((item) => item.id === "valuation");
  assert.equal(a.score, 50);
  assert.equal(a.score, b.score);
});

test("complete fresh live bundle can finalize", () => {
  const bundle = liveBundle();
  const health = assessData(bundle, new Date());
  assert.equal(health.conflict, false);
  assert.equal(health.stale, false);
  assert.equal(health.completeness, 100);
  assert.equal(health.canFinalize, true);
});

test("data coverage exposes all sixteen decision inputs", () => {
  const bundle = liveBundle();
  bundle.metrics.shareChange20d.quality = "unavailable";
  const health = assessData(bundle, new Date());
  assert.equal(health.total, 16);
  assert.equal(health.available, 15);
  assert.equal(health.completeness, 94);
  assert.equal(health.coverage.find((item) => item.id === "shareChange20d")?.available, false);
});

test("stale valuation data cannot influence the model", () => {
  const first = liveBundle();
  first.metrics.pe.quality = "stale";
  first.metrics.pe.value = 4;
  const second = structuredClone(first);
  second.metrics.pe.value = 80;
  const a = calculateFactors(first).find((item) => item.id === "valuation");
  const b = calculateFactors(second).find((item) => item.id === "valuation");
  assert.equal(a.score, 50);
  assert.equal(a.score, b.score);
});

test("decision window updates for ten minutes and freezes at 14:55 Shanghai time", () => {
  assert.equal(getDecisionWindow(new Date("2026-08-05T06:44:00Z")).phase, "preliminary");
  assert.equal(getDecisionWindow(new Date("2026-08-05T06:45:00Z")).phase, "updating");
  assert.equal(getDecisionWindow(new Date("2026-08-05T06:55:00Z")).phase, "frozen");
});

test("preliminary window strips amount advice while frozen recommendation remains stable", () => {
  const base = buildRecommendation(liveBundle(), portfolio(20_000, 80_000));
  const preliminary = applyDecisionWindow(base, getDecisionWindow(new Date("2026-08-05T06:30:00Z")));
  assert.equal(preliminary.status, "preliminary");
  assert.equal(preliminary.suggestedAmount, undefined);
  const frozen = { ...base, status: "frozen", score: 61 };
  const resolved = applyDecisionWindow(base, getDecisionWindow(new Date("2026-08-05T07:00:00Z")), frozen);
  assert.equal(resolved.score, 61);
  assert.equal(resolved.status, "frozen");
});
