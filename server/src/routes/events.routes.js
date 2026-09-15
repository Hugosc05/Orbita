import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { ensureCategory, insertItem, listItems, removeItem, toClientItem, updateItem } from "../services/items.service.js";
import { push } from "../util/sse.js";

export const eventsRouter = Router();

eventsRouter.use(requireAuth);

eventsRouter.get("/", (req, res) => {
  res.json({ items: listItems(req.user.id, { source: req.query.source }) });
});

eventsRouter.post("/", (req, res) => {
  const body = req.body || {};
  if (!String(body.title || "").trim()) {
    res.status(400).json({ error: "titulo_requerido" });
    return;
  }
  const item = insertItem(req.user.id, body);
  push(req.user.id, "state", { motivo: "evento_creado" });
  res.json({ item });
});

eventsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM items WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) {
    res.status(404).json({ error: "no_encontrado" });
    return;
  }
  res.json({ item: toClientItem(row) });
});

eventsRouter.patch("/:id", (req, res) => {
  const item = updateItem(req.user.id, req.params.id, req.body || {});
  if (!item) {
    res.status(404).json({ error: "no_encontrado" });
    return;
  }
  push(req.user.id, "state", { motivo: "evento_actualizado" });
  res.json({ item });
});

eventsRouter.delete("/:id", (req, res) => {
  const ok = removeItem(req.user.id, req.params.id);
  if (!ok) {
    res.status(404).json({ error: "no_encontrado" });
    return;
  }
  push(req.user.id, "state", { motivo: "evento_eliminado" });
  res.json({ ok: true });
});

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get("/", (req, res) => {
  res.json({ cats: db.prepare("SELECT id, name, color, shape FROM categories WHERE user_id = ? ORDER BY pos ASC").all(req.user.id) });
});

categoriesRouter.post("/", (req, res) => {
  const { name, color, shape } = req.body || {};
  if (!String(name || "").trim()) {
    res.status(400).json({ error: "nombre_requerido" });
    return;
  }
  const id = ensureCategory(req.user.id, String(name).trim(), color, shape);
  push(req.user.id, "state", { motivo: "categoria_creada" });
  res.json({ cat: db.prepare("SELECT id, name, color, shape FROM categories WHERE id = ?").get(id) });
});

categoriesRouter.patch("/:id", (req, res) => {
  const { name, color, shape } = req.body || {};
  const row = db.prepare("SELECT * FROM categories WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) {
    res.status(404).json({ error: "no_encontrado" });
    return;
  }
  db.prepare("UPDATE categories SET name = COALESCE(?, name), color = COALESCE(?, color), shape = COALESCE(?, shape) WHERE id = ?")
    .run(name === undefined ? null : name, color === undefined ? null : color, shape === undefined ? null : shape, row.id);
  res.json({ cat: db.prepare("SELECT id, name, color, shape FROM categories WHERE id = ?").get(row.id) });
});

categoriesRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM categories WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) {
    res.status(404).json({ error: "no_encontrado" });
    return;
  }
  db.transaction(() => {
    db.prepare("UPDATE items SET cat = NULL WHERE cat = ? AND user_id = ?").run(row.id, req.user.id);
    db.prepare("DELETE FROM categories WHERE id = ?").run(row.id);
  })();
  push(req.user.id, "state", { motivo: "categoria_eliminada" });
  res.json({ ok: true });
});
