import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addDays, addMonths, addMonthsYm, daysInMonth, pad2 } from "../lib/dates.js";
import { fmtDate, fmtDayHeader, fmtDayMonth, fmtEUR, fmtMonth, fmtSigned, numToInput, onDate, toNum, MINUS } from "../lib/format.js";

const onDateText = (d) => onDate("il", d, fmtDayMonth);
import { txRoute, txTone, nameOf } from "../domain/finance.js";
import { cardPaymentShares, isRepayment, ownCost } from "../domain/cashflow.js";
import { monthlyEquivalent, nextOccurrence, scheduleEndText, scheduleKind } from "../domain/schedules.js";
import { coveredBy, topMerchants } from "../domain/recurring.js";
import { LOAN_CATEGORY, loanAutoPay } from "../domain/loans.js";
import { accountOptions, badge, categoryAvatar, emptyState, iconAvatar, txRow } from "../ui/components.js";
import { toast } from "../ui/feedback.js";
import { openOperationForm } from "../ui/operation.js";
import { cached, cardHead, pageHead, recurringFor } from "./shared.js";

const view = { tab: "movimenti", q: "", month: "all", account: "", category: "", kind: "all", limit: 150, routeKey: "" };
const KINDS = [["all", "Tutti"], ["Uscita", "Uscite"], ["Entrata", "Entrate"], ["Giroconto", "Giroconti"]];

