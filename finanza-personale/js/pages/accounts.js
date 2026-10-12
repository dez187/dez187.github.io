import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addMonths } from "../lib/dates.js";
import { formatIban, isValidIban, normalizeIban } from "../lib/iban.js";
import { fmtDate, fmtDayMonth, fmtEUR, fmtMonthInline, fmtNum, fmtPct, fmtRelative, fmtSigned, onDate, toNum } from "../lib/format.js";
import { HOLDING_CLASSES, groupAccounts, loanPayoff, loanProgress, nameOf } from "../domain/finance.js";
import { loanAutoPay, loanPayDay } from "../domain/loans.js";
import { areaChart } from "../ui/charts.js";
import { accountAvatar, badge, balanceText, emptyState, iconAvatar, meter, txRow } from "../ui/components.js";
import { openSheet } from "../ui/feedback.js";
import { cardHead, deltaLine, pageHead, rangeSwitch, seriesFor } from "./shared.js";

const view = { range: "3M" };

function shareRows(rows, total, tone) {
  return html`<ul class="share-list">${rows.map((r) => html`<li>
    <span class="share-name">${r.label}</span><span class="share-val">${fmtEUR(r.value)}</span>
    <span class="share-bar" aria-hidden="true"><span style="width:${total > 0 ? Math.max(1, (r.value / total) * 100).toFixed(1) : 0}%;background:${tone}"></span></span>
    <span class="share-pct">${fmtPct(total > 0 ? (r.value / total) * 100 : 0, 0)}</span>
  </li>`)}</ul>`;
}

// IBAN del conto a gruppi di quattro, selezionabile con un tocco, e il pulsante per copiarlo.
// status: spazio per l'esito della copia accanto al pulsante, per le finestre (lì le notifiche restano sotto).
// Un IBAN arrivato da un file e non valido si vede comunque, segnato "da verificare".
export function ibanLine(a, { label = true, status = false } = {}) {
  const iban = normalizeIban(a.iban);
  if (!iban) return "";
  return html`${label ? html`<span class="muted iban-label">IBAN</span> ` : ""}<span class="iban" translate="no">${formatIban(iban)}</span>${isValidIban(iban) ? "" : badge("da verificare", "warn")}<button type="button" class="btn sm ghost" data-action="copy-iban" data-id="${a.id}" aria-label="Copia l'IBAN di ${a.name || "questo conto"}" title="Copia l'IBAN">${icon("copy", 16)}<span class="copy-text">Copia</span></button>${status ? html`<span class="copy-status" role="status" data-copy-status></span>` : ""}`;
}

function accountRow(a, t, today) {
  const eff = t.balances.get(a.id) || 0;
  const diff = eff - toNum(a.balance);
  const stale = a.balanceDate && a.balanceDate < addMonths(today, -1);
  const iban = ibanLine(a);
  return html`<li class="row-block"><button type="button" class="row" data-action="account-detail" data-coll="accounts" data-id="${a.id}">
    ${accountAvatar(a)}
    <span class="row-main"><span class="row-title">${a.name || "Senza nome"}</span>
      <span class="row-sub">${[a.bank, a.balanceDate ? `saldo ${onDate("a", a.balanceDate, fmtDayMonth)}` : "saldo senza data"].filter(Boolean).join(" · ")}${stale ? html` ${badge("da aggiornare", "warn")}` : ""}</span></span>
    <span class="row-end">${balanceText(eff)}${Math.abs(diff) > 0.004 ? html`<span class="row-note">${fmtSigned(diff)} di movimenti</span>` : ""}</span>
  </button>${iban ? html`<div class="row-extra iban-line">${iban}</div>` : ""}</li>`;
}

