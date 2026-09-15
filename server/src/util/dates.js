const pad = n => String(n).padStart(2, "0");

export function localParts(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (!m) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return { date: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), time: pad(d.getHours()) + ":" + pad(d.getMinutes()) };
  }
  return { date: m[1] + "-" + m[2] + "-" + m[3], time: m[4] ? m[4] + ":" + m[5] : "" };
}

export function minutesBetween(a, b) {
  if (!a || !b) return 0;
  const start = new Date(String(a).replace(" ", "T"));
  const end = new Date(String(b).replace(" ", "T"));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const diff = Math.round((end.getTime() - start.getTime()) / 60000);
  if (diff <= 0 || diff > 24 * 60) return 0;
  return diff;
}

export function daysApart(a, b) {
  if (!a || !b) return 9999;
  const x = new Date(a + "T00:00:00");
  const y = new Date(b + "T00:00:00");
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return 9999;
  return Math.abs(Math.round((x.getTime() - y.getTime()) / 86400000));
}

export const isoHoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();

export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
