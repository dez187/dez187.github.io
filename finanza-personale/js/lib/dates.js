// Date come stringhe "AAAA-MM-GG". L'aritmetica usa UTC, così fuso orario e ora legale non spostano i giorni.

export const pad2 = (n) => String(n).padStart(2, "0");
export const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

export function todayStr(now = new Date()) {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parts(s) {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
}

export function addDays(s, n) {
  const [y, m, d] = parts(s);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Fine mese: 31 gennaio + 1 mese = 28 (o 29) febbraio.
export function addMonths(s, n) {
  const [y, m, d] = parts(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return ymd(ny, nm, Math.min(d, dim));
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export const FREQUENCIES = ["Giornaliera", "Settimanale", "Ogni 2 settimane", "Mensile", "Bimestrale", "Trimestrale", "Semestrale", "Annuale"];
const DAY_STEPS = { "Giornaliera": 1, "Settimanale": 7, "Ogni 2 settimane": 14 };
const MONTH_STEPS = { "Mensile": 1, "Bimestrale": 2, "Trimestrale": 3, "Semestrale": 6, "Annuale": 12 };

// La n-esima occorrenza si calcola sempre dalla data di inizio: un mese corto non sposta i successivi.
export function occurrenceDate(start, freq, n) {
  if (DAY_STEPS[freq]) return addDays(start, DAY_STEPS[freq] * n);
  return addMonths(start, (MONTH_STEPS[freq] || 1) * n);
}

export function addPeriod(s, freq) {
  return occurrenceDate(s, freq, 1);
}

// Importo equivalente al mese (52 settimane l'anno).
export function perMonth(amount, freq) {
  if (DAY_STEPS[freq]) return amount * (52 / 12) * (7 / DAY_STEPS[freq]);
  return amount / (MONTH_STEPS[freq] || 1);
}

export const monthOf = (s) => s.slice(0, 7);

export function addMonthsYm(ym, n) {
  return addMonths(`${ym}-01`, n).slice(0, 7);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const firstDay = (ym) => `${ym}-01`;
export const lastDay = (ym) => `${ym}-${pad2(daysInMonth(ym))}`;
