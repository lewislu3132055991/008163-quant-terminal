import assert from "node:assert/strict";
import test from "node:test";
import { decryptPortfolio, encryptPortfolio, isValidPin } from "../src/lib/crypto.ts";

const snapshot = {
  version: "1.0", updatedAt: "2026-08-05T10:00:00+08:00", marketValue: 52_000, cash: 28_000,
  fundShares: 48_888.88, averageCost: 1.0636, peakValue: 55_000, ledger: [],
};

test("PIN requires exactly six digits", () => {
  assert.equal(isValidPin("123456"), true);
  assert.equal(isValidPin("12345"), false);
  assert.equal(isValidPin("abcdef"), false);
});

test("portfolio round-trips through PBKDF2 and AES-GCM without plaintext", async () => {
  const encrypted = await encryptPortfolio(snapshot, "816381");
  assert.equal(encrypted.algorithm, "AES-GCM");
  assert.equal(encrypted.kdf, "PBKDF2-SHA256");
  assert.ok(encrypted.iterations >= 250_000);
  assert.equal(JSON.stringify(encrypted).includes("48888.88"), false);
  assert.deepEqual(await decryptPortfolio(encrypted, "816381"), snapshot);
});

test("wrong password and corrupted backup fail closed", async () => {
  const encrypted = await encryptPortfolio(snapshot, "816381");
  await assert.rejects(() => decryptPortfolio(encrypted, "000000"), /密码错误或备份已损坏/);
  const corrupted = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + "AAAA" };
  await assert.rejects(() => decryptPortfolio(corrupted, "816381"), /密码错误或备份已损坏/);
});
