import { config, llmReady } from "../config.js";

export const SYSTEM_PROMPT = "Lee los correos. Si identificas notificaciones académicas, como un profesor cambiando la hora/fecha de una clase o creando un evento, extrae los datos y devuelve únicamente un JSON estricto con: titulo, fecha_inicio, fecha_fin";

const GUARD = "Responde solo con JSON. Si el correo no contiene ninguna notificación académica con fecha, responde exactamente {\"evento\":null}. Si la contiene, responde {\"evento\":{\"titulo\":\"...\",\"fecha_inicio\":\"YYYY-MM-DDTHH:MM\",\"fecha_fin\":\"YYYY-MM-DDTHH:MM\"}}. Usa la zona horaria del usuario y no inventes datos que no aparezcan en el correo.";

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    return null;
  }
}

function normalizeResult(parsed) {
  if (!parsed) return null;
  const node = parsed.evento === undefined ? parsed : parsed.evento;
  if (!node || typeof node !== "object") return null;
  const titulo = String(node.titulo || node.title || "").trim();
  const inicio = String(node.fecha_inicio || node.start || "").trim();
  const fin = String(node.fecha_fin || node.end || "").trim();
  if (!titulo || !inicio) return null;
  return { titulo: titulo.slice(0, 160), fecha_inicio: inicio, fecha_fin: fin || inicio };
}

async function callAnthropic(userContent) {
  const base = config.llm.baseUrl || "https://api.anthropic.com";
  const res = await fetch(base + "/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.llm.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.llm.model,
      max_tokens: 400,
      temperature: 0,
      system: SYSTEM_PROMPT + "\n" + GUARD,
      messages: [{ role: "user", content: userContent }]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || "fallo_llm");
  const parts = Array.isArray(data.content) ? data.content : [];
  return parts.map(p => (p && p.type === "text" ? p.text : "")).join("");
}

function chatEndpoint() {
  const base = (config.llm.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (/\/v\d|\/openai$/.test(base)) return base + "/chat/completions";
  return base + "/v1/chat/completions";
}

async function callOpenAi(userContent) {
  const body = {
    model: config.llm.model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT + "\n" + GUARD },
      { role: "user", content: userContent }
    ]
  };
  if (config.llm.jsonMode) body.response_format = { type: "json_object" };
  const res = await fetch(chatEndpoint(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + config.llm.apiKey
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || "fallo_llm");
  return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
}

export function buildMailPrompt(mail, today) {
  return [
    "Fecha de hoy: " + today,
    "Asunto: " + (mail.subject || ""),
    "Remitente: " + ((mail.from && mail.from.emailAddress && (mail.from.emailAddress.address || mail.from.emailAddress.name)) || ""),
    "Recibido: " + (mail.receivedDateTime || ""),
    "Contenido:",
    String(mail.text || mail.bodyPreview || "").slice(0, 6000)
  ].join("\n");
}

export async function extractEvent(mail, today) {
  if (!llmReady()) return { ok: false, reason: "llm_no_configurado", evento: null };
  const prompt = buildMailPrompt(mail, today);
  const text = config.llm.provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAi(prompt);
  const evento = normalizeResult(extractJson(text));
  return { ok: true, evento, raw: text };
}

export const SAMPLE_MAIL = {
  subject: "Cambio de hora: Bases de Datos",
  from: { emailAddress: { address: "profesor@universidad.es" } },
  receivedDateTime: new Date().toISOString(),
  text: "Buenos días, la clase de Bases de Datos del próximo martes se traslada de las 10:00 a las 16:00 y durará hasta las 17:30 en el aula 2.4."
};

export async function testLlm(today) {
  if (!llmReady()) return { ok: false, reason: "llm_no_configurado" };
  const started = Date.now();
  try {
    const out = await extractEvent(SAMPLE_MAIL, today);
    return { ok: true, ms: Date.now() - started, evento: out.evento, provider: config.llm.provider, model: config.llm.model };
  } catch (err) {
    return { ok: false, reason: err.message, provider: config.llm.provider, model: config.llm.model };
  }
}
