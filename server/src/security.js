import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config, PUBLIC_DIR } from "./config.js";

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_STRING = 4000000;
const MAX_ARRAY = 5000;
const MAX_DEPTH = 8;

let hashCache = { at: 0, value: "'self'" };

export function inlineScriptHashes() {
  const file = path.join(PUBLIC_DIR, "index.html");
  let stamp = 0;
  try {
    stamp = fs.statSync(file).mtimeMs;
  } catch (err) {
    return hashCache.value;
  }
  if (stamp === hashCache.at) return hashCache.value;
  const hashes = [];
  try {
    const html = fs.readFileSync(file, "utf8");
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match = re.exec(html);
    while (match) {
      const digest = crypto.createHash("sha256").update(match[1], "utf8").digest("base64");
      hashes.push("'sha256-" + digest + "'");
      match = re.exec(html);
    }
  } catch (err) {
    return hashCache.value;
  }
  hashCache = { at: stamp, value: ["'self'"].concat(hashes).join(" ") };
  return hashCache.value;
}

export function buildHelmet() {
  const connect = ["'self'"].concat(config.allowedOrigins);
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "script-src": [() => inlineScriptHashes()],
        "script-src-attr": ["'none'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "media-src": ["'self'", "data:"],
        "connect-src": connect,
        "worker-src": ["'self'"],
        "manifest-src": ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false
  });
}

export const apiLimiter = rateLimit({
  windowMs: 60000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "demasiadas_peticiones" }
});

export const makeAuthLimiter = () => rateLimit({
  windowMs: 900000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "demasiados_intentos" }
});

export const heavyLimiter = rateLimit({
  windowMs: 300000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "demasiadas_sincronizaciones" }
});

const CONTROL = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]", "g");

function cleanString(value) {
  let out = String(value).replace(CONTROL, "");
  if (out.length > MAX_STRING) out = out.slice(0, MAX_STRING);
  return out;
}

function cleanValue(value, depth) {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return null;
  const type = typeof value;
  if (type === "string") return cleanString(value);
  if (type === "number") return Number.isFinite(value) ? value : 0;
  if (type === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map(v => cleanValue(v, depth + 1));
  if (type === "object") {
    const out = {};
    Object.keys(value).forEach(key => {
      if (BLOCKED_KEYS.has(key)) return;
      const safeKey = cleanString(key).slice(0, 120);
      if (!safeKey) return;
      out[safeKey] = cleanValue(value[key], depth + 1);
    });
    return out;
  }
  return null;
}

export function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === "object") req.body = cleanValue(req.body, 0);
  if (req.query && typeof req.query === "object") {
    const clean = cleanValue(req.query, 0);
    Object.keys(req.query).forEach(k => {
      delete req.query[k];
    });
    Object.assign(req.query, clean);
  }
  if (req.params && typeof req.params === "object") {
    Object.keys(req.params).forEach(k => {
      req.params[k] = typeof req.params[k] === "string" ? cleanString(req.params[k]).slice(0, 200) : req.params[k];
    });
  }
  next();
}

export const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function requireId(param) {
  return (req, res, next) => {
    if (!ID_RE.test(String(req.params[param] || ""))) {
      res.status(400).json({ error: "id_invalido" });
      return;
    }
    next();
  };
}

export function corsGuard(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Orbita-App");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(origin && !config.allowedOrigins.includes(origin) ? 403 : 204);
    return;
  }
  next();
}

export function csrfGuard(req, res, next) {
  const safe = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  if (safe) {
    next();
    return;
  }
  const viaCookie = !req.headers.authorization && !!(req.cookies && req.cookies[config.cookieName]);
  if (viaCookie && req.headers["x-orbita-app"] !== "1") {
    res.status(403).json({ error: "peticion_no_permitida" });
    return;
  }
  next();
}
