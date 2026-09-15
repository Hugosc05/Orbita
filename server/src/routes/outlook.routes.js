import crypto from "node:crypto";
import { Router } from "express";
import { config, llmReady, msReady } from "../config.js";
import { requireAuth } from "../auth.js";
import { accountStatus, authorizeUrl, consumeState, disconnect, exchangeCode, me, setAuto, storeTokens } from "../services/graph.service.js";
import { automationLog, syncUser } from "../services/automation.service.js";
import { SYSTEM_PROMPT, testLlm } from "../services/llm.service.js";
import { push } from "../util/sse.js";

export const outlookRouter = Router();

function sendPage(res, status, ok, title, message) {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-" + nonce + "'; base-uri 'none'; form-action 'none'");
  res.status(status).send(page(ok, title, message, nonce));
}

outlookRouter.get("/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    sendPage(res, 400, false, "No se pudo vincular", escapeHtml(String(error_description || error)));
    return;
  }
  const pending = consumeState(String(state || ""));
  if (!pending || !code) {
    sendPage(res, 400, false, "Enlace caducado", "Vuelve a pulsar Vincular desde Órbita.");
    return;
  }
  try {
    const tokens = await exchangeCode(String(code), pending.verifier);
    const address = await me(tokens.access_token).catch(() => "");
    storeTokens(pending.userId, tokens, address);
    push(pending.userId, "outlook", { connected: true, account: address });
    sendPage(res, 200, true, "Cuenta vinculada", address ? "Conectada como " + escapeHtml(address) + "." : "Ya puedes volver a Órbita.");
  } catch (err) {
    sendPage(res, 500, false, "Error al vincular", escapeHtml(err.message));
  }
});

outlookRouter.use(requireAuth);

outlookRouter.get("/status", (req, res) => {
  res.json({
    outlook: accountStatus(req.user.id),
    llm: { configured: llmReady(), provider: config.llm.provider, model: config.llm.model },
    intervalMinutes: config.sync.intervalMinutes,
    prompt: SYSTEM_PROMPT
  });
});

outlookRouter.get("/connect", (req, res) => {
  if (!msReady()) {
    res.status(400).json({ error: "microsoft_no_configurado" });
    return;
  }
  res.json({ url: authorizeUrl(req.user.id) });
});

outlookRouter.post("/disconnect", (req, res) => {
  disconnect(req.user.id);
  res.json({ ok: true, outlook: accountStatus(req.user.id) });
});

outlookRouter.post("/auto", (req, res) => {
  setAuto(req.user.id, !!(req.body && req.body.auto));
  res.json({ outlook: accountStatus(req.user.id) });
});

outlookRouter.post("/sync", async (req, res) => {
  const hours = Number(req.body && req.body.hours);
  const result = await syncUser(req.user.id, { hours: Number.isFinite(hours) && hours > 0 && hours <= 720 ? hours : 0 });
  res.json({ result, outlook: accountStatus(req.user.id) });
});

outlookRouter.post("/test-ia", async (req, res) => {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const hoy = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  res.json({ prueba: await testLlm(hoy) });
});

outlookRouter.get("/log", (req, res) => {
  res.json({ log: automationLog(req.user.id) });
});

function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function page(ok, title, message, nonce) {
  const mark = ok
    ? "<svg viewBox=\"0 0 24 24\"><path d=\"M5 12.5l4.5 4.5L19 7\"></path></svg>"
    : "<svg viewBox=\"0 0 24 24\"><path d=\"M6 6l12 12M18 6L6 18\"></path></svg>";
  return "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" +
    escapeHtml(title) +
    "</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#e9ecf6;color:#1a1e33}main{max-width:420px;padding:34px 30px;border-radius:28px;background:rgba(255,255,255,.72);box-shadow:0 18px 46px rgba(58,70,124,.18);text-align:center}i{display:grid;place-items:center;width:54px;height:54px;margin:0 auto 16px;border-radius:50%;background:" +
    (ok ? "#12bfa0" : "#ff6b6b") +
    "}svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#69709a;font-size:14px;line-height:1.5}@media(prefers-color-scheme:dark){body{background:#171a2a;color:#e9ecfa}main{background:rgba(41,46,72,.72)}p{color:#98a0c6}}</style></head><body><main><i>" +
    mark +
    "</i><h1>" +
    escapeHtml(title) +
    "</h1><p>" +
    message +
    "</p></main><script nonce=\"" + nonce + "\">try{if(window.opener){window.opener.postMessage({orbita:\"outlook\",ok:" +
    (ok ? "true" : "false") +
    "},window.location.origin);setTimeout(function(){window.close();},1200);}}catch(e){}</script></body></html>";
}
