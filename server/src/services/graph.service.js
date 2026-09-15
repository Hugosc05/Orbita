import { db, nowMs } from "../db.js";
import { config, msReady } from "../config.js";
import crypto from "node:crypto";
import { seal, open, randomState } from "../util/crypto.js";
import { isoHoursAgo } from "../util/dates.js";

const AUTH_HOST = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

export function authorizeUrl(userId) {
  if (!msReady()) throw new Error("microsoft_no_configurado");
  const state = randomState();
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  db.prepare("INSERT INTO oauth_states (state, user_id, at, verifier) VALUES (?, ?, ?, ?)").run(state, userId, nowMs(), seal(verifier));
  db.prepare("DELETE FROM oauth_states WHERE at < ?").run(nowMs() - 900000);
  const params = new URLSearchParams({
    client_id: config.ms.clientId,
    response_type: "code",
    redirect_uri: config.ms.redirectUri,
    response_mode: "query",
    scope: config.ms.scopes,
    state,
    prompt: "select_account",
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  return AUTH_HOST + "/" + config.ms.tenant + "/oauth2/v2.0/authorize?" + params.toString();
}

export function consumeState(state) {
  const row = db.prepare("SELECT user_id, verifier, at FROM oauth_states WHERE state = ?").get(state);
  if (!row) return null;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  if (nowMs() - row.at > 900000) return null;
  return { userId: row.user_id, verifier: open(row.verifier) };
}

async function tokenRequest(body) {
  const res = await fetch(AUTH_HOST + "/" + config.ms.tenant + "/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || "fallo_token_microsoft");
  return data;
}

export async function exchangeCode(code, verifier) {
  const body = {
    client_id: config.ms.clientId,
    client_secret: config.ms.clientSecret,
    code,
    redirect_uri: config.ms.redirectUri,
    grant_type: "authorization_code",
    scope: config.ms.scopes
  };
  if (verifier) body.code_verifier = verifier;
  return tokenRequest(body);
}

export async function refresh(refreshToken) {
  return tokenRequest({
    client_id: config.ms.clientId,
    client_secret: config.ms.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: config.ms.scopes
  });
}

export function storeTokens(userId, tokens, account) {
  const expires = nowMs() + (Number(tokens.expires_in) || 3600) * 1000 - 60000;
  const existing = db.prepare("SELECT user_id, refresh_token, auto FROM outlook_accounts WHERE user_id = ?").get(userId);
  const refreshToken = tokens.refresh_token ? seal(tokens.refresh_token) : existing ? existing.refresh_token : "";
  db.prepare(`INSERT INTO outlook_accounts (user_id, account, access_token, refresh_token, expires, auto, last_sync, last_result, linked_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, '', ?)
    ON CONFLICT(user_id) DO UPDATE SET account = excluded.account, access_token = excluded.access_token,
      refresh_token = excluded.refresh_token, expires = excluded.expires`)
    .run(userId, account || "", seal(tokens.access_token), refreshToken, expires, existing ? existing.auto : 1, nowMs());
}

export function getAccount(userId) {
  return db.prepare("SELECT * FROM outlook_accounts WHERE user_id = ?").get(userId) || null;
}

export function accountStatus(userId) {
  const row = getAccount(userId);
  return {
    configured: msReady(),
    connected: !!(row && row.refresh_token),
    account: row ? row.account : "",
    auto: row ? !!row.auto : false,
    lastSync: row ? row.last_sync : 0,
    lastResult: row ? row.last_result : "",
    linkedAt: row ? row.linked_at || 0 : 0,
    scopes: config.ms.scopes
  };
}

export function disconnect(userId) {
  db.prepare("DELETE FROM outlook_accounts WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM processed_mail WHERE user_id = ?").run(userId);
}

export function setAuto(userId, auto) {
  db.prepare("UPDATE outlook_accounts SET auto = ? WHERE user_id = ?").run(auto ? 1 : 0, userId);
}

export async function accessToken(userId) {
  const row = getAccount(userId);
  if (!row) return "";
  const current = open(row.access_token);
  if (current && row.expires > nowMs()) return current;
  const rt = open(row.refresh_token);
  if (!rt) return "";
  const tokens = await refresh(rt);
  storeTokens(userId, tokens, row.account);
  return tokens.access_token;
}

async function graphGet(token, url) {
  const res = await fetch(url.startsWith("http") ? url : GRAPH + url, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || "fallo_graph");
  return data;
}

export async function me(token) {
  const data = await graphGet(token, "/me?$select=displayName,mail,userPrincipalName");
  return data.mail || data.userPrincipalName || data.displayName || "";
}

export async function inbox(token, hours, top) {
  const since = isoHoursAgo(hours);
  const params = new URLSearchParams({
    $top: String(top),
    $select: "id,subject,from,receivedDateTime,bodyPreview,webLink,isRead",
    $orderby: "receivedDateTime desc",
    $filter: "receivedDateTime ge " + since
  });
  const data = await graphGet(token, "/me/mailFolders/inbox/messages?" + params.toString());
  return Array.isArray(data.value) ? data.value : [];
}

export async function fullBody(token, id) {
  const data = await graphGet(token, "/me/messages/" + encodeURIComponent(id) + "?$select=body");
  const content = data && data.body && data.body.content ? String(data.body.content) : "";
  return content.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
