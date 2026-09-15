import { db, nowMs } from "../db.js";
import { config, llmReady, msReady } from "../config.js";
import { accessToken, fullBody, getAccount, inbox } from "./graph.service.js";
import { extractEvent } from "./llm.service.js";
import { ensureCategory, findSimilar, insertItem, toClientItem, updateItem } from "./items.service.js";
import { localParts, minutesBetween } from "../util/dates.js";
import { push } from "../util/sse.js";

const running = new Set();

function todayStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function applyEvent(userId, evento, mail) {
  const start = localParts(evento.fecha_inicio);
  if (!start) return null;
  const dur = minutesBetween(evento.fecha_inicio, evento.fecha_fin);
  const cat = ensureCategory(userId, "Uni", "#6c5ce7", "square");
  const notes = ["Creado desde Outlook", mail.subject ? "Asunto: " + mail.subject : "", mail.webLink || ""].filter(Boolean).join("\n");
  const twin = findSimilar(userId, evento.titulo, start.date);
  if (twin) {
    const moved = twin.date !== start.date || (twin.time || "") !== (start.time || "");
    const item = updateItem(userId, twin.id, {
      title: evento.titulo,
      date: start.date,
      time: start.time,
      dur: dur || Number(twin.dur) || 60,
      notes: twin.notes && twin.notes.includes("Outlook") ? notes : twin.notes,
      source: "outlook",
      kind: "event",
      extId: mail.id || ""
    });
    return { action: moved ? "movido" : "actualizado", item };
  }
  const item = insertItem(userId, {
    title: evento.titulo,
    cat,
    date: start.date,
    time: start.time,
    dur: dur || 60,
    notes,
    source: "outlook",
    kind: "event",
    extId: mail.id || ""
  });
  return { action: "creado", item };
}

export async function syncUser(userId, options = {}) {
  if (running.has(userId)) return { ok: false, reason: "en_curso" };
  const account = getAccount(userId);
  if (!msReady()) return { ok: false, reason: "microsoft_no_configurado" };
  if (!account || !account.refresh_token) return { ok: false, reason: "sin_cuenta" };
  if (!llmReady()) return { ok: false, reason: "llm_no_configurado" };
  running.add(userId);
  const summary = { ok: true, revisados: 0, creados: 0, movidos: 0, ignorados: 0, errores: 0, eventos: [] };
  try {
    const token = await accessToken(userId);
    if (!token) return { ok: false, reason: "sin_token" };
    const hours = Number(options.hours) || config.sync.lookbackHours;
    const mails = await inbox(token, hours, config.sync.batch);
    const seen = db.prepare("SELECT message_id FROM processed_mail WHERE user_id = ?").all(userId).map(r => r.message_id);
    const known = new Set(seen);
    const mark = db.prepare("INSERT OR REPLACE INTO processed_mail (user_id, message_id, at, outcome, item_id) VALUES (?, ?, ?, ?, ?)");
    const today = todayStamp();
    for (const mail of mails) {
      if (known.has(mail.id)) continue;
      summary.revisados += 1;
      try {
        const text = await fullBody(token, mail.id);
        const result = await extractEvent({ ...mail, text }, today);
        if (!result.ok || !result.evento) {
          summary.ignorados += 1;
          mark.run(userId, mail.id, nowMs(), "sin_evento", null);
          continue;
        }
        const applied = applyEvent(userId, result.evento, mail);
        if (!applied) {
          summary.ignorados += 1;
          mark.run(userId, mail.id, nowMs(), "fecha_invalida", null);
          continue;
        }
        if (applied.action === "creado") summary.creados += 1;
        else summary.movidos += 1;
        summary.eventos.push({ accion: applied.action, titulo: applied.item.title, fecha: applied.item.date, hora: applied.item.time });
        mark.run(userId, mail.id, nowMs(), applied.action, applied.item.id);
      } catch (err) {
        summary.errores += 1;
        mark.run(userId, mail.id, nowMs(), "error", null);
      }
    }
    const line = summary.creados + " creados, " + summary.movidos + " movidos, " + summary.ignorados + " sin evento";
    db.prepare("UPDATE outlook_accounts SET last_sync = ?, last_result = ? WHERE user_id = ?").run(nowMs(), line, userId);
    if (summary.creados || summary.movidos) push(userId, "state", { motivo: "outlook", resumen: summary });
    return summary;
  } catch (err) {
    db.prepare("UPDATE outlook_accounts SET last_sync = ?, last_result = ? WHERE user_id = ?").run(nowMs(), "error: " + err.message, userId);
    return { ok: false, reason: err.message };
  } finally {
    running.delete(userId);
  }
}

export async function syncAll() {
  if (!msReady() || !llmReady()) return;
  const rows = db.prepare("SELECT user_id FROM outlook_accounts WHERE auto = 1 AND refresh_token IS NOT NULL AND refresh_token != ''").all();
  for (const row of rows) {
    await syncUser(row.user_id);
  }
}

export function startScheduler() {
  const minutes = config.sync.intervalMinutes;
  if (!minutes) return null;
  const timer = setInterval(() => {
    syncAll().catch(() => {});
  }, minutes * 60000);
  timer.unref();
  return timer;
}

export function automationLog(userId, limit = 15) {
  const rows = db.prepare("SELECT message_id, at, outcome, item_id FROM processed_mail WHERE user_id = ? ORDER BY at DESC LIMIT ?").all(userId, limit);
  return rows.map(r => {
    const item = r.item_id ? db.prepare("SELECT * FROM items WHERE id = ?").get(r.item_id) : null;
    return {
      at: r.at,
      outcome: r.outcome,
      item: item ? toClientItem(item) : null
    };
  });
}
