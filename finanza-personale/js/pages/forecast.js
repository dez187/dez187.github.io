import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addDays, addMonths, monthOf } from "../lib/dates.js";
import { fmtDate, fmtDayMonth, fmtEUR, fmtMonth, fmtMonthInline, fmtNum, fmtPct, numToInput, onDate, parseAmount, toNum, MINUS } from "../lib/format.js";
import { autonomy } from "../domain/forecast.js";
import { dailySeries } from "../domain/history.js";
import { netWorth, netWorthSeries, projectNetWorth, projectionDefaults } from "../domain/networth.js";
import { amortize, firstInstallment, payoffPlan, simulateExtra } from "../domain/debts.js";
import { loanAutoPay } from "../domain/loans.js";
import { nameOf, loanProgress } from "../domain/finance.js";
import { multiLineChart } from "../ui/charts.js";
import { badge, emptyState, meter } from "../ui/components.js";
import { instalmentCovered, planIgnored, planMatchesKey } from "../domain/instalments.js";
import { calendarEvents } from "../domain/calendar.js";
import { buildIcs } from "../lib/ics.js";
import { downloadText } from "../lib/dom.js";
import { toast } from "../ui/feedback.js";
import { openOperationForm } from "../ui/operation.js";
import { alertsFor, alertsList, cached, cardHead, forecastFor, instalmentsFor, pageHead } from "./shared.js";

// Previsioni: saldo dei prossimi giorni, patrimonio netto negli anni, piano dei debiti.
// Solo lettura: niente in questa pagina scrive dati, tranne "Più tardi" sugli avvisi (impostazioni).

const TABS = [["saldo", "Saldo previsto"], ["patrimonio", "Patrimonio netto"], ["debiti", "Debiti"]];
const SCENARIOS = [
  { rate: 0, label: "Prudente (0%)", color: "var(--ink-3)" },
  { rate: 4, label: "Medio (4%)", color: "var(--series-1)" },
  { rate: 7, label: "Ottimista (7%)", color: "var(--series-3)" },
];
const KIND = { tx: "registrato", transfer: "giroconto", schedule: "programmata", income: "entrata", loan: "rata", pac: "PAC", recurring: "ricorrente", card: "carta", annual: "come l'anno scorso", extra: "mensilità extra", instalment: "rata a pagamento" };

const view = { tab: "saldo", days: 90, chart: "total", annual: true, extras: true, other: true, showAll: false, years: 10, saving: "", invest: "", loan: "", extra: "", lump: "", strat: "", routeKey: "" };

const opts = () => ({ includeAnnual: view.annual, includeExtras: view.extras, includeIrregularIncome: view.other });
const tone = (e) => (e.kind === "transfer" ? "xfer" : e.amount > 0 ? "pos" : e.kind === "pac" ? "inv" : "out");
const signed = (v) => (v > 0 ? "+" : v < 0 ? MINUS : "") + fmtEUR(Math.abs(v));
const money = (s, fallback) => {
  const v = parseAmount(s);
  return String(s).trim() === "" || !Number.isFinite(v) ? fallback : v;
};

