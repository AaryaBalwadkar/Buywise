// BuyWise password handling: scrypt (RFC 7914, Node built-in — no new
// dependency) with per-user salt and timing-safe comparison. Plaintext
// passwords are never stored; hashes never leave the server (no API returns
// them). Canonical lib shared by server.js, create-admin, and tests.
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(_scrypt);
const N = 16384, r = 8, p = 1, KEYLEN = 32, SALTLEN = 16;

export function validateUsername(u) {
  if (typeof u !== "string") return { ok: false, reason: "username must be a string" };
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(u)) return { ok: false, reason: "username 3-40 chars: letters, digits, . _ -" };
  return { ok: true };
}
export function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length < 8) return { ok: false, reason: "password minimum 8 characters" };
  if (pw.length > 200) return { ok: false, reason: "password too long" };
  return { ok: true };
}
export const ROLES = ["admin", "requester", "officer", "approver", "auditor"];
export function validateRole(role) {
  return ROLES.includes(role) ? { ok: true } : { ok: false, reason: "role must be one of " + ROLES.join(", ") };
}

export async function hashPassword(pw) {
  const v = validatePassword(pw);
  if (!v.ok) throw new Error(v.reason);
  const salt = randomBytes(SALTLEN);
  const hash = await scryptAsync(pw, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(pw, stored) {
  try {
    if (typeof pw !== "string" || typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");
    const hash = await scryptAsync(pw, salt, expected.length, { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) });
    return hash.length === expected.length && timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}
