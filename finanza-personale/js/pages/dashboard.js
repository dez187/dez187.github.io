import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addDays, addMonthsYm, daysBetween, daysInMonth, monthOf } from "../lib/dates.js";
import { fmtDate, fmtDateLong, fmtDayMonth, fmtEUR, fmtNum, fmtPct, fmtSigned, onDate } from "../lib/format.js";
import { HOLDING_CLASSES, groupAccounts } from "../domain/finance.js";
import { cumulativeSpending, monthTotals } from "../domain/cashflow.js";
import { budgetMonth } from "../domain/budget.js";
import { pacIsDue } from "../domain/pac.js";
import { upcomingItems } from "../domain/upcoming.js";
import { sortGoals } from "../domain/goals.js";
import { goalCard } from "./goals.js";
import { areaChart, donutChart, lineChart } from "../ui/charts.js";
import { accountAvatar, balanceText, emptyState, meter, txRow } from "../ui/components.js";
import { netWorth } from "../domain/networth.js";
import { autonomy } from "../domain/forecast.js";
import { alertsFor, alertsList, cached, cardHead, deltaLine, forecastFor, greeting, kpi, monthLabel, monthPrep, rangeSwitch, seriesFor, upcomingRow } from "./shared.js";

const view = { range: "3M" };

function alerts(app) {
  const { state, today } = app;
  const out = [];
  const duePac = state.pac.filter((p) => pacIsDue(p, today));
  if (duePac.length) {
    out.push(html`<div class="alert">${icon("trend", 20)}<p><strong>${duePac.length === 1 ? "1 versamento" : `${duePac.length} versamenti`} dei piani di accumulo da registrare.</strong> Controlla importo e prezzo di esecuzione e registrali.</p><span class="alert-actions"><a class="btn sm" href="#/investimenti?sezione=pac">Vai ai piani</a></span></div>`);
  }
  const last = state.settings.lastPriceRefresh;
  const holdings = state.etf.length + state.stocks.length + state.crypto.length;
  if (holdings && state.settings.autoPrices === false && (!last || Date.now() - Date.parse(last) > 7 * 86400000)) {
    out.push(html`<div class="alert">${icon("refresh", 20)}<p><strong>Prezzi da aggiornare.</strong> ${last ? `Ultimo aggiornamento ${onDate("il", last.slice(0, 10))}.` : "Non sono mai stati aggiornati da qui."}</p><span class="alert-actions"><button type="button" class="btn sm" data-action="refresh-prices">Aggiorna</button></span></div>`);
  }
  // Promemoria del backup: ogni 30 giorni dall'ultimo scaricato (o dal primo utilizzo).
  const s = state.settings;
  const since = s.lastBackupAt ? s.lastBackupAt.slice(0, 10) : s.firstUseAt;
  const hasData = state.accounts.length + state.transactions.length > 0;
  if (hasData && since && daysBetween(since, today) >= 30 && (!s.backupSnoozeUntil || s.backupSnoozeUntil <= today)) {
    out.push(html`<div class="alert">${icon("download", 20)}<p><strong>È ora di un backup.</strong> ${s.lastBackupAt ? `L'ultimo l'hai scaricato ${onDate("il", since)}.` : "Non hai ancora scaricato un backup dei tuoi dati."} Conservalo in un posto sicuro, fuori da questo dispositivo.</p><span class="alert-actions"><button type="button" class="btn sm primary" data-action="export-json">Scarica</button><button type="button" class="btn sm ghost" data-action="snooze-backup">Più tardi</button></span></div>`);
  }
  // Avvisi delle previsioni: i più importanti qui, tutti nella pagina Previsioni.
  const plan = alertsFor(app).filter((a) => a.level !== "info");
  const shown = plan.slice(0, 3);
  return out.length || shown.length ? html`<div class="alerts">${alertsList(shown)}${plan.length > shown.length ? html`<a class="alerts-more" href="#/previsioni">${plan.length - shown.length === 1 ? "Un altro avviso" : `Altri ${plan.length - shown.length} avvisi`} nelle previsioni ${icon("chevronRight", 16)}</a>` : ""}${out}</div>` : "";
}

