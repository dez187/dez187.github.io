import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addMonths } from "../lib/dates.js";
import { fmtDayMonth, fmtEUR, fmtNum, fmtRelative, fmtSigned, fmtPct, onDate, MINUS } from "../lib/format.js";
import { dailySeries, firstHistoryDate } from "../domain/history.js";
import { detectRecurring } from "../domain/recurring.js";
import { detectInstalments } from "../domain/instalments.js";
import { buildForecast } from "../domain/forecast.js";
import { buildAlerts } from "../domain/alerts.js";
import { budgetMonth } from "../domain/budget.js";
import { iconAvatar } from "../ui/components.js";

export const RANGES = [
  { id: "1M", label: "1M", months: 1, name: "nell'ultimo mese" },
  { id: "3M", label: "3M", months: 3, name: "negli ultimi 3 mesi" },
  { id: "6M", label: "6M", months: 6, name: "negli ultimi 6 mesi" },
  { id: "1A", label: "1A", months: 12, name: "nell'ultimo anno" },
  { id: "ALL", label: "Tutto", months: null, name: "da inizio storico" },
];

export function seriesFor(app, field, rangeId, current) {
  const r = RANGES.find((x) => x.id === rangeId) || RANGES[1];
  const today = app.today;
  const first = firstHistoryDate(app.state.history, field) || today;
  let from = r.months ? addMonths(today, -r.months) : first;
  if (from < first) from = first;
  const points = dailySeries(app.state.history, field, from, today, current);
  return { points, from, range: r };
}

export function deltaLine(points, range) {
  if (points.length < 2) return html`<span class="delta muted">Lo storico si costruisce giorno per giorno.</span>`;
  const a = points[0].value, b = points[points.length - 1].value;
  const d = b - a;
  const pct = Math.abs(a) > 0.005 ? (d / Math.abs(a)) * 100 : null;
  const cls = d > 0.004 ? "pos" : d < -0.004 ? "neg" : "muted";
  const since = range.months && points[0].date > addMonths(points[points.length - 1].date, -range.months) ? onDate("da", points[0].date) : range.name;
  return html`<span class="delta ${cls}">${icon(d >= 0 ? "arrowUpRight" : "arrowDownRight", 16)} ${fmtSigned(d)}${pct != null ? ` (${fmtPct(pct, 1, true)})` : ""}</span> <span class="delta-note">${since}</span>`;
}

export function rangeSwitch(action, current, label = "Periodo del grafico") {
  return html`<div class="seg seg-sm" role="group" aria-label="${label}">${RANGES.map((r) => html`<button type="button" data-action="${action}" data-value="${r.id}" aria-pressed="${r.id === current}">${r.label}</button>`)}</div>`;
}

export function pageHead(title, actions = "", eyebrow = "") {
  return html`<header class="page-head"><div>${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ""}<h1 class="page-title">${title}</h1></div>${actions ? html`<div class="head-actions">${actions}</div>` : ""}</header>`;
}

export function cardHead(title, right = "", id = "") {
  return html`<div class="card-head"><h2 class="card-title"${id ? html` id="${id}"` : ""}>${title}</h2>${right}</div>`;
}

const UP_ICON = { schedule: "repeat", pac: "trend", card: "card", tx: "calendar", loan: "percent" };
const UP_TONE = { schedule: "blue", pac: "aqua", card: "violet", tx: "neutral", loan: "orange" };

// after: disponibile previsto a fine giornata della scadenza (facoltativo).
export function upcomingRow(it, today, after = null) {
  const amount = it.sign > 0 ? "+" + fmtEUR(it.amount) : it.sign < 0 ? MINUS + fmtEUR(it.amount) : fmtEUR(it.amount);
  const sub = [it.due ? "da registrare" : fmtRelative(it.date, today), it.where || it.label].filter(Boolean).join(" · ");
  let right;
  if (it.due && it.kind === "pac") right = html`<button type="button" class="btn sm primary" data-action="register-pac" data-id="${it.id}">Registra</button>`;
  else if (it.due && it.kind === "card") right = html`<button type="button" class="btn sm" data-action="settle-card" data-renew="1" data-id="${it.id}">Rinnova</button>`;
  else {
    right = html`<span class="amount ${it.tone || (it.sign > 0 ? "pos" : it.sign === 0 ? "muted" : "out")}">${amount}</span>`;
    if (after != null) right = html`<span class="row-end">${right}<span class="row-note ${after < 0 ? "neg" : ""}">poi ${fmtEUR(after)}</span></span>`;
  }
  const openAction = it.kind === "schedule" ? "edit-schedule" : it.kind === "tx" ? "edit-tx" : "edit";
  const coll = it.kind === "pac" ? "pac" : it.kind === "card" ? "creditCards" : it.kind === "loan" ? "loans" : "";
  return html`<li class="row">
    ${iconAvatar(UP_ICON[it.kind], UP_TONE[it.kind])}
    <button type="button" class="row-main linklike" data-action="${openAction}" data-id="${it.id}"${coll ? html` data-coll="${coll}"` : ""}><span class="row-title">${it.title}</span><span class="row-sub">${fmtDayMonth(it.date)} · ${sub}</span></button>
    ${right}
  </li>`;
}