// ---------- saldo previsto ----------
function forecastTab(app) {
  const { state, today } = app;
  if (view.chart !== "total" && !state.accounts.some((a) => a.id === view.chart)) view.chart = "total"; // conto eliminato: si torna al totale
  const t = app.derived().totals;
  const f = forecastFor(app, view.days, opts());
  const aut = cached(app, "autonomy", () => autonomy(t.liquidity, state.transactions, today));
  const accounts = [...f.accounts].sort((a, b) => a.min.value - b.min.value);
  const shown = view.showAll ? f.events : f.events.slice(0, 40);
  const months = [];
  for (const e of shown) {
    const m = e.date.slice(0, 7);
    if (!months.length || months[months.length - 1].month !== m) months.push({ month: m, items: [] });
    months[months.length - 1].items.push(e);
  }
  const accrual = f.irregular.reduce((s, c) => s + c.monthly, 0);
  const cards = [...f.flows.byCard.entries()].filter(([, v]) => v > 0.005);
  return html`
    <section class="card span-8 hero" aria-labelledby="h-fc">
      <div class="card-head">
        <div><h2 class="card-label" id="h-fc">Disponibile previsto fra ${view.days} giorni</h2>
          <p class="hero-value${f.endValue < 0 ? " neg" : ""}">${fmtEUR(f.endValue)}</p>
          <p class="hero-delta"><span>Oggi ${fmtEUR(f.start)}</span><span class="muted">·</span><span class="${f.min.value < 0 ? "neg" : ""}">minimo ${fmtEUR(f.min.value)} ${f.min.date === today ? "oggi" : onDate("il", f.min.date, fmtDayMonth)}</span></p></div>
        <div class="seg seg-sm" role="group" aria-label="Orizzonte della previsione">${[30, 60, 90].map((d) => html`<button type="button" data-action="fc-days" data-value="${d}" aria-pressed="${view.days === d}">${d} giorni</button>`)}</div>
      </div>
      <div class="fc-controls">
        <label class="filter"><span class="sr-only">Cosa mostrare nel grafico</span><select class="input" id="fc-chart" data-input="fc-chart"><option value="total"${raw(view.chart === "total" ? " selected" : "")}>Tutti i conti</option>${state.accounts.map((a) => html`<option value="${a.id}"${raw(view.chart === a.id ? " selected" : "")}>${a.name || "Conto"} (solo scadenze)</option>`)}</select></label>
        <div class="legend">${view.chart === "total" ? html`<span><i class="key line" style="background:var(--series-1)"></i>Storico</span>` : ""}<span><i class="key line dashed" style="color:var(--series-1)"></i>Previsione</span></div>
      </div>
      <div class="chart" data-chart="fc"></div>
      <p class="card-foot">${view.chart === "total" ? "La linea tratteggiata comprende scadenze, spese medie di tutti i giorni" + (view.other ? " ed entrate non regolari medie" : "") + ". È una stima: le spese impreviste non ci sono." : "Per un singolo conto contano solo le scadenze note: le spese di tutti i giorni e le ricariche che fai a mano non si possono attribuire a un conto."}</p>
    </section>

    <section class="card span-4" aria-labelledby="h-fc-sum">
      ${cardHead("In breve", "", "h-fc-sum")}
      <dl class="facts stacked wrap">
        <div><dt>Prossimo stipendio previsto</dt><dd>${f.nextIncome ? html`${fmtDayMonth(f.nextIncome.date)} · <span class="pos">+${fmtEUR(f.nextIncome.amount)}</span>` : "non trovato"}</dd></div>
        ${f.margin != null ? html`<div><dt>Punto più basso prima dello stipendio</dt><dd class="${f.margin < 0 ? "neg" : ""}">${fmtEUR(f.margin)}</dd></div>` : ""}
        <div><dt>Mesi di autonomia</dt><dd>${aut.months == null ? "—" : `${fmtNum(aut.months, 1, 1)} ${aut.months >= 0.95 && aut.months < 1.05 ? "mese" : "mesi"}`}</dd></div>
        <div><dt>Spesa media mensile</dt><dd>${fmtEUR(aut.monthly)}</dd></div>
        <div><dt>Spese quotidiane dai conti</dt><dd>${fmtEUR(f.flows.spendDaily)} al giorno</dd></div>
        ${cards.map(([id, v]) => html`<div><dt>Spese con ${nameOf(state.creditCards, id, "carta")}</dt><dd>${fmtEUR(v * 30.44)} al mese</dd></div>`)}
        <div><dt>Entrate non regolari (media)</dt><dd>${fmtEUR(f.flows.otherIncome.monthly)} al mese${view.other ? "" : html` <span class="muted">· escluse</span>`}</dd></div>
      </dl>
      <p class="card-foot">Mesi di autonomia: quanti mesi coprirebbe il disponibile con la spesa media degli ultimi 6 mesi, senza contare i versamenti negli investimenti.</p>
    </section>

    <section class="card span-12" aria-labelledby="h-fc-acc">
      ${cardHead("Conto per conto", "", "h-fc-acc")}
      ${!accounts.length ? emptyState("Nessun conto", "Aggiungi un conto per vedere la previsione conto per conto.") : html`<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Conto</th><th scope="col" class="num">Oggi</th><th scope="col" class="num">Minimo previsto</th><th scope="col" class="num hide-sm">Quando</th><th scope="col" class="num">Fra ${view.days} giorni</th></tr></thead>
        <tbody>${accounts.map((a) => html`<tr>
          <th scope="row"><button type="button" class="cell-link" data-action="account-detail" data-coll="accounts" data-id="${a.id}"><span class="cell-title">${a.name}</span></button></th>
          <td class="num">${fmtEUR(a.start)}</td>
          <td class="num ${a.min.value < 0 ? "neg" : ""}"><strong>${fmtEUR(a.min.value)}</strong></td>
          <td class="num hide-sm">${a.min.date === today ? "oggi" : fmtDayMonth(a.min.date)}</td>
          <td class="num ${a.end < 0 ? "neg" : ""}">${fmtEUR(a.end)}</td></tr>`)}</tbody>
      </table></div>`}
      <p class="card-foot">Solo scadenze note: movimenti già registrati, programmate, rate, PAC, ricorrenze trovate nei movimenti e addebiti delle carte. Le spese medie e le ricariche fatte a mano sono solo nel totale.</p>
    </section>

    <section class="card span-12" aria-labelledby="h-fc-ev">
      ${cardHead("Scadenze previste", html`<span class="group-right"><span class="muted">${f.events.length} nei prossimi ${view.days} giorni</span><button type="button" class="btn sm" data-action="fc-ics">${icon("calendar", 16)} Nel calendario</button></span>`, "h-fc-ev")}
      ${f.events.length ? html`${months.map((m) => html`<h3 class="subhead">${fmtMonth(m.month)}</h3>
        <ul class="list">${m.items.map((e) => html`<li class="row static fc-event">
          <span class="fc-date">${fmtDayMonth(e.date)}</span>
          <span class="row-main"><span class="row-title"><span class="clip">${e.label}</span>${e.estimated ? badge("stima", "subtle") : ""}</span><span class="row-sub">${KIND[e.kind] || e.kind} · ${nameOf(state.accounts, e.accountId)}${e.refDate ? ` · ${fmtMonthInline(e.refDate.slice(0, 7))}` : ""}</span></span>
          <span class="amount ${tone(e)}">${signed(e.amount)}</span></li>`)}</ul>`)}
        ${f.events.length > shown.length ? html`<div class="more"><button type="button" class="btn" data-action="fc-all">Mostra tutte (${f.events.length})</button></div>` : ""}`
        : emptyState("Nessuna scadenza nel periodo", "Programmate, rate, PAC e addebiti delle carte compaiono qui.")}
      ${f.events.length ? html`<p class="card-foot">“Nel calendario” scarica le scadenze dei prossimi 90 giorni in un file .ics. Reimportandolo più avanti, gli eventi si aggiornano; una scadenza che sparisce o cambia mese resta però nel calendario e va tolta a mano.</p>` : ""}
    </section>

    <section class="card span-6" aria-labelledby="h-fc-annual">
      ${cardHead("Spese annuali e mesi pesanti", "", "h-fc-annual")}
      ${f.irregular.length ? html`<ul class="breakdown fc-annual">${f.irregular.map((c) => html`<li><span class="bd-name">${c.name}</span><span class="bd-val">${fmtEUR(c.total)}</span><span class="bd-pct">${fmtEUR(c.monthly)}/m</span><span class="fc-months muted">${c.months.map((m) => `${fmtMonthInline(m.month)} ${fmtEUR(m.amount)}`).join(" · ")}</span></li>`)}</ul>
        <div class="total-row"><span>Da mettere da parte ogni mese per coprirle</span><strong>${fmtEUR(accrual)}</strong></div>`
        : emptyState("Nessuna spesa irregolare", "Tasse, viaggi, assicurazioni e simili compaiono qui quando si concentrano in pochi mesi dell'anno.")}
      ${f.extras.length ? html`<h3 class="subhead">Mensilità extra (anno scorso)</h3><ul class="list compact">${f.extras.map((x) => html`<li class="fc-extra"><span>${fmtMonth(x.month)}</span><span class="amount pos">+${fmtEUR(x.amount)}</span></li>`)}</ul>` : ""}
      <p class="card-foot">Categorie con almeno 150 € negli ultimi 12 mesi, concentrati per il 70% in tre mesi o meno. Nella previsione le spese dell'anno scorso tornano alla stessa data.</p>
    </section>

    <section class="card span-6" aria-labelledby="h-fc-how">
      ${cardHead("Cosa entra nella previsione", "", "h-fc-how")}
      <div class="fc-options">
        <label class="check"><input type="checkbox" id="fc-annual" data-input="fc-annual"${raw(view.annual ? " checked" : "")}><span><strong>Spese annuali dell'anno scorso</strong><span class="muted">Tasse, viaggi e simili alla stessa data.</span></span></label>
        <label class="check"><input type="checkbox" id="fc-extras" data-input="fc-extras"${raw(view.extras ? " checked" : "")}><span><strong>Mensilità extra</strong><span class="muted">Tredicesima e quattordicesima, come l'anno scorso.</span></span></label>
        <label class="check"><input type="checkbox" id="fc-other" data-input="fc-other"${raw(view.other ? " checked" : "")}><span><strong>Entrate non regolari (media)</strong><span class="muted">${f.flows.otherIncome.byCategory.length ? f.flows.otherIncome.byCategory.map((c) => `${c.name} ${fmtEUR(c.amount)}`).join(", ") + " negli ultimi 12 mesi" : "Nessuna negli ultimi 12 mesi"}.</span></span></label>
      </div>
      <p class="card-foot">Sempre incluse: movimenti già registrati con data futura, operazioni programmate, rate automatiche, versamenti dei PAC, ricorrenze trovate nei movimenti (stipendio compreso), addebiti delle carte e la spesa media di tutti i giorni (ultimi ${f.flows.days} giorni).${f.notes.length ? " " + f.notes.join(" ") : ""}</p>
    </section>`;
}

