import { db, nowMs } from "../db.js";
import { uid } from "../util/crypto.js";
import { daysApart, normalize } from "../util/dates.js";

const parse = (raw, fallback) => {
  try {
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch (err) {
    return fallback;
  }
};

export function toClientItem(row) {
  return {
    id: row.id,
    title: row.title || "",
    cat: row.cat || null,
    date: row.date || null,
    time: row.time || "",
    dur: Number(row.dur) || 0,
    notes: row.notes || "",
    done: !!row.done,
    subs: parse(row.subs, []),
    rep: parse(row.rep, { freq: "none", days: [], until: null }),
    doneDates: parse(row.done_dates, []),
    skips: parse(row.skips, []),
    source: row.source || "",
    extId: row.ext_id || "",
    kind: row.kind === "event" ? "event" : "task",
    created: Number(row.created) || nowMs()
  };
}

export function toRowValues(userId, item, trashed, trashedAt) {
  const at = nowMs();
  return [
    item.id || uid(),
    userId,
    String(item.title || "").slice(0, 400),
    item.cat || null,
    item.date || null,
    item.time || "",
    Number(item.dur) || 0,
    String(item.notes || "").slice(0, 4000),
    item.done ? 1 : 0,
    JSON.stringify(Array.isArray(item.subs) ? item.subs : []),
    JSON.stringify(item.rep && item.rep.freq ? item.rep : { freq: "none", days: [], until: null }),
    JSON.stringify(Array.isArray(item.doneDates) ? item.doneDates : []),
    JSON.stringify(Array.isArray(item.skips) ? item.skips : []),
    item.source || "",
    item.extId || "",
    item.kind === "event" ? "event" : "task",
    Number(item.created) || at,
    at,
    trashed ? 1 : 0,
    trashed ? Number(trashedAt) || at : null
  ];
}

const INSERT_SQL = `INSERT INTO items
  (id, user_id, title, cat, date, time, dur, notes, done, subs, rep, done_dates, skips, source, ext_id, kind, created, updated, trashed, trashed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title, cat = excluded.cat, date = excluded.date, time = excluded.time,
    dur = excluded.dur, notes = excluded.notes, done = excluded.done, subs = excluded.subs,
    rep = excluded.rep, done_dates = excluded.done_dates, skips = excluded.skips,
    source = excluded.source, ext_id = excluded.ext_id, kind = excluded.kind, updated = excluded.updated,
    trashed = excluded.trashed, trashed_at = excluded.trashed_at`;

export function getState(userId) {
  const rows = db.prepare("SELECT * FROM items WHERE user_id = ? ORDER BY created ASC").all(userId);
  const cats = db.prepare("SELECT id, name, color, shape FROM categories WHERE user_id = ? ORDER BY pos ASC, rowid ASC").all(userId);
  const pref = db.prepare("SELECT json, bg, view, tour FROM prefs WHERE user_id = ?").get(userId) || {};
  return {
    items: rows.filter(r => !r.trashed).map(toClientItem),
    trash: rows.filter(r => r.trashed).map(toClientItem),
    cats: cats.map(c => ({ id: c.id, name: c.name, color: c.color, shape: c.shape })),
    view: pref.view || "month",
    prefs: parse(pref.json, {}),
    bg: pref.bg || "",
    tour: !!pref.tour
  };
}

export const putState = db.transaction((userId, payload) => {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const trash = Array.isArray(payload.trash) ? payload.trash : [];
  const cats = Array.isArray(payload.cats) ? payload.cats : [];
  const keepItems = new Set();
  const insert = db.prepare(INSERT_SQL);
  items.forEach(it => {
    const values = toRowValues(userId, it, false, null);
    keepItems.add(values[0]);
    insert.run(values);
  });
  trash.forEach(it => {
    const values = toRowValues(userId, it, true, it.deletedAt);
    keepItems.add(values[0]);
    insert.run(values);
  });
  const existing = db.prepare("SELECT id FROM items WHERE user_id = ?").all(userId);
  const drop = db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?");
  existing.forEach(row => {
    if (!keepItems.has(row.id)) drop.run(row.id, userId);
  });

  const keepCats = new Set();
  const upsertCat = db.prepare(`INSERT INTO categories (id, user_id, name, color, shape, pos)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, shape = excluded.shape, pos = excluded.pos`);
  cats.forEach((c, i) => {
    const id = c.id || uid();
    keepCats.add(id);
    upsertCat.run(id, userId, String(c.name || "").slice(0, 60), c.color || "", c.shape || "circle", i);
  });
  const dropCat = db.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?");
  db.prepare("SELECT id FROM categories WHERE user_id = ?").all(userId).forEach(row => {
    if (!keepCats.has(row.id)) dropCat.run(row.id, userId);
  });

  if (payload.view) db.prepare("UPDATE prefs SET view = ? WHERE user_id = ?").run(payload.view, userId);
  return getState(userId);
});

export function savePrefs(userId, prefs, bg, tour) {
  const current = db.prepare("SELECT json, bg, tour FROM prefs WHERE user_id = ?").get(userId) || {};
  const json = prefs === undefined ? current.json || "{}" : JSON.stringify(prefs || {});
  const image = bg === undefined ? current.bg || "" : String(bg || "");
  const seen = tour === undefined ? current.tour || 0 : tour ? 1 : 0;
  db.prepare("INSERT INTO prefs (user_id, json, bg, tour) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, bg = excluded.bg, tour = excluded.tour")
    .run(userId, json, image, seen);
}

export function listItems(userId, opts = {}) {
  const rows = db.prepare("SELECT * FROM items WHERE user_id = ? AND trashed = 0 ORDER BY date IS NULL, date ASC, time ASC").all(userId);
  if (!opts.source) return rows.map(toClientItem);
  return rows.filter(r => r.source === opts.source).map(toClientItem);
}

export function insertItem(userId, item) {
  const values = toRowValues(userId, Object.assign({ id: uid() }, item), false, null);
  db.prepare(INSERT_SQL).run(values);
  return toClientItem(db.prepare("SELECT * FROM items WHERE id = ?").get(values[0]));
}

export function updateItem(userId, id, patch) {
  const row = db.prepare("SELECT * FROM items WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) return null;
  const merged = Object.assign(toClientItem(row), patch, { id: row.id });
  const values = toRowValues(userId, merged, row.trashed, row.trashed_at);
  db.prepare(INSERT_SQL).run(values);
  return toClientItem(db.prepare("SELECT * FROM items WHERE id = ?").get(id));
}

export function removeItem(userId, id) {
  const row = db.prepare("SELECT * FROM items WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) return false;
  db.prepare("UPDATE items SET trashed = 1, trashed_at = ?, updated = ? WHERE id = ?").run(nowMs(), nowMs(), id);
  return true;
}

export function categoryByName(userId, name) {
  const target = normalize(name);
  const rows = db.prepare("SELECT id, name FROM categories WHERE user_id = ?").all(userId);
  const hit = rows.find(r => normalize(r.name) === target);
  return hit ? hit.id : null;
}

export function ensureCategory(userId, name, color, shape) {
  const found = categoryByName(userId, name);
  if (found) return found;
  const id = uid();
  const pos = db.prepare("SELECT COUNT(*) AS n FROM categories WHERE user_id = ?").get(userId).n;
  db.prepare("INSERT INTO categories (id, user_id, name, color, shape, pos) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, userId, name, color || "#6c5ce7", shape || "square", pos);
  return id;
}

export function findSimilar(userId, title, date) {
  const target = normalize(title);
  if (!target) return null;
  const rows = db.prepare("SELECT * FROM items WHERE user_id = ? AND trashed = 0 AND date IS NOT NULL").all(userId);
  let best = null;
  let bestScore = 0;
  rows.forEach(row => {
    const candidate = normalize(row.title);
    if (!candidate) return;
    const contains = candidate === target || candidate.includes(target) || target.includes(candidate);
    if (!contains) return;
    const near = daysApart(row.date, date);
    if (near > 21) return;
    const score = (candidate === target ? 2 : 1) + (21 - near) / 21;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  });
  return best;
}