export function kpi({ label, value, sub = "", href = "", tone = "" }) {
  const inner = html`<span class="kpi-label">${label}</span><span class="kpi-value${tone ? " " + tone : ""}">${value}</span>${sub ? html`<span class="kpi-sub">${sub}</span>` : ""}`;
  return href ? html`<a class="kpi" href="${href}">${inner}</a>` : html`<div class="kpi">${inner}</div>`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 5 ? "Buonasera" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
}

export function monthLabel(ym) {
  const s = new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));
  return s;
}

// "ad agosto", "a settembre"
export function monthPrep(ym) {
  const m = monthLabel(ym);
  return (m.startsWith("a") ? "ad " : "a ") + m;
}

// ---------- calcoli di pianificazione, ricalcolati solo quando cambiano i dati o il giorno ----------
const memo = { version: -1, today: "", map: new Map() };
export function cached(app, key, fn) {
  if (memo.version !== app.store.version || memo.today !== app.today) {
    memo.version = app.store.version;
    memo.today = app.today;
    memo.map.clear();
  }
  if (!memo.map.has(key)) memo.map.set(key, fn());
  return memo.map.get(key);
}

export const recurringFor = (app) => cached(app, "recurring", () => detectRecurring(app.state.transactions, app.today));
export const instalmentsFor = (app) => cached(app, "instalments", () => detectInstalments(app.state.transactions, app.today, { schedules: app.state.schedules }));

// opts: { includeAnnual, includeExtras, includeIrregularIncome } (di base tutti attivi)
export function forecastFor(app, days = 90, opts = {}) {
  const key = `forecast:${days}:${opts.includeAnnual !== false}:${opts.includeExtras !== false}:${opts.includeIrregularIncome !== false}`;
  return cached(app, key, () => buildForecast(app.state, app.today, { days, totals: app.derived().totals, recurring: recurringFor(app), instalments: instalmentsFor(app), ignoredInstalments: app.state.settings.instalmentsIgnored, ...opts }));
}

export const alertsFor = (app) => cached(app, "alerts", () => buildAlerts(app.state, app.derived().totals, app.today, {
  forecast: forecastFor(app, 90),
  budget: budgetMonth(app.state.categories, app.state.transactions, app.today.slice(0, 7), app.today),
  recurring: recurringFor(app),
  prefs: app.state.settings,
}));

const ALERT_ICON = { "debit-uncovered": "alert", "salary-late": "clock", "account-negative": "alert", "total-low": "alert", "card-limit": "card", "card-no-reset": "card", "budget-over": "target", "budget-risk": "target", "price-up": "tag", "loan-manual": "percent" };

// "Addebito Amex del 5 ott 2026 (1.229,92 €)" oppure "Addebito Amex e Rata Agos del 5 ott 2026 (in tutto 1.711,92 €)".
// L'importo va dopo la data: alcune voci hanno già una parentesi ("Rata PayPal (in 3 rate)").
function debitsText(a) {
  const names = a.debits.map((d) => d.label);
  const list = names.length <= 1 ? names[0] || "un addebito" : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
  return `${list} ${onDate("di", a.date)} (${names.length > 1 ? "in tutto " : ""}${fmtEUR(a.total)})`;
}