// ---------- patrimonio netto ----------
function netWorthTab(app) {
  const { state, today } = app;
  const t = app.derived().totals;
  const nw = netWorth(t);
  const defs = cached(app, "proj-defaults", () => projectionDefaults(state, today));
  const saving = money(view.saving, defs.monthlySaving);
  const invest = money(view.invest, defs.monthlyInvest);
  const runs = projections(app, saving, invest, defs);
  const years = [1, 3, 5, 10, 20].filter((y) => y <= view.years);
  const main = runs[1].p;
  const loans = state.loans.filter((l) => toNum(l.remaining) > 0.005);
  return html`
    <section class="card span-8 hero" aria-labelledby="h-nw">
      <h2 class="card-label" id="h-nw">Patrimonio netto</h2>
      <p class="hero-value${nw.value < 0 ? " neg" : ""}">${fmtEUR(nw.value)}</p>
      <p class="hero-delta muted">Conti e investimenti meno carte e finanziamenti</p>
      <div class="chart" data-chart="nw-history"></div>
    </section>

    <section class="card span-4" aria-labelledby="h-nw-parts">
      ${cardHead("Di cosa è fatto", "", "h-nw-parts")}
      <dl class="facts stacked wrap">
        <div><dt>Conti (disponibile)</dt><dd>${fmtEUR(nw.liquidity)}</dd></div>
        <div><dt>Investimenti</dt><dd>${fmtEUR(nw.investments)}</dd></div>
        <div><dt>Carte di credito</dt><dd class="${nw.cards > 0.005 ? "neg" : nw.cards < -0.005 ? "pos" : ""}">${signed(-nw.cards)}</dd></div>
        <div><dt>Finanziamenti</dt><dd class="${nw.loans > 0.005 ? "neg" : ""}">${signed(-nw.loans)}</dd></div>
        <div><dt><strong>Patrimonio netto</strong></dt><dd class="${nw.value < 0 ? "neg" : "pos"}"><strong>${fmtEUR(nw.value)}</strong></dd></div>
      </dl>
    </section>

    <section class="card span-12" aria-labelledby="h-nw-proj">
      <div class="card-head"><h2 class="card-title" id="h-nw-proj">Proiezione</h2>
        <div class="seg seg-sm" role="group" aria-label="Anni della proiezione">${[5, 10, 20].map((y) => html`<button type="button" data-action="nw-years" data-value="${y}" aria-pressed="${view.years === y}">${y} anni</button>`)}</div></div>
      <div class="form-grid nw-inputs">
        <label class="field" for="nw-saving"><span class="field-label">Risparmio mensile (€)</span><input class="input num" id="nw-saving" data-input="nw-saving" inputmode="decimal" autocomplete="off" value="${view.saving}" placeholder="${fmtNum(defs.monthlySaving, 2, 2)}"><span class="field-hint">Entrate meno uscite, già al netto di rate e PAC. ${defs.months === 1 ? "Media dell'ultimo mese" : `Media degli ultimi ${defs.months} mesi`}: ${fmtEUR(defs.monthlySaving)}.</span></label>
        <label class="field" for="nw-invest"><span class="field-label">Versamenti mensili negli investimenti (€)</span><input class="input num" id="nw-invest" data-input="nw-invest" inputmode="decimal" autocomplete="off" value="${view.invest}" placeholder="${fmtNum(defs.monthlyInvest, 2, 2)}"><span class="field-hint">I PAC attivi oggi: ${fmtEUR(defs.monthlyInvest)} al mese.</span></label>
      </div>
      <div class="legend">${SCENARIOS.map((s) => html`<span><i class="key line" style="background:${s.color}"></i>${s.label}</span>`)}</div>
      <div class="chart" data-chart="nw-proj"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Rendimento degli investimenti</th>${years.map((y) => html`<th scope="col" class="num">${y === 1 ? "1 anno" : `${y} anni`}</th>`)}<th scope="col" class="num">Torna positivo</th></tr></thead>
        <tbody>${runs.map((r) => html`<tr><th scope="row">${r.label}</th>${years.map((y) => {
          const p = r.p.points[y * 12];
          return html`<td class="num ${p && p.value < 0 ? "neg" : ""}">${p ? fmtEUR(p.value) : "—"}</td>`;
        })}<td class="num">${nw.value >= 0 ? "già positivo" : r.p.positiveAt ? fmtMonthInline(r.p.positiveAt.slice(0, 7)) : `oltre ${view.years} anni`}</td></tr>`)}</tbody>
      </table></div>
      ${loans.length ? html`<p class="nw-debts">${main.debtsEnd.map((d) => html`<span>${d.name}: ${d.end ? `estinto a ${fmtMonthInline(d.end.slice(0, 7))}` : `non estinto entro ${view.years} anni`}</span>`)}</p>` : ""}
      <p class="card-foot">Ogni mese: il risparmio va sul conto, gli investimenti rendono e ricevono i versamenti, le rate riducono i debiti; quando un finanziamento finisce la sua rata resta in tasca.${defs.cashLoans.length ? ` Le rate di ${defs.cashLoans.map((id) => nameOf(state.loans, id)).join(", ")} non risultano tra le uscite passate e vengono tolte a parte.` : ""} Carte costanti. È uno scenario, non una previsione certa né una consulenza.</p>
    </section>`;
}

