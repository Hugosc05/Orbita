import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, nowMs } from "./db.js";
import { config } from "./config.js";
import { uid } from "./util/crypto.js";

const DEFAULT_CATS = [
  { name: "Uni", color: "#6c5ce7", shape: "square" },
  { name: "Gym", color: "#12bfa0", shape: "circle" },
  { name: "Trabajo", color: "#2f9fff", shape: "pill" },
  { name: "Proyectos", color: "#f79320", shape: "diamond" }
];

export function listProfiles() {
  return db.prepare("SELECT id, name, av, color, pin_hash FROM users ORDER BY created ASC").all().map(u => ({
    id: u.id,
    name: u.name,
    av: u.av || "🪐",
    color: u.color || "#6c5ce7",
    pin: !!u.pin_hash
  }));
}

export function findUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

export function publicUser(row) {
  if (!row) return null;
  const pref = db.prepare("SELECT json, view, tour FROM prefs WHERE user_id = ?").get(row.id);
  let parsed = {};
  try {
    parsed = JSON.parse(pref && pref.json ? pref.json : "{}");
  } catch (err) {
    parsed = {};
  }
  return {
    id: row.id,
    name: row.name,
    av: row.av || "🪐",
    color: row.color || "#6c5ce7",
    pin: !!row.pin_hash,
    tour: !!(pref && pref.tour),
    prefs: parsed
  };
}

export function createUser({ name, pin, av, color, prefs }) {
  const id = uid();
  const clean = String(name || "").trim().slice(0, 40) || "Yo";
  const hash = pin ? bcrypt.hashSync(String(pin), 10) : null;
  const at = nowMs();
  db.transaction(() => {
    db.prepare("INSERT INTO users (id, name, av, color, pin_hash, created) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, clean, av || "🪐", color || "#6c5ce7", hash, at);
    db.prepare("INSERT INTO prefs (user_id, json, view, tour) VALUES (?, ?, 'month', 0)")
      .run(id, JSON.stringify(prefs || {}));
    const insert = db.prepare("INSERT INTO categories (id, user_id, name, color, shape, pos) VALUES (?, ?, ?, ?, ?, ?)");
    DEFAULT_CATS.forEach((c, i) => insert.run(uid(), id, c.name, c.color, c.shape, i));
  })();
  return publicUser(findUser(id));
}

export function verifyPin(row, pin) {
  if (!row.pin_hash) return true;
  if (!pin) return false;
  return bcrypt.compareSync(String(pin), row.pin_hash);
}

export function setPin(userId, pin) {
  const hash = pin ? bcrypt.hashSync(String(pin), 10) : null;
  db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(hash, userId);
}

export function issueToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "60d" });
}

export function setSession(res, userId) {
  const token = issueToken(userId);
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    maxAge: 60 * 24 * 3600 * 1000,
    path: "/"
  });
  return token;
}

export function clearSession(res) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/"
  });
}

export function readToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret).sub;
  } catch (err) {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const cookie = req.cookies ? req.cookies[config.cookieName] : "";
  const token = cookie || bearer || String(req.query.token || "");
  const id = token ? readToken(token) : null;
  const row = id ? findUser(id) : null;
  if (!row) {
    res.status(401).json({ error: "no_autenticado" });
    return;
  }
  req.user = row;
  next();
}

export function deleteUser(userId) {
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}
