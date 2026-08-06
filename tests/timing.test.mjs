import assert from "node:assert/strict";
import test from "node:test";
import { buildTimingStudy, timingMultiplier } from "../src/lib/timing.ts";

test("MA250 contribution bands are monotonic and explicit", () => {
  assert.equal(timingMultiplier(-0.06).multiplier, 2);
  assert.equal(timingMultiplier(-0.01).multiplier, 1.5);
  assert.equal(timingMultiplier(0.01).multiplier, 1);
  assert.equal(timingMultiplier(0.06).multiplier, 0.5);
  assert.equal(timingMultiplier(0.11).multiplier, 0);
});

test("timing study uses accumulated NAV and produces yearly evidence", () => {
  const start = Date.UTC(2020, 0, 1);
  const navSeries = Array.from({ length: 620 }, (_, index) => {
    const value = 1 + index * 0.001;
    return {
      time: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      value: index > 400 ? value - 0.4 : value,
      accumulated: value,
    };
  });
  const study = buildTimingStudy(navSeries);
  assert.ok(study.current > navSeries.at(-1).value);
  assert.ok(study.ma250 > 0);
  assert.equal(study.bands.length, 5);
  assert.ok(study.annualBelow.length >= 2);
  assert.ok(Number.isFinite(study.percentile));
  assert.ok(Number.isFinite(study.weeklyRsiAudit.strategyAnnualized));
  assert.ok(Number.isFinite(study.weeklyRsiAudit.benchmarkAnnualized));
  assert.ok(study.weeklyRsiAudit.weeks > 80);
});
