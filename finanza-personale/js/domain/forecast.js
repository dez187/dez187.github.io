import { addDays, addMonths, addMonthsYm, addPeriod, daysBetween, daysInMonth, monthOf, occurrenceDate, pad2 } from "../lib/dates.js";
import { onDate, round, toNum } from "../lib/format.js";
import { INVEST_CATEGORY, cardEffectiveSpent } from "./finance.js";
import { LOAN_CATEGORY, dueInstallments, loanAutoPay } from "./loans.js";
import { scheduleEnded } from "./schedules.js";
import { coveredBy, detectRecurring, extraIncome, merchantKey } from "./recurring.js";
import { cardPaymentShares, expenseAmount } from "./cashflow.js";
import { detectInstalments, instalmentCovered, instalmentDates, planIgnored } from "./instalments.js";

// Previsione del disponibile nei prossimi giorni. Solo calcolo, nessuna scrittura.
// Le scadenze note, conto per conto e senza contare nulla due volte:
//  - movimenti già registrati con data futura;
//  - operazioni programmate, rate automatiche dei finanziamenti, versamenti dei PAC;
//  - ricorrenze trovate nei movimenti (stipendio, abbonamenti pagati dal conto) non già programmate;
//  - rate rimaste dei "Paga in 3" e delle rateizzazioni trovate nei movimenti, se non già programmate;
//  - addebiti delle carte (dal ciclo della carta o dai pagamenti passati).
// Solo nel totale, perché non si sa su quale conto cadranno: la spesa quotidiana media (ultimi 90 giorni),
// le spese irregolari e le mensilità extra dell'anno scorso alla stessa data e, se richiesto, la media
// delle entrate non regolari degli ultimi 12 mesi.

export const LOOKBACK = 90;
export const SALES_CATEGORY = "Disinvestimenti";
// Tipi di scadenza che entrano anche nella previsione dei singoli conti.
export const ACCOUNT_KINDS = new Set(["tx", "transfer", "schedule", "income", "loan", "pac", "recurring", "card", "instalment"]);

const median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Pagamenti registrati di una carta: addebiti ("Addebito X") e giroconti verso la carta.
export function cardPayments(card, transactions) {
  return (transactions || [])
    .filter((t) => t.cardPaymentFor === card.id || (t.kind === "Giroconto" && t.toCardId === card.id))
    .map((t) => ({ id: t.id, date: t.date, amount: toNum(t.amount), accountId: t.cardPaymentFor ? t.accountId : t.fromAccountId, cycleTo: t.cycleTo || "" }))
    .filter((p) => p.date && p.accountId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Conto da cui si paga una carta: quello indicato nell'ultimo addebito registrato, altrimenti l'ultimo pagamento.
// Con accIds valgono solo i conti che esistono ancora (un conto eliminato non paga più niente).
export function cardPayAccount(card, transactions, accIds = null) {
  const ok = (id) => !!id && (!accIds || accIds.has(id));
  if (ok(card.payAccountId)) return card.payAccountId;
  const pays = cardPayments(card, transactions).filter((p) => ok(p.accountId));
  return pays.length ? pays[pays.length - 1].accountId : "";
}

// Categorie di spesa irregolari dell'ultimo anno: almeno 150 € concentrati per il 70% in tre mesi o meno.
export function irregularCategories(transactions, today, skipIds = new Set()) {
  const from = addDays(today, -365);
  const byCat = new Map();
  for (const t of transactions || []) {
    if (t.kind !== "Uscita" || !t.date || t.date <= from || t.date > today) continue;
    if (t.scheduleId || t.pacId || t.loanId || t.cardPaymentFor || skipIds.has(t.id)) continue;
    const name = t.category || "Altro";
    if (name === LOAN_CATEGORY || name === INVEST_CATEGORY) continue;
    const e = byCat.get(name) || { byMonth: new Map(), total: 0, tx: [] };
    const m = t.date.slice(0, 7);
    e.byMonth.set(m, (e.byMonth.get(m) || 0) + toNum(t.amount));
    e.total += toNum(t.amount);
    e.tx.push(t);
    byCat.set(name, e);
  }
  const out = [];
  for (const [name, e] of byCat) {
    if (e.total < 150) continue;
    const top3 = [...e.byMonth.values()].sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
    if (top3 < e.total * 0.7) continue;
    const months = [...e.byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, amount]) => ({ month, amount: round(amount, 2) }));
    out.push({ name, total: round(e.total, 2), monthly: round(e.total / 12, 2), months, tx: e.tx });
  }
  return out.sort((a, b) => b.total - a.total);
}