function projections(app, saving, invest, defs) {
  const t = app.derived().totals;
  return SCENARIOS.map((s) => ({
    ...s,
    p: cached(app, `proj:${s.rate}:${view.years}:${saving}:${invest}`, () => projectNetWorth({
      liquidity: t.liquidity, investments: t.investments, cards: t.cardsSpent, loans: app.state.loans,
      monthlySaving: saving, monthlyInvest: invest, annualReturn: s.rate, months: view.years * 12, startDate: app.today, cashLoans: defs.cashLoans,
    })),
  }));
}

// ---------- rate a pagamento ("Paga in 3", rateizzazioni) ----------
const ignoredPlans = (app) => (Array.isArray(app.state.settings.instalmentsIgnored) ? app.state.settings.instalmentsIgnored : []);
// Lo stesso id per "Ignora" e "Ripristina": dopo il clic il focus resta sul pulsante della stessa rata.
const toggleId = (p) => `inst-${p.key.replace(/[^a-z0-9]+/gi, "-")}`;

function instalmentsCard(app) {
  const { state, today } = app;
  const plans = instalmentsFor(app);
  const keys = ignoredPlans(app);
  const open = plans.filter((p) => p.open);
  const todo = open.filter((p) => !planIgnored(p, keys));
  const skipped = open.filter((p) => planIgnored(p, keys));
  const yearAgo = addMonths(today, -12);
  const closed = plans.filter((p) => !p.open && p.type === "bnpl" && p.last > yearAgo);
  const closedTotal = closed.reduce((s, p) => s + p.amount * p.paid, 0);
  const left = todo.reduce((s, p) => s + p.left, 0);
  const via = (p) => (p.cardId ? nameOf(state.creditCards, p.cardId) : nameOf(state.accounts, p.accountId));
  const row = (p) => {
    const covered = instalmentCovered(p, state.schedules);
    return html`<li class="row-block">
      <div class="row">
        <span class="avatar sq tone-${p.type === "tax" ? "orange" : "violet"}" aria-hidden="true">${icon(p.type === "tax" ? "file" : "card", 18)}</span>
        <span class="row-main"><span class="row-title"><span class="clip">${p.label}</span>${covered ? badge("programmata", "subtle") : ""}</span>
          <span class="row-sub">${p.type === "tax" ? `${p.paid} rate pagate ${onDate("da", p.first, fmtDayMonth)}` : `${p.paid} di ${p.total} rate pagate`} · ${via(p)} · ${p.next > today ? `prossima ${fmtDayMonth(p.next)}` : "prossima attesa, non ancora registrata"}</span></span>
        <span class="row-end"><span class="amount out">${fmtEUR(p.amount)}</span><span class="row-note">${p.type === "tax" ? "al mese" : `${fmtEUR(p.left)} da pagare`}</span></span>
      </div>
      ${covered ? "" : html`<div class="row-extra"><span class="muted">${p.type === "tax" ? "Quante rate restano non si sa: programmale indicando il numero." : "Programmandola, la rata rimasta viene registrata da sola ed entra nelle previsioni."}</span><span class="rec-actions"><button type="button" class="btn sm" data-action="inst-schedule" data-key="${p.key}">${icon("repeat", 16)} Programma<span class="sr-only"> ${p.label}</span></button>${planIgnored(p, keys) ? html`<button type="button" class="btn sm ghost" id="${toggleId(p)}" data-action="inst-restore" data-key="${p.key}">Ripristina<span class="sr-only"> ${p.label}</span></button>` : html`<button type="button" class="btn sm ghost" id="${toggleId(p)}" data-action="inst-ignore" data-key="${p.key}">Ignora<span class="sr-only"> ${p.label}</span></button>`}</span></div>`}
    </li>`;
  };
  return html`<section class="card span-12" aria-labelledby="h-db-inst">
    ${cardHead("Rate in corso: Paga in 3 e rateizzazioni", left > 0.005 ? html`<span class="muted">${fmtEUR(left)} ancora da pagare</span>` : "", "h-db-inst")}
    ${todo.length ? html`<ul class="list">${todo.map(row)}</ul>` : emptyState("Nessuna rata in corso", "Pagamenti a rate con PayPal, Klarna o Scalapay e rateizzazioni con l'Agenzia delle Entrate-Riscossione compaiono qui quando ne trovo almeno due.")}
    ${skipped.length ? html`<details class="table-toggle"${raw(view.instIgnoredOpen ? " open" : "")}><summary>Ignorate (${skipped.length})</summary><ul class="list">${skipped.map(row)}</ul></details>` : ""}
    <p class="card-foot">${closed.length ? `Negli ultimi 12 mesi ${closed.length === 1 ? "un acquisto a rate concluso" : `${closed.length} acquisti a rate conclusi`} per ${fmtEUR(closedTotal)}. ` : ""}Trovate nei movimenti: stesso importo ogni mese con PayPal, Klarna o Scalapay (al massimo tre volte), oppure versamenti simili all'Agenzia delle Entrate-Riscossione. Le rate rimaste pagate da un conto sono già nelle previsioni; quelle sulla carta arrivano con il suo addebito.</p>
  </section>`;
}

