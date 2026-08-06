import assert from "node:assert/strict";
import test from "node:test";
import { buildSwingExecution } from "../src/lib/execution.ts";

const base = {
  status: "final",
  ma5AboveMa20: true,
  rsi14: 55,
  premiumRate: 0.05,
  ma250Deviation: 0,
  trendScore: 55,
  breadthScore: 50,
  trackingScore: 50,
  negativeStructuralEvent: false,
};

test("swing score tiers map to transparent five-percent units", () => {
  assert.equal(buildSwingExecution({ ...base, score: 80 }).units, 3);
  assert.equal(buildSwingExecution({ ...base, score: 68 }).units, 2);
  assert.equal(buildSwingExecution({ ...base, score: 60 }).units, 1);
  assert.equal(buildSwingExecution({ ...base, score: 49 }).units, 0);
  assert.equal(buildSwingExecution({ ...base, score: 30, ma5AboveMa20: false }).units, 2);
});

test("execution confirmation can reduce but not reverse a swing signal", () => {
  const weakShortTrend = buildSwingExecution({ ...base, score: 68, ma5AboveMa20: false });
  assert.equal(weakShortTrend.direction, "buy");
  assert.equal(weakShortTrend.units, 1);
  const oversoldSell = buildSwingExecution({ ...base, score: 30, ma5AboveMa20: false, rsi14: 25 });
  assert.equal(oversoldSell.direction, "sell");
  assert.equal(oversoldSell.units, 1);
});

test("blocked data and abnormal premiums prohibit execution", () => {
  const waiting = buildSwingExecution({ ...base, score: 80, status: "preliminary" });
  assert.equal(waiting.direction, "hold");
  assert.equal(waiting.signalDirection, "buy");
  assert.equal(waiting.signalUnits, 3);
  assert.equal(waiting.signalTotalPercent, 15);
  assert.match(waiting.signalTitle, /模型预备：买入3个单位/);
  assert.equal(buildSwingExecution({ ...base, score: 80, status: "blocked" }).direction, "hold");
  assert.equal(buildSwingExecution({ ...base, score: 80, premiumRate: 0.31 }).direction, "hold");
});

test("unlocked capital converts units to amount and respects swing capacity", () => {
  const plan = buildSwingExecution({ ...base, score: 80, totalCapital: 100_000, currentFundValue: 95_000 });
  assert.equal(plan.units, 1);
  assert.equal(plan.amount, 5_000);
  assert.equal(plan.totalPercent, 5);
});

test("core and reserve funds require multiple exceptional conditions", () => {
  const ordinary = buildSwingExecution({ ...base, score: 20, ma5AboveMa20: false });
  assert.match(ordinary.coreAction, /保持不动/);
  const structural = buildSwingExecution({
    ...base,
    score: 20,
    ma5AboveMa20: false,
    trendScore: 20,
    breadthScore: 20,
    trackingScore: 20,
    negativeStructuralEvent: true,
  });
  assert.match(structural.coreAction, /建议额外卖出1个底仓单位/);
  assert.equal(structural.specialUnits, 1);
  assert.equal(structural.totalUnits, 4);
  assert.equal(structural.totalPercent, 20);
  const reversal = buildSwingExecution({ ...base, score: 80, ma250Deviation: -0.08 });
  assert.match(reversal.reserveAction, /建议额外投入1个备用资金单位/);
  assert.equal(reversal.specialUnits, 1);
  assert.equal(reversal.totalUnits, 4);
});
