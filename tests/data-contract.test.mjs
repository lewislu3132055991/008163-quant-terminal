import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { communityResearch, productPatterns } from "../src/data/community.ts";

const root = new URL("../", import.meta.url);

test("published research bundle is versioned and traceable", async () => {
  const bundle = JSON.parse(await readFile(new URL("public/data/research-bundle.json", root), "utf8"));
  assert.equal(bundle.version, "1.0");
  assert.ok(bundle.daily.length >= 504);
  assert.ok(bundle.intraday.length >= 24);
  assert.ok(bundle.navSeries.length >= 756);
  assert.equal(bundle.fundProfile.code, "008163");
  assert.equal(bundle.fundProfile.targetEtf, "515450");
  assert.ok(bundle.fundProfile.targetEtfMinRatio >= 90);
  assert.ok(bundle.fundProfile.latestNav.value > 0);
  for (const field of ["returnPassed", "defensePassed", "returnRetention", "drawdownImprovement", "benchmarkMaxDrawdown"]) assert.ok(field in bundle.backtest, field);
  for (const datum of [bundle.quote, bundle.backupQuote, bundle.iopv, bundle.premiumRate, ...Object.values(bundle.metrics)]) {
    for (const field of ["source", "asOf", "retrievedAt", "frequency", "quality", "pointInTimeSafe"]) assert.ok(field in datum, field);
  }
  assert.ok(Math.abs(bundle.quote.value / bundle.backupQuote.value - 1) <= 0.003);
});

test("collector schedule matches the four Beijing-time windows", async () => {
  const workflow = await readFile(new URL(".github/workflows/collect-data.yml", root), "utf8");
  for (const cron of ["17 0 * * 1-5", "37 6 * * 1-5", "23 7 * * 1-5", "17 13 * * 1-5"]) assert.match(workflow, new RegExp(cron.replaceAll("*", "\\*")));
});

test("community rules are versioned and cannot enter the model on anecdotes alone", () => {
  assert.match(communityResearch.version, /^\d+\.\d+$/);
  assert.ok(communityResearch.titleScreened >= communityResearch.deepRead);
  assert.ok(communityResearch.queries.length >= 4);
  assert.equal(new Set(communityResearch.rules.map((rule) => rule.id)).size, communityResearch.rules.length);
  for (const rule of communityResearch.rules) {
    assert.ok(["adopted", "shadow", "rejected"].includes(rule.stage));
    assert.ok(rule.validation.length >= 20);
    assert.ok(rule.nextStep.length >= 10);
    if (rule.stage === "adopted") assert.doesNotMatch(rule.validation, /点赞|收藏|收益截图/);
  }
});

test("product benchmark decisions remain traceable", () => {
  assert.ok(productPatterns.length >= 4);
  assert.equal(new Set(productPatterns.map((item) => item.id)).size, productPatterns.length);
  for (const item of productPatterns) {
    assert.ok(["adopted", "adapted", "rejected"].includes(item.decision));
    assert.match(item.sourceUrl, /^https:\/\//);
    assert.ok(item.finding.length >= 20);
  }
});
