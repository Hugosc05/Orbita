import crypto from "node:crypto";
import { config } from "../config.js";

const key = crypto.createHash("sha256").update(String(config.encryptionKey)).digest();

export function seal(plain) {
  if (plain === null || plain === undefined || plain === "") return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1." + iv.toString("base64url") + "." + tag.toString("base64url") + "." + enc.toString("base64url");
}

export function open(blob) {
  if (!blob) return "";
  const parts = String(blob).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return "";
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch (err) {
    return "";
  }
}

export const uid = () => crypto.randomBytes(9).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || crypto.randomUUID().slice(0, 12);
export const randomState = () => crypto.randomBytes(24).toString("base64url");