// ---------- debiti ----------
function debtsTab(app) {
  const { state, today } = app;
  const loans = state.loans.filter((l) => toNum(l.remaining) > 0.005);
  if (!loans.length) return html`${instalmentsCard(app)}<section class="card span-12">${emptyState("Nessun finanziamento in corso", "Aggiungi un finanziamento da Conti per vedere il piano delle rate.", html`<button type="button" class="btn sm primary" data-action="add" data-coll="loans">Aggiungi finanziamento</button>`)}</section>`;
  const sel = loans.find((l) => l.id === view.loan) || loans[0];
  const sim = simulateExtra(sel, today, { extraMonthly: money(view.extra, 0), lumpSum: money(view.lump, 0) });
  const withPay = loans.filter((l) => toNum(l.monthlyPayment) > 0);
  const strat = money(view.strat, 0);
  const plans = withPay.length >= 2 ? [
    { label: "Come oggi", p: payoffPlan(withPay, today, { extraMonthly: 0, rollover: false }) },
    { label: "Prima il tasso più alto", p: payoffPlan(withPay, today, { extraMonthly: strat, strategy: "avalanche" }) },
    { label: "Prima il debito più piccolo", p: payoffPlan(withPay, today, { extraMonthly: strat, strategy: "snowball" }) },
  ] : [];
  return html`
    ${loans.map((l) => {
      const plan = toNum(l.monthlyPayment) > 0 ? amortize(l, { startDate: firstInstallment(l, today) }) : null;
      const pct = loanProgress(l);
      return html`<section class="card span-6" aria-labelledby="h-db-${l.id}">
        ${cardHead(l.name || "Finanziamento", html`<button type="button" class="btn sm ghost" data-action="edit" data-coll="loans" data-id="${l.id}">${icon("pencil", 16)} Modifica</button>`, `h-db-${l.id}`)}
        <p class="stat-value">${fmtEUR(l.remaining)} <span class="stat-inline">residui</span></p>
        ${pct != null ? meter(pct, "ok", `${l.name || "Finanziamento"}: ${Math.round(pct)}% rimborsato`) : ""}
        <dl class="facts">
          <div><dt>Rata</dt><dd>${toNum(l.monthlyPayment) > 0 ? fmtEUR(l.monthlyPayment) : "—"}</dd></div>
          <div><dt>Tasso annuo</dt><dd>${toNum(l.rate) ? `${fmtNum(l.rate, 2, 2)}%` : "0%"}</dd></div>
          <div><dt>Ultima rata stimata</dt><dd>${plan && plan.end ? fmtMonthInline(plan.end.slice(0, 7)) : plan && plan.capped ? "oltre 50 anni" : plan && plan.endless ? "la rata non copre gli interessi" : "—"}</dd></div>
          <div><dt>Interessi ancora da pagare</dt><dd>${plan && Number.isFinite(plan.interest) ? fmtEUR(plan.interest) : "—"}</dd></div>
          <div><dt>Rate rimaste</dt><dd>${plan && Number.isFinite(plan.months) ? plan.months : "—"}</dd></div>
          <div><dt>Addebito automatico</dt><dd>${loanAutoPay(l) ? `sì, prossima ${fmtDayMonth(l.nextDate)}` : "no"}</dd></div>
        </dl>
        ${plan && plan.rows.length ? html`<details class="table-toggle"><summary>Piano delle rate</summary><div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Data</th><th scope="col" class="num">Rata</th><th scope="col" class="num">Interessi</th><th scope="col" class="num">Capitale</th><th scope="col" class="num">Debito residuo</th></tr></thead>
          <tbody>${plan.rows.map((r) => html`<tr><td>${fmtDate(r.date)}</td><td class="num">${fmtEUR(r.payment)}</td><td class="num">${fmtEUR(r.interest)}</td><td class="num">${fmtEUR(r.principal)}</td><td class="num">${fmtEUR(r.remaining)}</td></tr>`)}</tbody>
        </table></div></details>` : !plan ? html`<p class="form-note">Indica la rata mensile per vedere il piano.</p>` : ""}
      </section>`;
    })}

    ${instalmentsCard(app)}

    <section class="card span-12" aria-labelledby="h-db-sim">
      ${cardHead("E se versassi di più?", "", "h-db-sim")}
      <div class="form-grid three">
        <label class="field" for="db-loan"><span class="field-label">Finanziamento</span><select class="input" id="db-loan" data-input="db-loan">${loans.map((l) => html`<option value="${l.id}"${raw(l.id === sel.id ? " selected" : "")}>${l.name || "Finanziamento"}</option>`)}</select></label>
        <label class="field" for="db-extra"><span class="field-label">In più ogni mese (€)</span><input class="input num" id="db-extra" data-input="db-extra" inputmode="decimal" autocomplete="off" value="${view.extra}" placeholder="0"></label>
        <label class="field" for="db-lump"><span class="field-label">Una volta sola, subito (€)</span><input class="input num" id="db-lump" data-input="db-lump" inputmode="decimal" autocomplete="off" value="${view.lump}" placeholder="0"></label>
      </div>
      ${toNum(sel.monthlyPayment) > 0 ? html`<dl class="facts db-result">
        <div><dt>Fine del finanziamento</dt><dd>${sim.plan.end ? fmtMonthInline(sim.plan.end.slice(0, 7)) : sim.plan.months === 0 ? "subito, con il versamento" : "—"}${sim.monthsSaved && sim.base.end ? html` <span class="muted">invece di ${fmtMonthInline(sim.base.end.slice(0, 7))}</span>` : ""}</dd></div>
        <div><dt>Rate in meno</dt><dd>${sim.monthsSaved != null ? sim.monthsSaved : "—"}</dd></div>
        <div><dt>Interessi risparmiati</dt><dd class="${sim.interestSaved > 0 ? "pos" : ""}">${sim.interestSaved != null ? fmtEUR(sim.interestSaved) : "—"}</dd></div>
        <div><dt>Interessi totali</dt><dd>${Number.isFinite(sim.plan.interest) ? fmtEUR(sim.plan.interest) : "—"}</dd></div>
      </dl>` : html`<p class="form-note">Questo finanziamento non ha una rata mensile: indicala per simulare.</p>`}
      <p class="card-foot">Rata uguale, durata più corta; il versamento una tantum si conta subito. Calcolo indicativo, non una consulenza: penali e condizioni del rimborso anticipato dipendono dal contratto.</p>
    </section>

    ${plans.length ? html`<section class="card span-12" aria-labelledby="h-db-strat">
      ${cardHead("Più finanziamenti: quale prima?", "", "h-db-strat")}
      <div class="form-grid"><label class="field" for="db-strat"><span class="field-label">In più ogni mese, per tutti i finanziamenti (€)</span><input class="input num" id="db-strat" data-input="db-strat" inputmode="decimal" autocomplete="off" value="${view.strat}" placeholder="0"><span class="field-hint">Quando un finanziamento finisce, la sua rata si aggiunge all'extra per il successivo.</span></label></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Strategia</th><th scope="col" class="num">Tutto estinto</th><th scope="col" class="num">Interessi</th><th scope="col" class="hide-sm">Ordine di chiusura</th></tr></thead>
        <tbody>${plans.map((r) => html`<tr><th scope="row">${r.label}</th><td class="num">${r.p.end ? fmtMonthInline(r.p.end.slice(0, 7)) : "—"}</td><td class="num">${Number.isFinite(r.p.interest) ? fmtEUR(r.p.interest) : "—"}</td><td class="hide-sm">${[...r.p.debts].sort((a, b) => String(a.end || "9999").localeCompare(String(b.end || "9999"))).map((d) => `${d.name} (${d.end ? fmtMonthInline(d.end.slice(0, 7)) : "non si estingue"})`).join(" → ")}</td></tr>`)}</tbody>
      </table></div>
      <p class="card-foot">"Come oggi": ogni finanziamento con la sua rata. Nelle strategie, quando uno si chiude la sua rata (più l'extra) va a quello successivo. Se una rata non copre gli interessi quel finanziamento non si estingue e non c'è una data in cui tutto è chiuso. Confronto indicativo, a tassi e rate attuali.</p>
    </section>` : ""}`;
}

// Come per le ricorrenze: "Annulla" tocca solo la rata appena ignorata o ripristinata. Per una rateizzazione
// valgono anche le chiavi con un importo simile (vedi planMatchesKey), che il ripristino toglie tutte.
function setPlanIgnored(app, key, ignore) {
  const p = key && instalmentsFor(app).find((x) => x.key === key);
  if (!p) return;
  const write = (list) => app.commit([{ op: "merge", coll: "settings", id: "prefs", data: { instalmentsIgnored: list.slice(-200) } }]).catch(() => {});
  const others = (list) => list.filter((k) => !planMatchesKey(p, k));
  const cur = ignoredPlans(app);
  if (ignore === planIgnored(p, cur)) return;
  // Ignorata, la rata passa nell'elenco "Ignorate", che si apre per lasciarle il focus.
  if (ignore) view.instIgnoredOpen = true;
  write(ignore ? [...others(cur), p.key] : others(cur));
  toast(ignore ? "Rata ignorata" : "Rata ripristinata", {
    action: "Annulla",
    onAction: () => {
      const now = ignoredPlans(app);
      write(ignore ? others(now) : [...others(now), p.key]);
    },
  });
}

export default {
  id: "forecast",
  title: "Previsioni",
  render(app, route) {
    const key = route.params.get("tab") || "";
    if (route.changed || key !== view.routeKey) {
      view.routeKey = key;
      if (TABS.some(([k]) => k === key)) view.tab = key;
    }
    const alerts = alertsFor(app);
    const important = alerts.filter((a) => a.level !== "info");
    const tips = alerts.filter((a) => a.level === "info");
    return html`
      ${pageHead("Previsioni")}
      ${important.length ? html`<div class="alerts">${alertsList(important)}</div>` : ""}
      ${tips.length ? html`<details class="alerts-tips"><summary>${tips.length === 1 ? "1 suggerimento" : `${tips.length} suggerimenti`}</summary><div class="alerts">${alertsList(tips)}</div></details>` : ""}
      <div class="tabs" role="tablist" aria-label="Vista">${TABS.map(([k, l]) => html`<button type="button" role="tab" data-action="fc-tab" data-value="${k}" aria-selected="${view.tab === k}">${l}</button>`)}</div>
      <div class="grid">${view.tab === "patrimonio" ? netWorthTab(app) : view.tab === "debiti" ? debtsTab(app) : forecastTab(app)}</div>`;
  },

  mount(root, app) {
    const { state, today } = app;
    const t = app.derived().totals;
    const fc = root.querySelector('[data-chart="fc"]');
    if (fc) {
      const f = forecastFor(app, view.days, opts());
      const acc = view.chart !== "total" ? f.accounts.find((a) => a.id === view.chart) : null;
      const series = acc
        ? [{ name: acc.name, color: "var(--series-1)", points: acc.points, dashed: true }]
        : [
          { name: "Storico", color: "var(--series-1)", points: dailySeries(state.history, "liquidity", addDays(today, -30), today, t.liquidity), area: true },
          { name: "Previsione", color: "var(--series-1)", points: f.points, dashed: true },
        ];
      // Il riassunto per chi usa un lettore di schermo descrive la linea disegnata (il totale o il conto scelto).
      const src = acc ? { name: `${acc.name} (solo scadenze)`, start: acc.start, end: acc.end, min: acc.min } : { name: "Disponibile", start: f.start, end: f.endValue, min: f.min };
      multiLineChart(fc, { series, height: 240, xFormat: fmtDayMonth, tipDate: fmtDate, summary: `${src.name} previsto: oggi ${fmtEUR(src.start)}, fra ${view.days} giorni ${fmtEUR(src.end)}, minimo ${fmtEUR(src.min.value)} ${src.min.date === today ? "oggi" : onDate("il", src.min.date)}.` });
    }
    const nh = root.querySelector('[data-chart="nw-history"]');
    if (nh) {
      const nw = netWorth(t);
      multiLineChart(nh, { series: [{ name: "Patrimonio netto", color: "var(--series-1)", points: netWorthSeries(state.history, today, nw.value), area: true }], height: 200, xFormat: fmtDayMonth, tipDate: fmtDate, zero: false, emptyText: "Lo storico del patrimonio netto si costruisce giorno per giorno da quando usi l'app.", summary: `Patrimonio netto: ${fmtEUR(nw.value)}.` });
    }
    const np = root.querySelector('[data-chart="nw-proj"]');
    if (np) {
      const defs = cached(app, "proj-defaults", () => projectionDefaults(state, today));
      const runs = projections(app, money(view.saving, defs.monthlySaving), money(view.invest, defs.monthlyInvest), defs);
      const fmtYm = (d) => fmtMonthInline(d.slice(0, 7));
      multiLineChart(np, {
        series: runs.map((r) => ({ name: r.label, color: r.color, points: r.p.points.map((p) => ({ date: p.date, value: p.value })), muted: r.rate === 0 })),
        height: 260, xFormat: (d) => d.slice(0, 4), tipDate: fmtYm,
        summary: `Proiezione del patrimonio netto a ${view.years} anni: ${runs.map((r) => `${r.label} ${fmtEUR(r.p.points[r.p.points.length - 1].value)}`).join(", ")}.`,
      });
    }
  },

  actions: {
    "inst-schedule": (el, app) => {
      const p = instalmentsFor(app).find((x) => x.key === el.dataset.key);
      if (!p) return;
      const last = app.state.transactions.find((t) => t.id === p.txIds[p.txIds.length - 1]);
      const tax = p.type === "tax";
      const category = tax && app.state.categories.some((c) => c.name === "Tasse") ? "Tasse" : (last && last.category) || "Altro";
      openOperationForm(app, {
        mode: "Ricorrente",
        preset: {
          description: tax ? "Rateizzazione Agenzia delle Entrate-Riscossione" : `Rata ${p.provider}`, amount: numToInput(p.amount), category, recKind: "Uscita",
          payWith: p.cardId ? `card:${p.cardId}` : `account:${p.accountId}`, frequency: "Mensile", date: p.next > app.today ? p.next : app.today,
          endMode: "Numero di rate", endCount: tax ? "" : String(p.remaining || 1),
        },
      });
    },
    // Le scadenze dei prossimi 90 giorni in un file calendario, con un promemoria il giorno prima.
    "fc-ics": (el, app) => {
      const events = calendarEvents(forecastFor(app, 90), app.state, app.today);
      if (!events.length) { toast("Nessuna scadenza da mettere nel calendario"); return; }
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      downloadText(buildIcs(events, { stamp }), `scadenze-patrimonio-${app.today}.ics`, "text/calendar;charset=utf-8");
      toast(`${events.length === 1 ? "Una scadenza" : `${events.length} scadenze`} dei prossimi 90 giorni nel file: aprilo per aggiungerle al calendario (su Android importalo da calendar.google.com o con un'app che legge i file .ics)`, { timeout: 10000 });
    },
    "inst-ignore": (el, app) => setPlanIgnored(app, el.dataset.key, true),
    "inst-restore": (el, app) => setPlanIgnored(app, el.dataset.key, false),
    "fc-tab": (el, app) => { view.tab = el.dataset.value; app.rerender(); },
    "fc-days": (el, app) => { view.days = Number(el.dataset.value); app.rerender(); },
    "fc-all": (el, app) => { view.showAll = true; app.rerender(); },
    "nw-years": (el, app) => { view.years = Number(el.dataset.value); app.rerender(); },
  },

  onInput(name, value, app, el) {
    const map = { "fc-chart": "chart", "nw-saving": "saving", "nw-invest": "invest", "db-loan": "loan", "db-extra": "extra", "db-lump": "lump", "db-strat": "strat" };
    if (name === "fc-annual" || name === "fc-extras" || name === "fc-other") view[name.slice(3)] = !!el.checked;
    else if (map[name]) view[map[name]] = value;
    else return;
    app.rerender();
  },
};