// Giorni su cui fare la media: al massimo "max", meno se i movimenti cominciano dopo (almeno 30).
function spanDays(transactions, today, max) {
  let first = today;
  for (const t of transactions || []) if (t.date && t.date < first) first = t.date;
  return Math.max(30, Math.min(max, daysBetween(first, today)));
}

// Spesa variabile media al giorno: pagata dai conti (esclusi ricorrenze, programmate, rate, PAC, investimenti,
// addebiti delle carte e categorie irregolari) e sulle carte (tutto tranne le categorie irregolari).
export function variableDaily(transactions, today, { recurringIds = new Set(), irregular = new Set() } = {}) {
  const days = spanDays(transactions, today, LOOKBACK);
  const from = addDays(today, -days);
  const byAccount = new Map(), byCard = new Map();
  const shares = cardPaymentShares(transactions || []);
  for (const t of transactions || []) {
    if (t.kind !== "Uscita" || !t.date || t.date <= from || t.date > today) continue;
    if (t.cardPaymentFor || irregular.has(t.category || "Altro")) continue;
    const a = expenseAmount(t, shares);
    if (t.cardId) {
      byCard.set(t.cardId, (byCard.get(t.cardId) || 0) + a);
      continue;
    }
    if (!t.accountId || t.scheduleId || t.pacId || t.loanId || recurringIds.has(t.id) || t.category === INVEST_CATEGORY || t.category === LOAN_CATEGORY) continue;
    byAccount.set(t.accountId, (byAccount.get(t.accountId) || 0) + a);
  }
  const per = (m) => new Map([...m].map(([k, v]) => [k, v / days]));
  return { days, byAccount: per(byAccount), byCard: per(byCard) };
}

// Entrate non regolari degli ultimi 12 mesi (contanti versati, rimborsi...): media al giorno. Restano fuori
// lo stipendio e le altre ricorrenze (già previste), le programmate e le vendite di investimenti.
export function irregularIncome(transactions, today, recurringIds = new Set()) {
  const days = spanDays(transactions, today, 365);
  const from = addDays(today, -days);
  let total = 0;
  const byCategory = new Map();
  for (const t of transactions || []) {
    if (t.kind !== "Entrata" || !t.date || t.date <= from || t.date > today) continue;
    if (t.scheduleId || recurringIds.has(t.id) || t.category === SALES_CATEGORY || !t.accountId) continue;
    const a = toNum(t.amount);
    total += a;
    const c = t.category || "Altre entrate";
    byCategory.set(c, (byCategory.get(c) || 0) + a);
  }
  return { days, daily: total / days, monthly: round((total / days) * 30.44, 2), byCategory: [...byCategory.entries()].map(([name, amount]) => ({ name, amount: round(amount, 2) })).sort((a, b) => b.amount - a.amount) };
}

// Mesi di autonomia: quanti mesi coprirebbe il disponibile con la spesa media degli ultimi 6 mesi interi
// (senza i versamenti negli investimenti, che si possono sospendere).
export function autonomy(liquidity, transactions, today) {
  const ym = monthOf(today);
  const from = `${addMonths(`${ym}-01`, -6).slice(0, 7)}-01`;
  const to = addDays(`${ym}-01`, -1);
  const shares = cardPaymentShares(transactions || []);
  let spent = 0, first = to;
  for (const t of transactions || []) {
    if (!t.date || t.date < from || t.date > to || t.kind !== "Uscita" || t.category === INVEST_CATEGORY || t.pacId) continue;
    spent += expenseAmount(t, shares);
    if (t.date < first) first = t.date;
  }
  const months = Math.max(1, Math.min(6, Math.round(daysBetween(first, to) / 30.44)));
  const monthly = spent / months;
  return { monthly: round(monthly, 2), months: monthly > 0 ? Math.max(0, liquidity) / monthly : null };
}

