import { Router } from "express";
import { db } from "../db.js";
import { clearSession, createUser, deleteUser, findUser, listProfiles, publicUser, requireAuth, setPin, setSession, verifyPin } from "../auth.js";
import { savePrefs } from "../services/items.service.js";

export const authRouter = Router();

authRouter.get("/profiles", (req, res) => {
  res.json({ profiles: listProfiles() });
});

authRouter.post("/register", (req, res) => {
  const { pin, av, color, prefs } = req.body || {};
  if (pin && !/^\d{4}$/.test(String(pin))) {
    res.status(400).json({ error: "pin_invalido" });
    return;
  }
  const name = String((req.body || {}).name || "").trim();
  if (name.length > 40) {
    res.status(400).json({ error: "nombre_largo" });
    return;
  }
  const user = createUser({ name, pin, av, color, prefs });
  res.json({ user, token: setSession(res, user.id) });
});

authRouter.post("/login", (req, res) => {
  const { id, pin } = req.body || {};
  const row = findUser(String(id || ""));
  if (!row) {
    res.status(404).json({ error: "perfil_no_encontrado" });
    return;
  }
  if (!verifyPin(row, pin)) {
    res.status(401).json({ error: "pin_incorrecto" });
    return;
  }
  res.json({ user: publicUser(row), token: setSession(res, row.id) });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.put("/me", requireAuth, (req, res) => {
  const { name, av, color, prefs, tour } = req.body || {};
  if (name !== undefined || av !== undefined || color !== undefined) {
    db.prepare("UPDATE users SET name = COALESCE(?, name), av = COALESCE(?, av), color = COALESCE(?, color) WHERE id = ?")
      .run(name === undefined ? null : String(name).slice(0, 40), av === undefined ? null : av, color === undefined ? null : color, req.user.id);
  }
  if (prefs !== undefined || tour !== undefined) savePrefs(req.user.id, prefs, undefined, tour);
  res.json({ user: publicUser(findUser(req.user.id)) });
});

authRouter.put("/me/pin", requireAuth, (req, res) => {
  const { pin } = req.body || {};
  if (pin && !/^\d{4}$/.test(String(pin))) {
    res.status(400).json({ error: "pin_invalido" });
    return;
  }
  setPin(req.user.id, pin || null);
  res.json({ user: publicUser(findUser(req.user.id)) });
});

authRouter.delete("/me", requireAuth, (req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (total < 2) {
    res.status(400).json({ error: "ultimo_perfil" });
    return;
  }
  deleteUser(req.user.id);
  clearSession(res);
  res.json({ ok: true });
});