function matches(t, state) {
  if (view.month !== "all" && (t.date || "").slice(0, 7) !== view.month) return false;
  if (view.kind !== "all" && t.kind !== view.kind) return false;
  if (view.category && (t.category || "Altro") !== view.category) return false;
  if (view.account) {
    const [type, id] = view.account.split(":");
    if (type === "card" ? t.cardId !== id && t.cardPaymentFor !== id && t.fromCardId !== id && t.toCardId !== id : t.accountId !== id && t.fromAccountId !== id && t.toAccountId !== id) return false;
  }
  if (view.q) {
    const hay = [t.description, t.category, t.note, t.person, t.tag, txRoute(t, state), String(t.amount).replace(".", ",")].join(" ").toLowerCase();
    if (!view.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}

// "shares" va calcolato su tutti i movimenti, non solo su quelli filtrati.
// Come in Flusso di cassa: le restituzioni non sono entrate e delle spese conta solo la parte tua.
function summaryCard(rows, shares) {
  let income = 0, expense = 0, nExp = 0, largest = null, largestAmt = 0;
  for (const t of rows) {
    if (t.kind === "Entrata") { if (!isRepayment(t)) income += toNum(t.amount); }
    else if (t.kind === "Uscita") {
      const a = ownCost(t, shares);
      if (a < 0.005) continue;
      expense += a;
      nExp++;
      if (!largest || a > largestAmt) { largest = t; largestAmt = a; }
    }
  }
  return html`<section class="card span-4 sticky-card" aria-labelledby="h-tx-sum">
    ${cardHead("Riepilogo", "", "h-tx-sum")}
    <dl class="facts stacked">
      <div><dt>Entrate</dt><dd class="${income > 0.004 ? "pos" : ""}">${income > 0.004 ? "+" : ""}${fmtEUR(income)}</dd></div>
      <div><dt>Uscite</dt><dd class="${expense > 0.004 ? "neg" : ""}">${expense > 0.004 ? MINUS : ""}${fmtEUR(expense)}</dd></div>
      <div><dt>Saldo del periodo</dt><dd>${fmtSigned(income - expense)}</dd></div>
      <div><dt>Movimenti</dt><dd>${rows.length}</dd></div>
      <div><dt>Spesa media</dt><dd>${nExp ? fmtEUR(expense / nExp) : "—"}</dd></div>
      <div><dt>Spesa più alta</dt><dd>${largest ? html`${fmtEUR(largestAmt)} <span class="muted">· ${largest.description}</span>` : "—"}</dd></div>
    </dl>
    <p class="card-foot">I giroconti spostano denaro tra i tuoi conti e non sono contati come entrate o uscite. Degli addebiti delle carte si conta solo la parte non già registrata come spese sulla carta. Le parti che altri ti devono restituire e le loro restituzioni non contano (vedi Persone e viaggi).</p>
  </section>`;
}

function listCard(rows, state, today) {
  if (!rows.length) {
    const filtered = view.q || view.month !== "all" || view.account || view.category || view.kind !== "all";
    return html`<section class="card span-8">${filtered ? emptyState("Nessun movimento corrisponde ai filtri", "", html`<button type="button" class="btn sm" data-action="tx-clear">Azzera filtri</button>`) : emptyState("Nessun movimento", "Registra la prima entrata, uscita o giroconto.", html`<button type="button" class="btn sm primary" data-action="new-op">${icon("plus", 16)} Nuova operazione</button>`)}</section>`;
  }
  const shown = rows.slice(0, view.limit);
  const days = [];
  for (const t of shown) {
    const last = days[days.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else days.push({ date: t.date, items: [t] });
  }
  return html`<section class="card span-8 tx-card" aria-label="Elenco movimenti">
    ${days.map((d) => {
      const net = d.items.reduce((s, t) => s + (t.kind === "Entrata" ? 1 : t.kind === "Uscita" ? -1 : 0) * toNum(t.amount), 0);
      return html`<div class="day-group"><h3 class="day-head"><span>${fmtDayHeader(d.date, today)}${d.date > today ? html` ${badge("futuro", "subtle")}` : ""}</span><span class="day-net">${Math.abs(net) > 0.004 ? fmtSigned(net) : ""}</span></h3>
        <div class="list">${d.items.map((t) => txRow(t, state))}</div></div>`;
    })}
    ${rows.length > shown.length ? html`<div class="more"><button type="button" class="btn" data-action="tx-more">Mostra altri ${Math.min(150, rows.length - shown.length)} movimenti</button></div>` : ""}
  </section>`;
}

function schedulesView(app) {
  const { state, today } = app;
  const list = state.schedules;
  const active = list.filter((s) => s.status !== "Concluso");
  const monthlyOut = active.filter((s) => s.type === "expense" && s.status !== "In pausa").reduce((sum, s) => sum + monthlyEquivalent(s), 0);
  const monthlyIn = active.filter((s) => s.type === "income" && s.status !== "In pausa").reduce((sum, s) => sum + monthlyEquivalent(s), 0);
  const where = (s) => {
    if (s.type === "transfer") return `${nameOf(state.accounts, s.fromAccountId)} → ${nameOf(state.accounts, s.toAccountId)}`;
    const p = String(s.payWith || "");
    return p.startsWith("card:") ? nameOf(state.creditCards, p.slice(5)) : nameOf(state.accounts, p.slice(8));
  };
  return html`<div class="grid">
    <section class="card span-8" aria-label="Operazioni programmate">
      ${list.length ? html`<ul class="list">${list.map((s) => {
        const kindLabel = s.type === "transfer" ? "Giroconto" : s.type === "income" ? "Entrata ricorrente" : "Spesa ricorrente";
        const paused = s.status === "In pausa", ended = s.status === "Concluso";
        const amount = s.type === "income" ? "+" + fmtEUR(s.amount) : s.type === "transfer" ? fmtEUR(s.amount) : MINUS + fmtEUR(s.amount);
        return html`<li class="row-block${ended ? " ended" : ""}">
          <div class="row">
            ${iconAvatar(s.type === "transfer" ? "transfer" : "repeat", s.type === "income" ? "aqua" : s.type === "transfer" ? "neutral" : "blue")}
            <button type="button" class="row-main linklike" data-action="edit-schedule" data-id="${s.id}"><span class="row-title">${s.description || kindLabel} ${paused ? badge("in pausa", "warn") : ended ? badge("conclusa", "subtle") : ""}</span>
              <span class="row-sub">${kindLabel} · ${s.frequency} · ${where(s)}</span></button>
            <span class="row-end"><span class="amount ${txTone({ kind: scheduleKind(s), category: s.category })}">${amount}</span><span class="row-note">${ended ? "conclusa" : `prossima ${fmtDate(nextOccurrence(s))}`}</span></span>
          </div>
          <div class="row-extra"><span class="muted">${scheduleEndText(s)}</span>${ended ? "" : html`<button type="button" class="btn sm ghost" data-action="toggle-schedule" data-id="${s.id}">${icon(paused ? "play" : "pause", 16)} ${paused ? "Riprendi" : "Metti in pausa"}</button>`}</div>
        </li>`;
      })}</ul>` : emptyState("Nessuna operazione programmata", "Crea una spesa ricorrente, un'entrata ricorrente o un giroconto ripetuto dal pulsante “Nuova operazione”.", html`<button type="button" class="btn sm primary" data-action="new-op" data-mode="Ricorrente">${icon("plus", 16)} Nuova ricorrente</button>`)}
    </section>
    <section class="card span-4" aria-labelledby="h-sch-sum">
      ${cardHead("Ogni mese, in media", "", "h-sch-sum")}
      <dl class="facts stacked">
        <div><dt>Spese ricorrenti</dt><dd>${monthlyOut > 0.004 ? MINUS : ""}${fmtEUR(monthlyOut)}</dd></div>
        <div><dt>Entrate ricorrenti</dt><dd class="${monthlyIn > 0.004 ? "pos" : ""}">${monthlyIn > 0.004 ? "+" : ""}${fmtEUR(monthlyIn)}</dd></div>
        <div><dt>Attive</dt><dd>${active.filter((s) => s.status !== "In pausa").length}</dd></div>
      </dl>
      <p class="card-foot">Alla scadenza ogni operazione diventa un movimento, anche se l'app resta chiusa per un po': al primo avvio registra gli arretrati.</p>
    </section>
    ${foundView(app)}
  </div>`;
}

// Ricorrenti trovate nei movimenti: si possono trasformare in programmate (dal modulo, da confermare) o ignorare.
function foundView(app) {
  const { state, today } = app;
  const rec = recurringFor(app);
  const ignored = new Set(Array.isArray(state.settings.recurringIgnored) ? state.settings.recurringIgnored : []);
  const items = rec.map((r) => ({ r, cov: coveredBy(r, state.schedules, state.loans) }));
  const todo = items.filter((x) => !x.cov && !ignored.has(x.r.key));
  const covered = items.filter((x) => x.cov);
  const skipped = items.filter((x) => !x.cov && ignored.has(x.r.key));
  const out = rec.filter((r) => r.kind === "Uscita");
  const monthly = out.reduce((s, r) => s + r.monthly, 0);
  const via = (r) => (r.cardId ? nameOf(state.creditCards, r.cardId) : nameOf(state.accounts, r.accountId));
  const top = cached(app, "top-merchants", () => topMerchants(state.transactions, today));
  // Una rata ricorrente di un finanziamento si imposta nel finanziamento (rata automatica), non come programmata.
  const loanFor = (r) => r.kind === "Uscita" && r.category === LOAN_CATEGORY
    ? state.loans.find((l) => !loanAutoPay(l) && toNum(l.monthlyPayment) > 0 && Math.abs(toNum(l.monthlyPayment) - r.amount) <= Math.max(5, r.amount * 0.05)) : null;
  const action = (r) => {
    const loan = loanFor(r);
    return loan
      ? html`<button type="button" class="btn sm" data-action="edit" data-coll="loans" data-id="${loan.id}">${icon("percent", 16)} Imposta la rata di ${loan.name || "finanziamento"}</button>`
      : html`<button type="button" class="btn sm" data-action="rec-schedule" data-key="${r.key}">${icon("repeat", 16)} Programma</button>`;
  };
  const row = ({ r, cov }) => html`<li class="row-block">
    <div class="row">
      ${categoryAvatar(r.category, state.categories, r.kind)}
      <span class="row-main"><span class="row-title"><span class="clip">${r.label}</span>${r.change && r.kind === "Uscita" ? badge(r.change.to > r.change.from ? `aumentato da ${fmtEUR(r.change.from)}` : `sceso da ${fmtEUR(r.change.from)}`, r.change.to > r.change.from ? "warn" : "subtle") : ""}</span>
        <span class="row-sub">${r.frequency} · ${r.category} · ${via(r)} · ${r.count} volte, l'ultima ${fmtDayMonth(r.last)}</span></span>
      <span class="row-end"><span class="amount ${r.kind === "Entrata" ? "pos" : r.category === "Investimenti" ? "inv" : "out"}">${r.kind === "Entrata" ? "+" : MINUS}${fmtEUR(r.amount)}</span><span class="row-note">${fmtEUR(r.yearly)} all'anno</span></span>
    </div>
    ${cov ? "" : html`<div class="row-extra"><span class="muted">${r.next > today ? `prossima attesa ${fmtDayMonth(r.next)}` : `attesa ${onDateText(r.next)}, non ancora registrata`}</span><span class="rec-actions">${action(r)}<button type="button" class="btn sm ghost" data-action="rec-ignore" data-key="${r.key}">Ignora</button></span></div>`}
  </li>`;
  return html`<section class="card span-12" aria-labelledby="h-rec">
      ${cardHead("Trovate nei movimenti", html`<span class="muted">spese ricorrenti: ${fmtEUR(monthly)} al mese · ${fmtEUR(monthly * 12)} all'anno</span>`, "h-rec")}
      ${todo.length ? html`<ul class="list">${todo.map(row)}</ul>` : emptyState("Niente di nuovo", rec.length ? "Le ricorrenze trovate sono già programmate, automatiche o ignorate." : "Servono almeno tre pagamenti simili a intervalli regolari per riconoscere una ricorrenza.")}
      ${covered.length ? html`<details class="table-toggle"><summary>Già programmate o automatiche (${covered.length})</summary><ul class="list">${covered.map(row)}</ul></details>` : ""}
      ${skipped.length ? html`<details class="table-toggle"><summary>Ignorate (${skipped.length})</summary><ul class="list">${skipped.map(({ r }) => html`<li class="row static"><span class="row-main"><span class="row-title">${r.label}</span><span class="row-sub">${r.frequency} · ${fmtEUR(r.amount)}</span></span><button type="button" class="btn sm ghost" data-action="rec-restore" data-key="${r.key}">Ripristina</button></li>`)}</ul></details>` : ""}
      <p class="card-foot">Pagamenti dello stesso esercente (o entrate della stessa categoria) a intervalli regolari e di importo simile, negli ultimi 13 mesi. "Programma" apre il modulo già compilato: le ricorrenze programmate vengono registrate da sole ed entrano nelle previsioni.</p>
    </section>
    ${top.length ? html`<section class="card span-12" aria-labelledby="h-top">
      ${cardHead("Dove spendi più spesso", html`<span class="muted">ultimi 12 mesi</span>`, "h-top")}
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Esercente</th><th scope="col" class="hide-sm">Categoria</th><th scope="col" class="num">Pagamenti</th><th scope="col" class="num hide-sm">In media</th><th scope="col" class="num">Totale</th></tr></thead>
        <tbody>${top.map((m) => html`<tr><th scope="row">${m.label}</th><td class="hide-sm">${m.category}</td><td class="num">${m.count}</td><td class="num hide-sm">${fmtEUR(m.average)}</td><td class="num"><strong>${fmtEUR(m.total)}</strong></td></tr>`)}</tbody>
      </table></div>
    </section>` : ""}`;
}

// Prima data utile dopo oggi per una ricorrenza trovata: così la programmata non registra arretrati.
function firstFuture(r, today) {
  // Mensili, bimestrali e trimestrali: dal giorno tipico del mese (un pagamento del 31 resta il 31 anche se
  // la scadenza precedente cadeva in un mese più corto).
  const step = { Mensile: 1, Bimestrale: 2, Trimestrale: 3 }[r.frequency];
  if (step && r.dayOfMonth) {
    const at = (ym) => `${ym}-${pad2(Math.min(r.dayOfMonth, daysInMonth(ym)))}`;
    let ym = r.next.slice(0, 7), d = at(ym);
    for (let i = 0; i < 400 && d <= today; i++) { ym = addMonthsYm(ym, step); d = at(ym); }
    return d;
  }
  let d = r.next;
  for (let i = 0; i < 400 && d <= today; i++) d = step ? addMonths(d, step) : addDays(d, Math.round(r.period));
  return d;
}

// Annulla tocca solo la ricorrenza appena ignorata o ripristinata, partendo dall'elenco di adesso.
// Al massimo 200 chiavi, quante ne conserva un backup.
const ignoredNow = (app) => (Array.isArray(app.state.settings.recurringIgnored) ? app.state.settings.recurringIgnored : []);
const writeIgnored = (app, list) => app.commit([{ op: "merge", coll: "settings", id: "prefs", data: { recurringIgnored: list.slice(-200) } }]).catch(() => {});
function setIgnored(app, key, ignore) {
  const cur = ignoredNow(app);
  writeIgnored(app, ignore ? [...cur.filter((k) => k !== key), key] : cur.filter((k) => k !== key));
  toast(ignore ? "Ricorrenza ignorata" : "Ricorrenza ripristinata", {
    action: "Annulla",
    onAction: () => {
      const now = ignoredNow(app);
      writeIgnored(app, ignore ? now.filter((k) => k !== key) : [...now.filter((k) => k !== key), key]);
    },
  });
}

export default {
  id: "transactions",
  title: "Transazioni",
  render(app, route) {
    const { state, today } = app;
    const conto = route.params.get("conto");
    const vista = route.params.get("vista");
    const cerca = route.params.get("cerca");
    const key = `${conto || ""}|${vista || ""}|${cerca || ""}`;
    if (route.changed || key !== view.routeKey) {
      view.routeKey = key;
      // Da Persone e viaggi: i movimenti di una persona o di un viaggio.
      if (cerca) Object.assign(view, { tab: "movimenti", q: cerca.slice(0, 80), month: "all", account: "", category: "", kind: "all", limit: 150 });
      if (conto) Object.assign(view, { tab: "movimenti", q: "", month: "all", category: "", kind: "all", account: `${state.creditCards.some((c) => c.id === conto) ? "card" : "account"}:${conto}` });
      if (vista === "programmate") view.tab = "programmate";
    }
    const months = [...new Set(state.transactions.map((t) => (t.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    if (view.month !== "all" && !months.includes(view.month)) view.month = "all";
    const cats = [...new Set(state.transactions.map((t) => t.category || "Altro"))].sort((a, b) => a.localeCompare(b, "it"));
    const rows = view.tab === "movimenti" ? state.transactions.filter((t) => matches(t, state)) : [];
    const tabs = html`<div class="tabs" role="tablist" aria-label="Vista">
      <button type="button" role="tab" data-action="tx-tab" data-value="movimenti" aria-selected="${view.tab === "movimenti"}">Movimenti</button>
      <button type="button" role="tab" data-action="tx-tab" data-value="programmate" aria-selected="${view.tab === "programmate"}">Programmate <span class="count">${state.schedules.filter((s) => s.status !== "Concluso").length}</span></button>
    </div>`;
    return html`
      ${pageHead("Transazioni", html`<button type="button" class="btn" data-action="import-csv">${icon("upload", 18)}<span>Importa</span></button><button type="button" class="btn" data-action="export-csv">${icon("download", 18)}<span>CSV</span></button><button type="button" class="btn primary" data-action="new-op">${icon("plus", 18)}<span>Nuova operazione</span></button>`)}
      ${tabs}
      ${view.tab === "programmate" ? schedulesView(app) : html`
        <div class="filters" role="search">
          <label class="search"><span class="sr-only">Cerca nei movimenti</span>${icon("search", 18)}<input id="tx-q" type="search" placeholder="Cerca descrizione, categoria, importo…" value="${view.q}" data-input="q" autocomplete="off"></label>
          <label class="filter"><span class="sr-only">Mese</span><select id="tx-month" class="input" data-input="month"><option value="all">Tutti i mesi</option>${months.map((m) => html`<option value="${m}"${raw(m === view.month ? " selected" : "")}>${fmtMonth(m)}</option>`)}</select></label>
          <label class="filter"><span class="sr-only">Conto</span><select id="tx-account" class="input" data-input="account"><option value="">Tutti i conti</option>${accountOptions(state, view.account, { prefix: "account:", cards: true })}</select></label>
          <label class="filter"><span class="sr-only">Categoria</span><select id="tx-cat" class="input" data-input="category"><option value="">Tutte le categorie</option>${cats.map((c) => html`<option value="${c}"${raw(c === view.category ? " selected" : "")}>${c}</option>`)}</select></label>
          <div class="seg seg-sm" role="group" aria-label="Tipo">${KINDS.map(([v, l]) => html`<button type="button" data-action="tx-kind" data-value="${v}" aria-pressed="${view.kind === v}">${l}</button>`)}</div>
        </div>
        <div class="grid">${listCard(rows, state, today)}${summaryCard(rows, cardPaymentShares(state.transactions))}</div>`}`;
  },
  actions: {
    "tx-tab": (el, app) => { view.tab = el.dataset.value; app.rerender(); },
    "tx-kind": (el, app) => { view.kind = el.dataset.value; view.limit = 150; app.rerender(); },
    "tx-more": (el, app) => { view.limit += 150; app.rerender(); },
    "tx-clear": (el, app) => { Object.assign(view, { q: "", month: "all", account: "", category: "", kind: "all", limit: 150 }); app.rerender(); },
    "rec-schedule": (el, app) => {
      const r = recurringFor(app).find((x) => x.key === el.dataset.key);
      if (!r) return;
      openOperationForm(app, {
        mode: "Ricorrente",
        preset: {
          description: r.label, amount: numToInput(r.amount), category: r.category, recKind: r.kind,
          payWith: r.cardId ? `card:${r.cardId}` : `account:${r.accountId}`, frequency: r.frequency, date: firstFuture(r, app.today),
        },
      });
    },
    "rec-ignore": (el, app) => {
      if (!el.dataset.key || ignoredNow(app).includes(el.dataset.key)) return;
      setIgnored(app, el.dataset.key, true);
    },
    "rec-restore": (el, app) => {
      if (el.dataset.key) setIgnored(app, el.dataset.key, false);
    },
  },
  onInput(name, value, app) {
    if (!(name in view)) return;
    view[name] = value;
    view.limit = 150;
    app.rerender();
  },
};