function cardDebitEvents(card, state, today, end, daily, futureTx, accIds = null) {
  const tx = state.transactions || [];
  const pays = cardPayments(card, tx);
  const accountId = cardPayAccount(card, tx, accIds);
  if (!accountId) return { events: [], note: `${card.name || "Carta"}: non so da quale conto viene pagata, il suo addebito non è nella previsione.` };
  const events = [];
  const label = `Addebito ${card.name || "carta"}`;
  // Pagamenti futuri senza periodo indicato: valgono per il primo addebito previsto.
  const futurePaid = futureTx.some((t) => (t.cardPaymentFor === card.id && !t.cycleTo) || (t.kind === "Giroconto" && t.toCardId === card.id));
  // Il mese che si chiude a "to" è già pagato: un addebito con quel periodo, o senza periodo ma dopo la chiusura.
  const paidFor = (to) => pays.some((p) => p.cycleTo === to || (!p.cycleTo && p.date > to));
  const spentToday = Math.max(0, cardEffectiveSpent(card, tx, today));
  if (card.resetDate) {
    const known = card.payDelayDays !== "" && card.payDelayDays != null && Number.isFinite(Number(card.payDelayDays)) ? Number(card.payDelayDays) : null;
    const seen = pays.filter((p) => p.cycleTo).map((p) => daysBetween(p.cycleTo, p.date)).filter((d) => d >= 0 && d <= 40);
    const delay = known != null ? known : seen.length ? Math.round(median(seen)) : 9;
    // Mese già chiuso col rinnovo ma addebito non ancora registrato (come nella finestra "Addebito e rinnovo"):
    // l'importo è lo speso alla chiusura. Se la data attesa è passata da più di 45 giorni non lo si inventa.
    let note = "";
    // Un pagamento futuro senza periodo copre un solo addebito: quello del mese chiuso, se manca ancora.
    const cs = card.cycleStart;
    const pendingByFuture = !!(cs && cs <= today && cs < card.resetDate && toNum(card.lastCycleSpent) > 0.005
      && !pays.some((p) => p.date <= today && (p.cycleTo === cs || (!p.cycleTo && p.date > cs))));
    if (card.cycleStart && card.cycleStart <= today && card.cycleStart < card.resetDate && card.lastCycleSpent != null && !paidFor(card.cycleStart)) {
      const pending = Math.max(0, toNum(card.lastCycleSpent));
      let date = addDays(card.cycleStart, delay);
      if (pending > 0.005 && date < addDays(today, -45)) note = `${card.name || "Carta"}: l'addebito del mese chiuso ${onDate("il", card.cycleStart)} non risulta registrato e non è nella previsione.`;
      else if (pending > 0.005) {
        if (date <= today) date = addDays(today, 1);
        if (date <= end) events.push({ date, accountId, amount: -round(pending, 2), label, kind: "card", estimated: false });
      }
    }
    let reset = card.resetDate;
    // Ciclo in corso: lo speso di oggi più la spesa media fino alla chiusura; poi un mese di spesa media per ciclo.
    let amount = reset <= today ? Math.max(0, cardEffectiveSpent(card, tx, reset)) : spentToday + daily * daysBetween(today, reset);
    let first = true;
    for (let k = 0; k < 24; k++) {
      let date = addDays(reset, delay);
      if (date <= today) date = addDays(today, 1);
      if (date > end) break;
      if (!(first && ((futurePaid && !pendingByFuture) || paidFor(reset))) && amount > 0.005) events.push({ date, accountId, amount: -round(amount, 2), label, kind: "card", estimated: !first || reset > today });
      const next = addMonths(reset, 1);
      amount = daily * daysBetween(reset, next);
      reset = next;
      first = false;
    }
    return { events, note };
  }
  // Carta senza ciclo (es. a saldo rateale): i pagamenti degli ultimi mesi, stesso giorno e importo tipico,
  // ma mai più del dovuto (lo speso di oggi più la spesa media sulla carta).
  // (il giorno e l'importo si ricavano dai pagamenti già fatti; uno futuro già registrato prende il posto del primo previsto)
  const recent = pays.filter((p) => p.date <= today && p.date > addDays(today, -190));
  if (recent.length < 2) return { events: [], note: `${card.name || "Carta"}: senza data di rinnovo e con pochi pagamenti registrati, il suo addebito non è nella previsione.` };
  const day = Math.round(median(recent.map((p) => Number(p.date.slice(8, 10)))));
  const typical = round(median(recent.map((p) => p.amount)), 2);
  let date = `${monthOf(addDays(recent[recent.length - 1].date, 20))}-${String(Math.min(day, 28)).padStart(2, "0")}`;
  while (date <= today) date = addMonths(date, 1);
  let paid = 0;
  for (let k = 0; k < 24 && date <= end; k++, date = addMonths(date, 1)) {
    if (k === 0 && futurePaid) continue;
    const owed = spentToday + daily * daysBetween(today, date) - paid;
    const amount = round(Math.min(typical, owed), 2);
    if (amount <= 0.005) break;
    events.push({ date, accountId, amount: -amount, label, kind: "card", estimated: true });
    paid += amount;
  }
  return { events, note: "" };
}

