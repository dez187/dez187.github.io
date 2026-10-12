import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addMonthsYm, monthOf } from "../lib/dates.js";
import { fmtDayMonth, fmtEUR, fmtMonth, fmtMonthShort, fmtPct, fmtSigned, toNum, MINUS } from "../lib/format.js";
import { flowItems, flowTotals, monthlySeries, sankeyModel } from "../domain/cashflow.js";
import { INVEST_CATEGORY } from "../domain/finance.js";
import { categoryFor } from "../domain/categories.js";
import { groupedBars, sankeyChart } from "../ui/charts.js";
import { emptyState, txRow } from "../ui/components.js";
import { openSheet } from "../ui/feedback.js";
import { cardHead, pageHead } from "./shared.js";

const view = { period: "mese", ym: null, year: null };

function range(today) {
  if (!view.ym) view.ym = monthOf(today);
  if (!view.year) view.year = Number(today.slice(0, 4));
  if (view.period === "anno") return { from: `${view.year}-01-01`, to: `${view.year}-12-31`, label: String(view.year), endYm: `${view.year}-12` };
  return { from: `${view.ym}-01`, to: `${view.ym}-31`, label: fmtMonth(view.ym), endYm: view.ym };
}

function breakdown(title, rows, total, categories, color, id, kind) {
  return html`<section class="card span-6" aria-labelledby="${id}">
    ${cardHead(title, html`<strong>${fmtEUR(total)}</strong>`, id)}
    ${rows.length ? html`<ul class="breakdown">${rows.map((r) => {
      const c = categoryFor(r.name, categories);
      const pct = total > 0 ? (r.amount / total) * 100 : 0;
      const tint = kind === "expense" && r.name === INVEST_CATEGORY ? "var(--inv)" : color;
      return html`<li><span class="bd-name"><button type="button" class="linklike bd-link" data-action="cf-detail" data-kind="${kind}" data-cat="${r.name}"><span class="bd-emoji" aria-hidden="true">${c.emoji || "🏷️"}</span><span class="bd-label">${r.name}</span></button></span><span class="bd-val">${fmtEUR(r.amount)}</span><span class="bd-bar" aria-hidden="true"><span style="width:${Math.max(1, pct).toFixed(1)}%;background:${tint}"></span></span><span class="bd-pct">${fmtPct(pct, 1)}</span></li>`;
    })}</ul>` : emptyState("Nessun movimento nel periodo")}
  </section>`;
}

const MAX_ROWS = 60;

