import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import("../tools/xhs-research-collector/extractors.js");
const utils = globalThis.XhsResearchUtils;

test("collector canonicalizes supported Xiaohongshu note URLs", () => {
  assert.equal(
    utils.canonicalNoteUrl("https://www.xiaohongshu.com/explore/66aabb12?xsec_token=private"),
    "https://www.xiaohongshu.com/explore/66aabb12",
  );
  assert.equal(
    utils.canonicalNoteUrl("https://www.xiaohongshu.com/discovery/item/66aabb12"),
    "https://www.xiaohongshu.com/explore/66aabb12",
  );
  assert.equal(utils.canonicalNoteUrl("https://example.com/explore/66aabb12"), null);
  assert.equal(utils.canonicalNoteUrl("https://www.xiaohongshu.com/search_result?keyword=test"), null);
});

test("collector deduplicates candidates without retaining access tokens in identity", () => {
  const records = utils.dedupeCandidates([
    { url: "https://www.xiaohongshu.com/explore/123abc?xsec_token=a", title: " A   rule " },
    { url: "https://www.xiaohongshu.com/explore/123abc?xsec_token=b", title: "duplicate" },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].canonicalUrl, "https://www.xiaohongshu.com/explore/123abc");
  assert.equal(records[0].title, "A rule");
});

test("collector manifest is narrowly scoped and does not request cookie access", async () => {
  const manifest = JSON.parse(await readFile(new URL("../tools/xhs-research-collector/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.host_permissions, ["https://www.xiaohongshu.com/*"]);
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.ok(!manifest.permissions.includes("history"));
});