// opts: { days = 90, totals (saldi effettivi di oggi), recurring, includeAnnual = true, includeExtras = true,
//         includeIrregularIncome = true }
export function buildForecast(state, today, opts = {}) {
  const days = opts.days || 90;
  const end = addDays(today, days);
  const tx = state.transactions || [];
  const accounts = state.accounts || [];
  const accIds = new Set(accounts.map((a) => a.id));
  const startBal = new Map(accounts.map((a) => [a.id, toNum(opts.totals ? opts.totals.balances.get(a.id) : a.balance)]));
  const events = [];
  const notes = [];
  const add = (e) => { if (e.accountId && accIds.has(e.accountId) && e.date > today && e.date <= end && Math.abs(e.amount) > 0.004) events.push({ ...e, amount: round(e.amount, 2) }); };

  // 1. movimenti già registrati con data futura
  const futureTx = tx.filter((t) => t.date > today && t.date <= end);
  for (const t of futureTx) {
    const a = toNum(t.amount);
    if (t.kind === "Giroconto") {
      if (t.fromAccountId) add({ date: t.date, accountId: t.fromAccountId, amount: -a, label: t.description || "Giroconto", kind: "transfer" });
      if (t.toAccountId) add({ date: t.date, accountId: t.toAccountId, amount: a, label: t.description || "Giroconto", kind: "transfer" });
    } else if (t.accountId && !t.cardId) {
      add({ date: t.date, accountId: t.accountId, amount: t.kind === "Entrata" ? a : -a, label: t.description || t.category || "Movimento", kind: t.kind === "Entrata" ? "income" : "tx" });
    }
  }

  // 2. operazioni programmate (quelle su carta arrivano col suo addebito)
  for (const s of state.schedules || []) {
    if (!s.startDate || !s.frequency || s.status === "In pausa" || s.status === "Concluso") continue;
    const pay = String(s.payWith || "");
    for (let n = toNum(s.done), guard = 0; guard < 400; n++, guard++) {
      const date = occurrenceDate(s.startDate, s.frequency, n);
      if (date > end || scheduleEnded(s, n, date)) break;
      if (date <= today) continue;
      const a = toNum(s.amount);
      if (s.type === "transfer") {
        add({ date, accountId: s.fromAccountId, amount: -a, label: s.description || "Giroconto", kind: "transfer" });
        add({ date, accountId: s.toAccountId, amount: a, label: s.description || "Giroconto", kind: "transfer" });
      } else if (pay.startsWith("account:")) {
        add({ date, accountId: pay.slice(8), amount: s.type === "income" ? a : -a, label: s.description || "Operazione programmata", kind: s.type === "income" ? "income" : "schedule" });
      }
    }
  }

  // 3. rate automatiche dei finanziamenti
  for (const l of state.loans || []) {
    if (!loanAutoPay(l) || toNum(l.remaining) <= 0.005) continue;
    for (const it of dueInstallments(l, end).items) {
      if (it.date > today) add({ date: it.date, accountId: l.accountId, amount: -it.amount, label: `Rata ${l.name || "finanziamento"}`, kind: "loan" });
    }
  }

  // 4. versamenti dei PAC (quello già scaduto e non registrato conta domani)
  for (const p of state.pac || []) {
    if (p.status === "In pausa" || !p.nextDate || !p.accountId || !(toNum(p.amount) > 0)) continue;
    let date = p.nextDate;
    for (let guard = 0; guard < 120 && date <= end; guard++, date = addPeriod(date, p.frequency || "Mensile")) {
      add({ date: date <= today ? addDays(today, 1) : date, accountId: p.accountId, amount: -toNum(p.amount), label: p.name || "Piano di accumulo", kind: "pac" });
    }
  }

  // 5. ricorrenze trovate nei movimenti e non già coperte (le spese con carta passano dal suo addebito)
  const recurring = opts.recurring || detectRecurring(tx, today);
  const recurringIds = new Set();
  let salary = null;
  for (const r of recurring) {
    r.txIds.forEach((id) => recurringIds.add(id));
    if (r.kind === "Entrata" && r.category === "Stipendio" && (!salary || r.amount > salary.amount)) salary = r;
    const covered = coveredBy(r, state.schedules, state.loans);
    const pacCovered = r.kind === "Uscita" && r.category === INVEST_CATEGORY && (state.pac || []).some((p) => p.status !== "In pausa" && p.accountId === r.accountId);
    if (covered || pacCovered || r.cardId || !r.accountId) continue;
    // Una scadenza già registrata con data futura (stesso esercente o categoria, importo simile) non si conta due volte.
    const tol = Math.max(3, Math.round(toNum(r.period) * 0.25));
    const close = (x, a) => Math.abs(toNum(x) - a) <= Math.max(1, a * 0.2);
    const already = (d, a) => futureTx.some((t) => t.kind === r.kind && t.accountId === r.accountId && !t.cardId
      && Math.abs(daysBetween(t.date, d)) <= tol && (close(t.amount, a) || close(t.amount, r.amount))
      && (r.kind === "Entrata" ? (t.category || "Altre entrate") === r.category : merchantKey(t.description) === r.merchant));
    // Mensili: sempre lo stesso giorno del mese (il 31 resta il 31 dopo un mese più corto).
    const nd = Number(String(r.next).slice(8, 10));
    const dom = nd === daysInMonth(monthOf(r.next)) && toNum(r.dayOfMonth) > nd ? toNum(r.dayOfMonth) : nd;
    const nth = (k) => { const ym = addMonthsYm(monthOf(r.next), k); return `${ym}-${pad2(Math.min(dom, daysInMonth(ym)))}`; };
    let date = r.next;
    for (let guard = 0; guard < 60 && date <= end; guard++) {
      // La prima volta conta solo quanto manca (es. stipendio di cui è già arrivato l'acconto), nel giorno in cui arriva
      // di solito il resto. Una scadenza passata e non registrata conta domani.
      const amt = guard === 0 && r.nextAmount != null ? toNum(r.nextAmount) : r.amount;
      const d0 = guard === 0 && r.nextAmountDate && r.nextAmountDate > today ? r.nextAmountDate : date;
      const eff = d0 <= today ? addDays(today, 1) : d0;
      if (!already(date, amt) && !already(eff, amt)) add({ date: eff, accountId: r.accountId, amount: r.kind === "Entrata" ? amt : -amt, label: r.label, kind: r.kind === "Entrata" ? "income" : "recurring", estimated: true });
      date = r.frequency === "Mensile" ? nth(guard + 1) : addDays(date, Math.round(r.period));
    }
  }

  // 5b. rate dei "Paga in 3" e delle rateizzazioni: quelle che restano, sul conto da cui si pagano (quelle su
  // carta arrivano con il suo addebito). Non se già programmate, ignorate o già contate tra le ricorrenze, e
  // non quelle già registrate con una data futura (stesso conto, importo simile, entro dieci giorni).
  const instalments = opts.instalments || detectInstalments(tx, today, { schedules: state.schedules });
  const usedInst = new Set();
  for (const p of instalments) {
    if (!p.open || p.cardId || !p.accountId || planIgnored(p, opts.ignoredInstalments) || instalmentCovered(p, state.schedules)) continue;
    if (p.txIds.some((id) => recurringIds.has(id))) continue;
    const tol = p.type === "tax" ? Math.max(1, p.amount * 0.05) : 0.021;
    for (const date of instalmentDates(p, today, end)) {
      const fx = futureTx.find((t) => !usedInst.has(t.id) && t.kind === "Uscita" && t.accountId === p.accountId && !t.cardId
        && Math.abs(toNum(t.amount) - p.amount) <= tol && Math.abs(daysBetween(t.date, date)) <= 10);
      if (fx) { usedInst.add(fx.id); continue; }
      add({ date, accountId: p.accountId, amount: -p.amount, label: p.type === "tax" ? "Rata Agenzia delle Entrate-Riscossione" : `Rata ${p.provider} (in ${p.total} rate)`, kind: "instalment", estimated: true });
    }
  }

  // 6. carte: addebiti del ciclo in corso e dei successivi
  const irregular = irregularCategories(tx, today, recurringIds);
  const variable = variableDaily(tx, today, { recurringIds, irregular: new Set(irregular.map((c) => c.name)) });
  for (const c of state.creditCards || []) {
    const r = cardDebitEvents(c, state, today, end, variable.byCard.get(c.id) || 0, futureTx, accIds);
    r.events.forEach(add);
    if (r.note) notes.push(r.note);
  }

  // 7. spese irregolari e mensilità extra dell'anno scorso, alla stessa data (solo nel totale)
  if (opts.includeAnnual !== false) {
    const payAccount = new Map((state.creditCards || []).map((c) => [c.id, cardPayAccount(c, tx, accIds)]));
    // Già prevista da un movimento futuro o da un'operazione programmata della stessa categoria, entro un mese e di
    // importo simile (una programmata mensile da 30 € non è la polizza annuale da 600 €). Ogni movimento futuro
    // ne copre una sola.
    const near = (d, when) => !!d && Math.abs(daysBetween(d, when)) <= 31;
    const like = (a, b) => Math.abs(toNum(a) - toNum(b)) <= Math.max(10, toNum(b) * 0.3);
    const usedFuture = new Set();
    const scheduled = (name, when, amt) => (state.schedules || []).some((s) => {
      if (!like(s.amount, amt) || s.type !== "expense" || !s.startDate || !s.frequency || s.status === "In pausa" || s.status === "Concluso" || (s.category || "Altro") !== name) return false;
      for (let n = toNum(s.done), guard = 0; guard < 400; n++, guard++) {
        const d = occurrenceDate(s.startDate, s.frequency, n);
        if (d > addDays(when, 31) || scheduleEnded(s, n, d)) return false;
        if (near(d, when)) return true;
      }
      return false;
    });
    for (const cat of irregular) {
      for (const t of cat.tx) {
        if (toNum(t.amount) < 10) continue;
        const when = addMonths(t.date, 12);
        const fx = futureTx.find((x) => !usedFuture.has(x.id) && x.kind === "Uscita" && (x.category || "Altro") === cat.name && near(x.date, when) && like(x.amount, t.amount));
        if (fx) { usedFuture.add(fx.id); continue; }
        if (scheduled(cat.name, when, t.amount)) continue;
        const accountId = t.cardId ? payAccount.get(t.cardId) : t.accountId;
        add({ date: when, accountId, amount: -toNum(t.amount), label: t.description || cat.name, kind: "annual", refDate: t.date, category: cat.name, estimated: true });
      }
    }
  }
  const extras = salary ? extraIncome(tx, salary) : [];
  if (opts.includeExtras !== false) {
    for (const x of extras) add({ date: addMonths(x.date, 12), accountId: salary.accountId, amount: x.amount, label: "Mensilità extra (come l'anno scorso)", kind: "extra", refDate: x.date, estimated: true });
  }
  const other = irregularIncome(tx, today, recurringIds);

  // Simulazione giorno per giorno: il totale con tutto, i conti con le sole scadenze note.
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const spendDaily = [...variable.byAccount.entries()].filter(([id]) => accIds.has(id)).reduce((s, [, v]) => s + v, 0);
  const incomeDaily = opts.includeIrregularIncome === false ? 0 : other.daily;
  const bal = new Map(startBal);
  const startTotal = [...startBal.values()].reduce((s, v) => s + v, 0);
  let total = startTotal;
  const points = [{ date: today, value: round(total, 2) }];
  const series = new Map(accounts.map((a) => [a.id, [{ date: today, value: round(bal.get(a.id), 2) }]]));
  const mins = new Map(accounts.map((a) => [a.id, { value: bal.get(a.id), date: today }]));
  let min = { value: total, date: today };
  for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) {
    for (const e of byDate.get(d) || []) {
      total += e.amount;
      if (ACCOUNT_KINDS.has(e.kind)) bal.set(e.accountId, bal.get(e.accountId) + e.amount);
    }
    total += incomeDaily - spendDaily;
    points.push({ date: d, value: round(total, 2) });
    if (total < min.value) min = { value: total, date: d };
    for (const a of accounts) {
      const v = bal.get(a.id);
      series.get(a.id).push({ date: d, value: round(v, 2) });
      if (v < mins.get(a.id).value) mins.set(a.id, { value: v, date: d });
    }
  }
  // Prossima entrata importante (di solito lo stipendio): almeno metà dello stipendio tipico, se è noto
  // (trovato nei movimenti o programmato).
  const salaryPlan = Math.max(0, ...(state.schedules || []).filter((s) => s.type === "income" && s.category === "Stipendio" && s.status !== "In pausa" && s.status !== "Concluso").map((s) => toNum(s.amount)));
  const minIncome = Math.max(salary ? salary.amount : 0, salaryPlan) * 0.5;
  const nextIncome = events.find((e) => (e.kind === "income" || e.kind === "extra") && e.amount >= minIncome) || null;
  let margin = null;
  if (nextIncome) {
    margin = Infinity;
    for (const p of points) if (p.date < nextIncome.date) margin = Math.min(margin, p.value);
    margin = round(margin, 2);
  }
  return {
    today, end, days,
    start: round(startTotal, 2),
    endValue: points[points.length - 1].value,
    points,
    min: { value: round(min.value, 2), date: min.date },
    accounts: accounts.map((a) => ({
      id: a.id, name: a.name || "Conto",
      start: round(startBal.get(a.id), 2),
      min: { value: round(mins.get(a.id).value, 2), date: mins.get(a.id).date },
      end: round(bal.get(a.id), 2),
      points: series.get(a.id),
    })),
    events,
    flows: { spendDaily: round(spendDaily, 2), incomeDaily: round(incomeDaily, 2), days: variable.days, byCard: variable.byCard, otherIncome: other },
    nextIncome, margin,
    recurring, irregular, extras, salary, instalments,
    notes,
  };
}
