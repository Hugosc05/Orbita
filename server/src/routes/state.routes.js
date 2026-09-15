import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { getState, putState, savePrefs } from "../services/items.service.js";
import { push } from "../util/sse.js";

export const stateRouter = Router();

stateRouter.use(requireAuth);

stateRouter.get("/", (req, res) => {
  res.json(getState(req.user.id));
});

stateRouter.put("/", (req, res) => {
  const payload = req.body || {};
  const state = putState(req.user.id, payload);
  if (payload.prefs !== undefined || payload.bg !== undefined || payload.tour !== undefined) {
    savePrefs(req.user.id, payload.prefs, payload.bg, payload.tour);
  }
  push(req.user.id, "saved", { at: Date.now() });
  res.json({ ok: true, count: state.items.length });
});

stateRouter.put("/prefs", (req, res) => {
  const { prefs, bg, tour, view } = req.body || {};
  savePrefs(req.user.id, prefs, bg, tour);
  if (view) db.prepare("UPDATE prefs SET view = ? WHERE user_id = ?").run(view, req.user.id);
  res.json({ ok: true });
});

stateRouter.get("/background", (req, res) => {
  const row = db.prepare("SELECT bg FROM prefs WHERE user_id = ?").get(req.user.id) || {};
  res.json({ bg: row.bg || "" });
});