// Dettaglio di una voce del flusso: i movimenti del periodo che la compongono (per le voci che ne
// raccolgono più d'una, divisi per categoria), oppure il conto di entrate e uscite per il risparmio.
function openFlowDetail(app, node, r) {
  const { state } = app;
  const tot = flowTotals(state.transactions, r.from, r.to);
  if (node.kind === "saving" || node.kind === "deficit") {
    openSheet({
      title: node.name,
      body: html`<p class="detail-value">${fmtEUR(node.amount)}</p>
        <dl class="facts">
          <div><dt>Periodo</dt><dd>${r.label}</dd></div>
          <div><dt>Tasso di risparmio</dt><dd>${tot.savingsRate == null ? "—" : fmtPct(tot.savingsRate, 1)}</dd></div>
          <div><dt>Entrate</dt><dd>${fmtEUR(tot.income)}</dd></div>
          <div><dt>Uscite</dt><dd>${fmtEUR(tot.expense)}</dd></div>
        </dl>
        <p class="card-foot">${node.kind === "saving" ? "È la parte delle entrate che non è stata spesa nel periodo." : "Le uscite hanno superato le entrate: la differenza è venuta dai soldi messi da parte."}</p>`,
    });
    return;
  }
  const income = node.kind === "income";
  const items = flowItems(state.transactions, r.from, r.to, income ? "income" : "expense", node.cats || [node.name]);
  const total = items.reduce((s, x) => s + x.amount, 0);
  const base = income ? tot.income : tot.expense;
  const cats = [...new Set(items.map((x) => x.cat))];
  const single = cats.length <= 1;
  const c = categoryFor(single ? cats[0] || node.name : "", state.categories);
  const rows = (list) => html`<div class="list">${list.slice(0, MAX_ROWS).map((x) => txRow(x.t, state, { showDate: true, fmtDate: fmtDayMonth }))}</div>${list.length > MAX_ROWS ? html`<p class="muted">e altri ${list.length - MAX_ROWS} movimenti: li trovi in Transazioni.</p>` : ""}`;
  const groups = single ? [] : cats.map((cat) => {
    const list = items.filter((x) => x.cat === cat);
    return { cat, list, total: list.reduce((s, x) => s + x.amount, 0) };
  }).sort((a, b) => b.total - a.total);
  const partial = !income && items.some((x) => x.amount < toNum(x.t.amount) - 0.005);
  openSheet({
    title: single && c.emoji ? `${c.emoji} ${node.name}` : node.name,
    wide: true,
    body: html`<p class="detail-value ${income ? "pos" : "neg"}">${income ? "+" : MINUS}${fmtEUR(total)}</p>
      <p class="muted">${r.label} · ${items.length === 1 ? "1 movimento" : `${items.length} movimenti`}${base > 0 ? ` · ${fmtPct((total / base) * 100, 1)} delle ${income ? "entrate" : "uscite"}` : ""}</p>
      ${!items.length ? emptyState("Nessun movimento nel periodo") : single ? rows(items) : groups.map((g) => html`<h3 class="subhead">${categoryFor(g.cat, state.categories).emoji || "🏷️"} ${g.cat} · ${fmtEUR(g.total)}</h3>${rows(g.list)}`)}
      ${partial ? html`<p class="card-foot">Degli addebiti delle carte nel flusso conta solo la parte non già registrata come spese sulla carta: qui vedi l'importo intero del movimento.</p>` : ""}`,
  });
}

