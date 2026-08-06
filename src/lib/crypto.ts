import type { EncryptedPortfolio, PortfolioSnapshot } from "../types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 250_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function deriveKey(pin: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isValidPin(pin: string) {
  return /^\d{6}$/.test(pin);
}

export async function encryptPortfolio(data: PortfolioSnapshot, pin: string): Promise<EncryptedPortfolio> {
  if (!isValidPin(pin)) throw new Error("密码必须是6位数字");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(data)));
  return {
    version: "1.0",
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString(),
  };
}

export async function decryptPortfolio(payload: EncryptedPortfolio, pin: string): Promise<PortfolioSnapshot> {
  if (!isValidPin(pin)) throw new Error("密码必须是6位数字");
  try {
    const key = await deriveKey(pin, fromBase64(payload.salt), payload.iterations);
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.iv) as BufferSource },
      key,
      fromBase64(payload.ciphertext) as BufferSource,
    );
    const data = JSON.parse(decoder.decode(clear)) as PortfolioSnapshot;
    if (data.version !== "1.0" || !Array.isArray(data.ledger)) throw new Error("备份格式不受支持");
    return data;
  } catch {
    throw new Error("密码错误或备份已损坏");
  }
}

export function downloadEncryptedBackup(payload: EncryptedPortfolio) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `008163-portfolio-${new Date().toISOString().slice(0, 10)}.encrypted.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