// Sotto il disponibile: mesi di autonomia e punto più basso previsto nei prossimi 30 giorni.
function planLine(app, t) {
  const { state, today } = app;
  const aut = cached(app, "autonomy", () => autonomy(t.liquidity, state.transactions, today));
  const f = forecastFor(app, 90);
  const limit = addDays(today, 30);
  const low = f.points.filter((p) => p.date > today && p.date <= limit).reduce((m, p) => (!m || p.value < m.value ? p : m), null);
  if (!state.accounts.length || (aut.months == null && !low)) return "";
  return html`<p class="hero-plan">${aut.months != null ? html`<span>Copre circa ${fmtNum(aut.months, 1, 1)} ${aut.months >= 0.95 && aut.months < 1.05 ? "mese" : "mesi"} di spese</span>` : ""}${low ? html`<span>nei prossimi 30 giorni minimo <strong class="${low.value < 0 ? "neg" : ""}">${fmtEUR(low.value)}</strong> ${onDate("il", low.date, fmtDayMonth)}</span>` : ""}<a class="card-link" href="#/previsioni">Previsioni ${icon("chevronRight", 16)}</a></p>`;
}

export default {
  id: "dashboard",
  title: "Panoramica",
  render(app) {
    const { state, today } = app;
    const t = app.derived().totals;
    const s = seriesFor(app, "liquidity", view.range, t.liquidity);
    const ym = monthOf(today);
    const prevYm = addMonthsYm(ym, -1);
    const month = monthTotals(state.transactions, ym);
    const day = Number(today.slice(8, 10));
    const thisCum = cumulativeSpending(state.transactions, ym, day);
    const prevCum = cumulativeSpending(state.transactions, prevYm);
    const prevSame = prevCum[Math.min(day, prevCum.length) - 1] || 0;
    const spentNow = thisCum[thisCum.length - 1] || 0;
    const inv = t.inv.total;
    const budget = budgetMonth(state.categories, state.transactions, ym, today);
    const budgetRows = budget.rows.filter((r) => r.budget > 0).sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, 5);
    const upcoming = upcomingItems(state, t, today).slice(0, 6);
    const recent = state.transactions.filter((x) => x.date <= today).slice(0, 6);
    const groups = groupAccounts(state.accounts);
    const name = app.session.firstName;

    return html`
      <header class="page-head">
        <div><p class="eyebrow">${fmtDateLong(today, today)}</p><h1>${greeting()}${name ? `, ${name}` : ""}</h1></div>
        <div class="head-actions"><button type="button" class="btn" data-action="refresh-prices">${icon("refresh", 18)}<span>Aggiorna prezzi</span></button></div>
      </header>
      ${alerts(app)}
      <div class="grid">
        <section class="card span-8 hero" aria-labelledby="h-available">
          <div class="card-head">
            <div>
              <h2 class="card-label" id="h-available">Disponibile</h2>
              <p class="hero-value">${fmtEUR(t.liquidity)}</p>
              <p class="hero-delta">${deltaLine(s.points, s.range)}</p>
              ${planLine(app, t)}
            </div>
            ${rangeSwitch("dash-range", view.range)}
          </div>
          <div class="chart" data-chart="liquidity"></div>
          <p class="card-foot">Somma dei saldi dei conti, aggiornati con i movimenti registrati. Investimenti, carte e finanziamenti sono a parte.</p>
        </section>

        <section class="card span-4" aria-labelledby="h-summary">
          ${cardHead("Riepilogo", "", "h-summary")}
          <div class="kpis">
            ${(() => { const nw = netWorth(t); return kpi({ label: "Patrimonio netto", value: fmtEUR(nw.value), tone: nw.value < 0 ? "neg" : "", href: "#/previsioni?tab=patrimonio", sub: `conti e investimenti ${fmtEUR(nw.assets)} · debiti ${fmtEUR(nw.debts)}` }); })()}
            ${kpi({ label: "Investimenti", value: fmtEUR(inv.value), href: "#/investimenti", sub: inv.cost > 0 ? html`<span class="${inv.gain >= 0 ? "pos" : "neg"}">${fmtSigned(inv.gain)} (${fmtPct(inv.gainPct, 1, true)})</span> sulle posizioni con prezzo di carico` : "Guadagno non stimabile: manca il prezzo di carico" })}
            ${kpi({ label: "Credito disponibile sulle carte", value: fmtEUR(t.creditAvailable), href: "#/conti", sub: `su ${fmtEUR(t.cardsLimit)} di massimale` })}
            ${kpi({ label: "Debiti residui", value: fmtEUR(t.debts), href: "#/conti", sub: `finanziamenti ${fmtEUR(t.loansDebt)} · carte ${fmtEUR(t.cardsSpent)}` })}
            ${kpi({ label: `Flusso di ${monthLabel(ym)}`, value: fmtSigned(month.net), tone: month.net >= 0 ? "pos" : "neg", href: "#/flusso", sub: `entrate ${fmtEUR(month.income)} · uscite ${fmtEUR(month.expense)}` })}
          </div>
        </section>

        <section class="card span-6" aria-labelledby="h-spending">
          ${cardHead(`Spese di ${monthLabel(ym)}`, html`<a class="card-link" href="#/flusso">Flusso di cassa ${icon("chevronRight", 16)}</a>`, "h-spending")}
          <p class="stat-value">${fmtEUR(spentNow)}</p>
          <p class="stat-sub">${prevCum[prevCum.length - 1] > 0
            ? `${fmtEUR(prevSame)} ${monthPrep(prevYm)} allo stesso giorno (${spentNow > prevSame ? `+${fmtEUR(spentNow - prevSame)}` : `${fmtEUR(prevSame - spentNow)} in meno`})`
            : `Nessuna spesa registrata ${monthPrep(prevYm)}`}</p>
          ${prevCum[prevCum.length - 1] > 0 ? html`<div class="legend"><span><i class="key line" style="background:var(--neg)"></i>${monthLabel(ym)}</span><span><i class="key line" style="background:var(--ink-3)"></i>${monthLabel(prevYm)}</span></div>` : ""}
          <div class="chart" data-chart="spending"></div>
        </section>

        <section class="card span-6" aria-labelledby="h-budget">
          ${cardHead(`Budget di ${monthLabel(ym)}`, html`<a class="card-link" href="#/budget">Budget ${icon("chevronRight", 16)}</a>`, "h-budget")}
          ${budgetRows.length
            ? html`<p class="stat-value">${fmtEUR(Math.max(0, budget.remaining))} <span class="stat-inline">rimasti su ${fmtEUR(budget.totalBudget)}</span></p>
              <ul class="list compact">${budgetRows.map((r) => html`<li class="budget-mini"><span class="bm-name">${r.emoji || "🏷️"} ${r.name}</span><span class="bm-val">${fmtEUR(r.spent)} <span class="muted">/ ${fmtEUR(r.budget)}</span></span>${meter(r.pct, r.status, `${r.name}: ${Math.round(r.pct)}% del budget`)}</li>`)}</ul>`
            : emptyState("Nessun budget impostato", "Imposta un tetto mensile per le categorie che vuoi tenere d'occhio.", html`<a class="btn sm" href="#/budget">Imposta budget</a>`)}
        </section>

        ${state.goals.length ? html`<section class="card span-12" aria-labelledby="h-goals">
          ${cardHead("Obiettivi", html`<a class="card-link" href="#/obiettivi">Tutti ${icon("chevronRight", 16)}</a>`, "h-goals")}
          <div class="goal-grid compact">${sortGoals(state.goals, t, today).slice(0, 3).map(({ goal, p }) => goalCard(app, goal, p, true))}</div>
        </section>` : ""}

        <section class="card span-6" aria-labelledby="h-recent">
          ${cardHead("Movimenti recenti", html`<a class="card-link" href="#/transazioni">Tutti ${icon("chevronRight", 16)}</a>`, "h-recent")}
          ${recent.length ? html`<div class="list">${recent.map((x) => txRow(x, state, { showDate: true, fmtDate: fmtDayMonth }))}</div>` : emptyState("Nessun movimento", "Registra la prima entrata o uscita.", html`<button type="button" class="btn sm primary" data-action="new-op">${icon("plus", 16)} Nuova operazione</button>`)}
        </section>

        <section class="card span-6" aria-labelledby="h-upcoming">
          ${cardHead("In arrivo", "", "h-upcoming")}
          ${upcoming.length ? html`<ul class="list">${upcoming.map((it) => upcomingRow(it, today))}</ul>` : emptyState("Niente in programma", "Spese ricorrenti, giroconti programmati, piani di accumulo e rinnovi delle carte compaiono qui.")}
        </section>

        <section class="card span-6" aria-labelledby="h-inv">
          ${cardHead("Investimenti", html`<a class="card-link" href="#/investimenti">Dettagli ${icon("chevronRight", 16)}</a>`, "h-inv")}
          ${inv.value > 0
            ? html`<div class="donut-wrap"><div class="chart donut" data-chart="allocation"></div>
                <ul class="legend-list">${HOLDING_CLASSES.map((c) => {
                  const cs = t.inv.byClass[c.key];
                  return html`<li><i class="key" style="background:var(--series-${c.series})"></i><span class="ll-name">${c.label}</span><span class="ll-val">${fmtEUR(cs.value)}</span><span class="ll-sub">${fmtPct(inv.value ? (cs.value / inv.value) * 100 : 0, 1)}${cs.cost > 0 ? html` · <span class="${cs.gain >= 0 ? "pos" : "neg"}">${fmtPct(cs.gainPct, 1, true)}</span>` : ""}</span></li>`;
                })}</ul></div>`
            : emptyState("Nessun investimento", "Aggiungi ETF, azioni o crypto per vederne l'andamento.", html`<a class="btn sm" href="#/investimenti">Vai agli investimenti</a>`)}
        </section>

        <section class="card span-6" aria-labelledby="h-accounts">
          ${cardHead("Conti", html`<a class="card-link" href="#/conti">Tutti ${icon("chevronRight", 16)}</a>`, "h-accounts")}
          ${groups.length
            ? html`<ul class="list">${groups.flatMap((g) => g.rows).map((a) => html`<li><button type="button" class="row" data-action="account-detail" data-coll="accounts" data-id="${a.id}">${accountAvatar(a)}<span class="row-main"><span class="row-title">${a.name}</span><span class="row-sub">${a.type || "Conto"}${a.balanceDate ? ` · saldo ${onDate("a", a.balanceDate, fmtDayMonth)}` : ""}</span></span>${balanceText(t.balances.get(a.id))}</button></li>`)}</ul>
              <div class="total-row"><span>Totale disponibile</span><strong>${fmtEUR(t.liquidity)}</strong></div>`
            : emptyState("Nessun conto", "Aggiungi il primo conto per iniziare.", html`<button type="button" class="btn sm primary" data-action="add" data-coll="accounts">Aggiungi conto</button>`)}
        </section>
      </div>`;
  },

  mount(root, app) {
    const { state, today } = app;
    const t = app.derived().totals;
    const s = seriesFor(app, "liquidity", view.range, t.liquidity);
    const liq = root.querySelector('[data-chart="liquidity"]');
    if (liq) areaChart(liq, {
      points: s.points, height: 230, xFormat: fmtDayMonth, tipDate: fmtDate, seriesLabel: "Disponibile",
      summary: `Andamento del disponibile ${s.range.name}: da ${fmtEUR(s.points[0]?.value)} a ${fmtEUR(t.liquidity)}.`,
      emptyText: "Il grafico si riempie giorno dopo giorno: ogni giorno in cui apri l'app viene salvata un'istantanea.",
    });
    const ym = monthOf(today);
    const prevYm = addMonthsYm(ym, -1);
    const day = Number(today.slice(8, 10));
    const sp = root.querySelector('[data-chart="spending"]');
    const prev = cumulativeSpending(state.transactions, prevYm);
    if (sp) lineChart(sp, {
      count: daysInMonth(ym), height: 170,
      series: [
        ...(prev[prev.length - 1] > 0 ? [{ name: monthLabel(prevYm), values: prev, color: "var(--ink-3)", muted: true }] : []),
        { name: monthLabel(ym), values: cumulativeSpending(state.transactions, ym, day), color: "var(--neg)", endDot: true },
      ],
      emptyText: `Nessuna spesa registrata ${monthPrep(ym)}.`,
      xLabel: (i) => String(i + 1),
      tipTitle: (i) => `Giorno ${i + 1}`,
      summary: `Spesa cumulata di ${monthLabel(ym)} confrontata con ${monthLabel(prevYm)}.`,
    });
    const al = root.querySelector('[data-chart="allocation"]');
    if (al) donutChart(al, {
      size: 168, centerLabel: "Investito",
      slices: HOLDING_CLASSES.map((c) => ({ label: c.label, value: t.inv.byClass[c.key].value, color: `var(--series-${c.series})` })),
      summary: `Ripartizione degli investimenti: ${HOLDING_CLASSES.map((c) => `${c.label} ${fmtEUR(t.inv.byClass[c.key].value)}`).join(", ")}.`,
    });
  },

  actions: {
    "dash-range": (el, app) => {
      view.range = el.dataset.value;
      app.rerender();
    },
  },
};