function alertText(a) {
  switch (a.type) {
    case "debit-uncovered":
      return html`<strong>Su ${a.name} non ci sono abbastanza soldi per ${debitsText(a)}.</strong> Con le scadenze note mancano ${fmtEUR(a.need)}${a.from ? `: puoi spostarli da ${a.from.name}, che può darne fino a ${fmtEUR(a.from.spare)} senza restare scoperto.` : ". Nessun altro conto li copre da solo."}`;
    case "salary-late":
      return a.risk
        ? html`<strong>${a.name} non è ancora arrivato</strong> (era atteso ${onDate("il", a.expected)}). Se tarda ancora, su ${a.risk.name} non ci saranno abbastanza soldi per ${debitsText(a.risk)}: mancherebbero ${fmtEUR(a.risk.need)}${a.risk.from ? `, che puoi spostare da ${a.risk.from.name}` : ""}.`
        : html`<strong>${a.name} non è ancora arrivato</strong> (era atteso ${onDate("il", a.expected)}). Per ora gli addebiti dei prossimi giorni restano coperti.`;
    case "account-negative":
      return html`<strong>${a.name} potrebbe andare in rosso.</strong> Con le scadenze note ${a.date === a.lowDate ? `scende a ${fmtEUR(a.value)} ${onDate("il", a.date)}` : `scende sotto zero ${onDate("da", a.date)}, fino a ${fmtEUR(a.value)} ${onDate("il", a.lowDate)}`}.`;
    case "total-low":
      return a.threshold > 0
        ? html`<strong>Il disponibile previsto scende sotto la tua soglia di ${fmtEUR(a.threshold)}.</strong> Fino a ${fmtEUR(a.value)} ${onDate("il", a.date)}, contando anche le spese medie.`
        : html`<strong>Il disponibile previsto scende sotto zero.</strong> Fino a ${fmtEUR(a.value)} ${onDate("il", a.date)}, contando anche le spese medie.`;
    case "card-limit":
      return html`<strong>${a.name}: ${fmtEUR(a.spent)} su ${fmtEUR(a.limit)} di massimale</strong> (${fmtNum(a.pct, 0)}%).`;
    case "card-no-reset":
      return html`<strong>${a.name} non ha la data di rinnovo.</strong> Aggiungila per prevedere meglio i suoi addebiti.`;
    case "budget-over":
      return html`<strong>Budget ${a.name} sforato:</strong> ${fmtEUR(a.spent)} su ${fmtEUR(a.budget)}.`;
    case "budget-risk":
      return html`<strong>Budget ${a.name} a rischio:</strong> ${fmtEUR(a.spent)} finora, al ritmo solito circa ${fmtEUR(a.projected)} a fine mese su ${fmtEUR(a.budget)}.`;
    case "price-up":
      return html`<strong>${a.name} è aumentato:</strong> da ${fmtEUR(a.from)} a ${fmtEUR(a.to)} ${onDate("il", a.date)}.`;
    case "loan-manual":
      return html`<strong>La rata di ${a.name} non è automatica.</strong> Indica conto e prossima rata: l'app la registrerà da sola e la metterà nelle previsioni.`;
    default:
      return "";
  }
}

function alertAction(a) {
  const cover = a.type === "debit-uncovered" ? a : a.type === "salary-late" ? a.risk : null;
  if (cover && cover.from) return html`<button type="button" class="btn sm" data-action="cover-debit" data-from="${cover.from.accountId}" data-to="${cover.accountId}" data-amount="${cover.need}">${icon("transfer", 16)} Prepara il giroconto</button>`;
  if (a.type === "card-no-reset" || a.type === "card-limit") return html`<button type="button" class="btn sm" data-action="edit" data-coll="creditCards" data-id="${a.cardId}">Apri la carta</button>`;
  if (a.type === "loan-manual") return html`<button type="button" class="btn sm" data-action="edit" data-coll="loans" data-id="${a.loanId}">Imposta</button>`;
  if (a.type.startsWith("budget")) return html`<a class="btn sm" href="#/budget">Budget</a>`;
  if (a.type === "price-up") return html`<a class="btn sm" href="#/transazioni?vista=programmate">Ricorrenti</a>`;
  return html`<a class="btn sm" href="#/previsioni">Previsione</a>`;
}

// Elenco di avvisi con il pulsante per rimandarli di una settimana.
export function alertsList(list) {
  return html`${list.map((a) => html`<div class="alert ${a.level}">${icon(ALERT_ICON[a.type] || "info", 20)}<p>${alertText(a)}</p><span class="alert-actions">${alertAction(a)}<button type="button" class="btn sm ghost" data-action="snooze-alert" data-key="${a.key}" aria-label="Rimanda di una settimana: ${a.name || "avviso"}">Più tardi</button></span></div>`)}`;
}

