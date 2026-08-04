import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_SESSION_COOKIE = "coral-console-session";

const SESSION_VERSION = "v1";
const SESSION_PURPOSE = "coralconsole-access-session-v1";

export function configuredAccessKeyHash() {
  const value = process.env.CORAL_ACCESS_KEY_HASH?.trim().toLowerCase() || "";
  if (!value) return null;
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("CORAL_ACCESS_KEY_HASH must be empty or a 64-character hexadecimal SHA-256 hash.");
  }
  return value;
}

export function accessControlEnabled() {
  return configuredAccessKeyHash() !== null;
}

export function hashAccessKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function accessKeyMatches(value: string) {
  const configuredHash = configuredAccessKeyHash();
  if (!configuredHash) return false;
  const expected = Buffer.from(configuredHash, "hex");
  const actual = hashAccessKey(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionSignature(configuredHash: string) {
  return createHmac("sha256", Buffer.from(configuredHash, "hex"))
    .update(SESSION_PURPOSE, "utf8")
    .digest();
}

export function createAccessSessionCookie() {
  const configuredHash = configuredAccessKeyHash();
  if (!configuredHash) throw new Error("Access key protection is not enabled.");
  return `${SESSION_VERSION}.${sessionSignature(configuredHash).toString("base64url")}`;
}

export function validAccessSession(value: string | null | undefined) {
  const configuredHash = configuredAccessKeyHash();
  if (!configuredHash) return true;
  if (!value) return false;

  const [version, encodedSignature, extra] = value.split(".");
  if (
    version !== SESSION_VERSION
    || !/^[A-Za-z0-9_-]{43}$/.test(encodedSignature || "")
    || extra !== undefined
  ) return false;

  let actual: Buffer;
  try {
    actual = Buffer.from(encodedSignature, "base64url");
  } catch {
    return false;
  }
  const expected = sessionSignature(configuredHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function accessCookieIsSecure(request: Request) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProtocol === "https" || new URL(request.url).protocol === "https:") return true;
  try {
    return new URL(request.headers.get("origin") || "").protocol === "https:";
  } catch {
    return false;
  }
}