function cardRow(c, t, today) {
  const info = t.cards.get(c.id) || { spent: 0, limit: 0, available: 0, pct: 0 };
  const status = info.pct > 100 ? "over" : info.pct >= 85 ? "warn" : "ok";
  const due = c.resetDate && c.resetDate <= today && info.spent > 0;
  return html`<li class="row-block">
    <button type="button" class="row" data-action="account-detail" data-coll="creditCards" data-id="${c.id}">
      ${iconAvatar("card", "violet")}
      <span class="row-main"><span class="row-title">${c.name || "Carta"}</span><span class="row-sub">${[c.issuer, c.network, c.resetDate ? `rinnovo ${fmtRelative(c.resetDate, today)}` : ""].filter(Boolean).join(" · ")}</span></span>
      <span class="row-end"><span class="amount">${fmtEUR(info.spent)}</span><span class="row-note">disponibili ${fmtEUR(info.available)}</span></span>
    </button>
    <div class="row-extra">${meter(info.pct, status, `${c.name}: ${Math.round(info.pct)}% del massimale usato`)}<span class="muted">${fmtNum(info.pct, 0)}% di ${fmtEUR(info.limit)}${info.pct > 100 ? " · oltre il massimale" : ""}</span>${due ? html`<button type="button" class="btn sm primary" data-action="settle-card" data-renew="1" data-id="${c.id}">Rinnova e registra l'addebito</button>` : html`<button type="button" class="btn sm ghost" data-action="settle-card" data-id="${c.id}">Addebito e rinnovo</button>`}</div>
  </li>`;
}

function loanRow(l, today) {
  const pct = loanProgress(l);
  const payoff = loanPayoff(l);
  const end = l.endDate ? fmtMonthInline(l.endDate) : payoff && Number.isFinite(payoff.months) ? fmtMonthInline(addMonths(today, payoff.months).slice(0, 7)) : "—";
  return html`<li class="row-block">
    <button type="button" class="row" data-action="account-detail" data-coll="loans" data-id="${l.id}">
      ${iconAvatar("percent", "orange")}
      <span class="row-main"><span class="row-title">${l.name || "Finanziamento"}</span><span class="row-sub">${[l.lender, l.monthlyPayment ? `${fmtEUR(l.monthlyPayment)} al mese` : "", l.rate ? `TAN ${fmtNum(l.rate, 2)}%` : "tasso 0%", loanAutoPay(l) && toNum(l.remaining) > 0 ? `rata ${fmtRelative(l.nextDate, today)}` : ""].filter(Boolean).join(" · ")}</span></span>
      <span class="row-end"><span class="amount">${fmtEUR(l.remaining)}</span><span class="row-note">fine ${end}</span></span>
    </button>
    ${pct != null ? html`<div class="row-extra">${meter(pct, "ok", `${l.name}: ${Math.round(pct)}% rimborsato`)}<span class="muted">${fmtNum(pct, 0)}% rimborsato di ${fmtEUR(l.principal)}</span></div>` : ""}
  </li>`;
}

function groupCard(title, total, body, action) {
  return html`<section class="card span-12 group-card">
    <div class="card-head"><h2 class="card-title">${title}</h2><div class="group-right"><strong class="group-total">${total}</strong>${action || ""}</div></div>
    ${body}
  </section>`;
}

export default {
  id: "accounts",
  title: "Conti",
  render(app) {
    const { state, today } = app;
    const t = app.derived().totals;
    const s = seriesFor(app, "liquidity", view.range, t.liquidity);
    const groups = groupAccounts(state.accounts);
    const assets = t.liquidity + t.investments;
    const liabilities = t.debts;
    return html`
      ${pageHead("Conti", html`<button type="button" class="btn" data-action="add" data-coll="creditCards">${icon("card", 18)}<span>Carta</span></button><button type="button" class="btn" data-action="add" data-coll="loans">${icon("percent", 18)}<span>Finanziamento</span></button><button type="button" class="btn primary" data-action="add" data-coll="accounts">${icon("plus", 18)}<span>Conto</span></button>`)}
      <div class="grid">
        <section class="card span-8 hero" aria-labelledby="h-acc-chart">
          <div class="card-head">
            <div><h2 class="card-label" id="h-acc-chart">Disponibile</h2><p class="hero-value">${fmtEUR(t.liquidity)}</p><p class="hero-delta">${deltaLine(s.points, s.range)}</p></div>
            ${rangeSwitch("acc-range", view.range)}
          </div>
          <div class="chart" data-chart="acc-liquidity"></div>
        </section>
        <section class="card span-4" aria-labelledby="h-acc-summary">
          ${cardHead("Riepilogo", "", "h-acc-summary")}
          <div class="summary-block">
            <div class="summary-head"><span>Attività</span><strong>${fmtEUR(assets)}</strong></div>
            ${shareRows([{ label: "Liquidità", value: Math.max(0, t.liquidity) }, { label: "Investimenti", value: t.investments }], Math.max(0, t.liquidity) + t.investments, "var(--series-1)")}
          </div>
          <div class="summary-block">
            <div class="summary-head"><span>Passività</span><strong>${fmtEUR(liabilities)}</strong></div>
            ${shareRows([{ label: "Carte di credito", value: t.cardsSpent }, { label: "Finanziamenti", value: t.loansDebt }], liabilities, "var(--neg)")}
          </div>
          <p class="card-foot">Il “Disponibile” conta solo i conti: investimenti e debiti sono mostrati a parte.</p>
        </section>

        ${groups.length
          ? groups.map((g) => groupCard(g.label, fmtEUR(g.rows.reduce((sum, a) => sum + (t.balances.get(a.id) || 0), 0)), html`<ul class="list">${g.rows.map((a) => accountRow(a, t, today))}</ul>`))
          : html`<section class="card span-12">${emptyState("Nessun conto", "Aggiungi conti correnti, conti deposito, contanti o carte prepagate.", html`<button type="button" class="btn primary sm" data-action="add" data-coll="accounts">Aggiungi conto</button>`)}</section>`}

        ${groupCard("Carte di credito", html`${fmtEUR(t.cardsSpent)} <span class="muted">spesi</span>`,
          state.creditCards.length ? html`<ul class="list">${state.creditCards.map((c) => cardRow(c, t, today))}</ul><div class="total-row"><span>Credito ancora disponibile</span><strong>${fmtEUR(t.creditAvailable)}</strong></div>` : emptyState("Nessuna carta", "Aggiungi una carta per seguire il massimale mensile.")) }

        ${groupCard("Finanziamenti", html`${fmtEUR(t.loansDebt)} <span class="muted">residui</span>`,
          state.loans.length ? html`<ul class="list">${state.loans.map((l) => loanRow(l, today))}</ul><div class="total-row"><span>Rate mensili</span><strong>${fmtEUR(t.loansMonthly)}</strong></div>` : emptyState("Nessun finanziamento", "Prestiti, mutui e finanziamenti in corso compaiono qui."))}

        ${groupCard("Investimenti", fmtEUR(t.investments), html`<ul class="list">${HOLDING_CLASSES.map((c) => {
          const cs = t.inv.byClass[c.key];
          return html`<li><a class="row" href="#/investimenti?classe=${c.key}">${iconAvatar(c.key === "crypto" ? "coins" : c.key === "etf" ? "layers" : "trend", c.key === "etf" ? "blue" : c.key === "stocks" ? "orange" : "aqua")}<span class="row-main"><span class="row-title">${c.label}</span><span class="row-sub">${cs.count} posizioni${cs.cost > 0 ? html` · <span class="${cs.gain >= 0 ? "pos" : "neg"}">${fmtSigned(cs.gain)}</span>` : ""}</span></span><span class="amount">${fmtEUR(cs.value)}</span></a></li>`;
        })}</ul>`)}
      </div>`;
  },

  mount(root, app) {
    const t = app.derived().totals;
    const s = seriesFor(app, "liquidity", view.range, t.liquidity);
    const el = root.querySelector('[data-chart="acc-liquidity"]');
    if (el) areaChart(el, { points: s.points, height: 220, xFormat: fmtDayMonth, tipDate: fmtDate, seriesLabel: "Disponibile", summary: `Andamento del disponibile ${s.range.name}.` });
  },

  actions: {
    "acc-range": (el, app) => {
      view.range = el.dataset.value;
      app.rerender();
    },
  },
};

// Scheda di dettaglio di un conto, di una carta o di un finanziamento.
export function openAccountDetail(app, coll, id) {
  const doc = app.store.find(coll, id);
  if (!doc) return;
  const { state, today } = app;
  const t = app.derived().totals;
  let body;
  if (coll === "accounts") {
    const eff = t.balances.get(id) || 0;
    const related = state.transactions.filter((x) => x.accountId === id || x.fromAccountId === id || x.toAccountId === id);
    const after = related.filter((x) => x.date > (doc.balanceDate || "") && x.date <= today);
    body = html`
      <p class="detail-value">${fmtEUR(eff)}</p>
      <dl class="facts">
        <div><dt>Tipo</dt><dd>${doc.type || "—"}</dd></div>
        <div><dt>Banca</dt><dd>${doc.bank || "—"}</dd></div>
        ${normalizeIban(doc.iban) ? html`<div class="fact-wide"><dt>IBAN</dt><dd class="iban-line">${ibanLine(doc, { label: false, status: true })}</dd></div>` : ""}
        <div><dt>Saldo registrato</dt><dd>${fmtEUR(doc.balance)}${doc.balanceDate ? ` ${onDate("a", doc.balanceDate)}` : ""}</dd></div>
        <div><dt>Movimenti successivi</dt><dd>${after.length} · ${fmtSigned(eff - toNum(doc.balance))}</dd></div>
      </dl>
      ${doc.note ? html`<p class="note">${doc.note}</p>` : ""}
      <h3 class="subhead">Ultimi movimenti</h3>
      ${related.length ? html`<div class="list">${related.slice(0, 12).map((x) => txRow(x, state, { showDate: true, fmtDate: fmtDayMonth }))}</div>` : emptyState("Nessun movimento su questo conto")}`;
  } else if (coll === "creditCards") {
    const info = t.cards.get(id);
    const related = state.transactions.filter((x) => x.cardId === id || x.cardPaymentFor === id || x.fromCardId === id || x.toCardId === id);
    body = html`
      <p class="detail-value">${fmtEUR(info.spent)} <span class="muted">di ${fmtEUR(info.limit)}</span></p>
      ${meter(info.pct, info.pct > 100 ? "over" : info.pct >= 85 ? "warn" : "ok", "Massimale usato")}
      <dl class="facts">
        <div><dt>Disponibile</dt><dd>${fmtEUR(info.available)}</dd></div>
        <div><dt>Speso registrato</dt><dd>${fmtEUR(doc.spent)}${doc.spentDate ? ` ${onDate("a", doc.spentDate)}` : ""}</dd></div>
        <div><dt>Rinnovo plafond</dt><dd>${doc.resetDate ? fmtDate(doc.resetDate) : "—"}</dd></div>
        <div><dt>Circuito</dt><dd>${doc.network || "—"}</dd></div>
      </dl>
      <h3 class="subhead">Addebiti sulla carta</h3>
      ${related.length ? html`<div class="list">${related.slice(0, 12).map((x) => txRow(x, state, { showDate: true, fmtDate: fmtDayMonth }))}</div>` : emptyState("Nessun addebito registrato sulla carta")}`;
  } else {
    const pct = loanProgress(doc);
    const payoff = loanPayoff(doc);
    const auto = loanAutoPay(doc) && toNum(doc.remaining) > 0;
    const paid = state.transactions.filter((x) => x.loanId === id);
    body = html`
      <p class="detail-value">${fmtEUR(doc.remaining)} <span class="muted">residui</span></p>
      ${pct != null ? meter(pct, "ok", "Quota rimborsata") : ""}
      <dl class="facts">
        <div><dt>Capitale iniziale</dt><dd>${doc.principal ? fmtEUR(doc.principal) : "—"}</dd></div>
        <div><dt>Rata mensile</dt><dd>${doc.monthlyPayment ? fmtEUR(doc.monthlyPayment) : "—"}</dd></div>
        <div><dt>Tasso annuo</dt><dd>${doc.rate ? `${fmtNum(doc.rate, 2)}%` : "0%"}</dd></div>
        <div><dt>Ultima rata</dt><dd>${doc.endDate ? fmtMonthInline(doc.endDate) : "—"}</dd></div>
        ${payoff && Number.isFinite(payoff.months) ? html`<div><dt>Rate residue stimate</dt><dd>${payoff.months}</dd></div><div><dt>Interessi residui stimati</dt><dd>${fmtEUR(payoff.interest)}</dd></div>` : ""}
        <div><dt>Addebito della rata</dt><dd>${auto ? `giorno ${loanPayDay(doc)} di ogni mese su ${nameOf(state.accounts, doc.accountId)}` : "non automatico"}</dd></div>
        <div><dt>Prossima rata</dt><dd>${auto ? fmtDate(doc.nextDate) : "—"}</dd></div>
      </dl>
      <p class="card-foot">${auto ? "Alla scadenza l'app registra la rata sul conto e scala la quota capitale dal debito residuo." : "Per far registrare la rata in automatico indica il conto di addebito e la data della prossima rata (Modifica)."} La stima usa debito residuo, tasso e rata attuali, con rata costante.</p>
      ${paid.length ? html`<h3 class="subhead">Rate registrate</h3><div class="list">${paid.slice(0, 12).map((x) => txRow(x, state, { showDate: true, fmtDate: fmtDayMonth }))}</div>` : ""}`;
  }
  const dlg = openSheet({
    title: doc.name || "Dettaglio",
    wide: true,
    body,
    footer: html`${coll === "accounts" ? html`<a class="btn ghost" href="#/transazioni?conto=${id}" data-sheet-close>${icon("list", 18)} Movimenti</a><button type="button" class="btn ghost" data-action="import-csv" data-target="account:${id}">${icon("upload", 18)} Importa estratto</button>` : ""}${coll === "creditCards" ? html`<button type="button" class="btn ghost" data-action="settle-card" data-id="${id}">${icon("card", 18)} Addebito e rinnovo</button><button type="button" class="btn ghost" data-action="import-csv" data-target="card:${id}">${icon("upload", 18)} Importa estratto</button>` : ""}<span class="spacer"></span><button type="button" class="btn primary" data-edit>${icon("pencil", 18)} Modifica</button>`,
  });
  dlg.querySelector("[data-edit]").addEventListener("click", () => {
    dlg.close();
    app.openEntity(coll, id);
  });
}