export default {
  id: "cashflow",
  title: "Flusso di cassa",
  render(app) {
    const { state, today } = app;
    const r = range(today);
    const tot = flowTotals(state.transactions, r.from, r.to);
    const isCurrent = view.period === "anno" ? view.year === Number(today.slice(0, 4)) : view.ym === monthOf(today);
    return html`
      ${pageHead("Flusso di cassa", html`
        <div class="seg" role="group" aria-label="Periodo"><button type="button" data-action="cf-period" data-value="mese" aria-pressed="${view.period === "mese"}">Mensile</button><button type="button" data-action="cf-period" data-value="anno" aria-pressed="${view.period === "anno"}">Annuale</button></div>
        <div class="period-nav"><button type="button" class="icon-btn" data-action="cf-step" data-value="-1" aria-label="Periodo precedente">${icon("chevronLeft")}</button><span class="period-label" aria-live="polite">${r.label}</span><button type="button" class="icon-btn" data-action="cf-step" data-value="1" aria-label="Periodo successivo"${isCurrent ? " disabled" : ""}>${icon("chevronRight")}</button></div>`)}
      <div class="grid">
        <section class="card span-3 stat"><p class="stat-label">Entrate</p><p class="stat-value${tot.income > 0.004 ? " pos" : ""}">${tot.income > 0.004 ? "+" : ""}${fmtEUR(tot.income)}</p></section>
        <section class="card span-3 stat"><p class="stat-label">Uscite</p><p class="stat-value${tot.expense > 0.004 ? " neg" : ""}">${tot.expense > 0.004 ? MINUS : ""}${fmtEUR(tot.expense)}</p></section>
        <section class="card span-3 stat"><p class="stat-label">Risparmio</p><p class="stat-value ${tot.net >= 0 ? "pos" : "neg"}">${fmtSigned(tot.net)}</p></section>
        <section class="card span-3 stat"><p class="stat-label">Tasso di risparmio</p><p class="stat-value">${tot.savingsRate == null ? "—" : fmtPct(tot.savingsRate, 1)}</p>${tot.savingsRate == null ? html`<p class="stat-sub">Servono entrate registrate</p>` : ""}</section>

        <section class="card span-12" aria-labelledby="h-cf-sankey">
          ${cardHead(`Da dove arrivano e dove vanno i soldi · ${r.label}`, "", "h-cf-sankey")}
          <div class="chart" data-chart="cf-sankey"></div>
          ${tot.count ? html`<p class="card-foot">Tocca una voce per vedere i movimenti che la compongono.</p>` : ""}
        </section>

        <section class="card span-12" aria-labelledby="h-cf-bars">
          ${cardHead(view.period === "anno" ? `Mese per mese, ${view.year}` : "Ultimi 12 mesi", html`<div class="legend"><span><i class="key" style="background:var(--series-3)"></i>Entrate</span><span><i class="key" style="background:var(--neg)"></i>Uscite</span></div>`, "h-cf-bars")}
          <div class="chart" data-chart="cf-bars"></div>
          <details class="table-toggle"><summary>Mostra i dati in tabella</summary><div data-table="cf"></div></details>
        </section>

        ${breakdown("Uscite per categoria", tot.byExpense, tot.expense, state.categories, "var(--neg)", "h-cf-exp", "expense")}
        ${breakdown("Entrate per categoria", tot.byIncome, tot.income, state.categories, "var(--series-3)", "h-cf-inc", "income")}
      </div>`;
  },

  mount(root, app) {
    const { state, today } = app;
    const r = range(today);
    const series = monthlySeries(state.transactions, r.endYm, 12);
    const bars = root.querySelector('[data-chart="cf-bars"]');
    if (bars) groupedBars(bars, {
      groups: series.map((m) => ({
        key: m.ym, label: fmtMonthShort(m.ym), title: fmtMonth(m.ym),
        values: [{ name: "Entrate", value: m.income, color: "var(--series-3)" }, { name: "Uscite", value: m.expense, color: "var(--neg)" }],
        extra: [{ value: fmtSigned(m.net), label: "saldo" }],
      })),
      selected: view.period === "mese" ? view.ym : null,
      onSelect: (ym) => {
        if (ym > monthOf(today)) return;
        view.period = "mese";
        view.ym = ym;
        app.rerender();
      },
      summary: `Entrate e uscite degli ultimi 12 mesi fino a ${fmtMonth(r.endYm)}.`,
    });
    const table = root.querySelector('[data-table="cf"]');
    if (table) table.innerHTML = String(html`<table class="table"><thead><tr><th scope="col">Mese</th><th scope="col" class="num">Entrate</th><th scope="col" class="num">Uscite</th><th scope="col" class="num">Saldo</th></tr></thead><tbody>${series.map((m) => html`<tr><th scope="row">${fmtMonth(m.ym)}</th><td class="num">${fmtEUR(m.income)}</td><td class="num">${fmtEUR(m.expense)}</td><td class="num">${fmtSigned(m.net)}</td></tr>`)}</tbody></table>`);
    const sk = root.querySelector('[data-chart="cf-sankey"]');
    if (sk) {
      const tot = flowTotals(state.transactions, r.from, r.to);
      sankeyChart(sk, sankeyModel(tot), {
        colors: { income: "var(--series-3)", expense: "var(--neg)", invest: "var(--inv)", saving: "var(--series-1)", deficit: "var(--ink-3)" },
        summary: `Flusso di ${r.label}: entrate ${fmtEUR(tot.income)}, uscite ${fmtEUR(tot.expense)}. Con Invio si apre il dettaglio della voce evidenziata.`,
        onSelect: (node) => openFlowDetail(app, node, range(app.today)),
      });
    }
  },

  actions: {
    "cf-period": (el, app) => { view.period = el.dataset.value; app.rerender(); },
    "cf-detail": (el, app) => openFlowDetail(app, { kind: el.dataset.kind, name: el.dataset.cat, cats: [el.dataset.cat] }, range(app.today)),
    "cf-step": (el, app) => {
      const step = Number(el.dataset.value);
      if (view.period === "anno") view.year += step;
      else view.ym = addMonthsYm(view.ym, step);
      app.rerender();
    },
  },
};
