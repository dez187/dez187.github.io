import { html, raw } from "../lib/html.js";
import { addDays, addPeriod } from "../lib/dates.js";
import { fmtDate, fmtEUR, numToInput, onDate, parseAmount } from "../lib/format.js";
import { planCardSettlement, settlementDefaults } from "../domain/cards.js";
import { openSheet } from "./feedback.js";
import { accountOptions } from "./components.js";

// Finestra "Addebito e rinnovo" di una carta di credito: registra l'addebito del mese sul conto
// (anche con data futura) e/o rinnova il plafond, in un solo passaggio.
export function openCardSettlement(app, cardId, { renew } = {}) {
  const card = app.store.find("creditCards", cardId);
  if (!card) return null;
  const first = settlementDefaults(card, app.state, app.today, { renew });
  // Importo e data seguono i valori proposti finché l'utente non li cambia.
  const touched = new Set();
  const st = { debit: !(first.renew && first.amount === 0), renew: first.renew, renewDate: first.renewDate, accountId: first.accountId, amount: "", date: "" };
  const spentNow = app.derived().totals.cards.get(card.id)?.spent || 0;

  const dlg = openSheet({
    title: `Addebito e rinnovo · ${card.name || "carta"}`,
    closeOnBackdrop: false,
    body: html`<form class="form" novalidate><div data-body></div><p class="form-error" role="alert" hidden></p><button type="submit" hidden></button></form>`,
    footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-save>Conferma</button>`,
  });
  const form = dlg.querySelector("form");
  const body = form.querySelector("[data-body]");
  const box = form.querySelector(".form-error");

  const defaults = () => settlementDefaults(card, app.state, app.today, { renew: st.renew, renewDate: st.renew ? st.renewDate || undefined : undefined });
  const collect = () => {
    for (const el of form.elements) if (el.name) st[el.name] = el.type === "checkbox" ? el.checked : el.value;
  };
  const render = () => {
    const d = defaults();
    if (!touched.has("amount")) st.amount = d.amount == null ? "" : numToInput(d.amount);
    if (!touched.has("date")) st.date = d.debitDate;
    const period = d.cycle ? `${onDate("da", addDays(d.cycle.from, 1))} ${onDate("a", d.cycle.to)}` : "";
    body.innerHTML = String(html`
      <p class="sheet-text">Speso sulla carta: <strong>${fmtEUR(spentNow)}</strong>${card.limit ? ` su ${fmtEUR(card.limit)} di plafond` : ""}${card.resetDate ? ` · rinnovo previsto ${onDate("il", card.resetDate)}` : ""}.</p>
      <fieldset class="block">
        <label class="check"><input type="checkbox" name="debit"${raw(st.debit ? " checked" : "")}><span><strong>Registra l'addebito sul conto</strong><span class="muted">L'uscita del mese dal conto, con categoria “Carta di credito”. Può avere una data futura.</span></span></label>
        ${st.debit ? html`<div class="form-grid">
          <label class="field" for="cs-amount"><span class="field-label">Importo addebitato (€)</span><input class="input num" id="cs-amount" name="amount" inputmode="decimal" value="${st.amount}" placeholder="0,00" autocomplete="off"></label>
          <label class="field" for="cs-account"><span class="field-label">Conto di addebito</span><select class="input" id="cs-account" name="accountId"><option value="">— scegli —</option>${accountOptions(app.state, st.accountId)}</select></label>
          <label class="field" for="cs-date"><span class="field-label">Data dell'addebito</span><input class="input" type="date" id="cs-date" name="date" value="${st.date}"></label>
        </div>
        ${period ? html`<p class="form-note">L'addebito paga le spese fatte ${period}${d.amount == null ? ": l'importo è quello dell'estratto conto" : ""}.${d.itemized > 0 ? ` Di queste, ${fmtEUR(d.itemized)} sono già registrate una per una sulla carta: nel flusso di cassa e nel budget verranno contate una volta sola.` : ""}${d.paid ? " Per questo periodo hai già registrato un addebito." : ""}</p>` : ""}` : ""}
      </fieldset>
      <fieldset class="block">
        <label class="check"><input type="checkbox" name="renew"${raw(st.renew ? " checked" : "")}><span><strong>Rinnova il plafond</strong><span class="muted">Lo speso torna a zero e il credito è di nuovo disponibile.</span></span></label>
        ${st.renew ? html`<div class="form-grid">
          <label class="field" for="cs-renew"><span class="field-label">Data del rinnovo</span><input class="input" type="date" id="cs-renew" name="renewDate" value="${st.renewDate}"><span class="field-hint">${st.renewDate ? `Prossimo rinnovo: ${fmtDate(addPeriod(st.renewDate, "Mensile"))}. Le spese sulla carta dopo questa data contano sul nuovo mese.` : ""}</span></label>
        </div>` : ""}
      </fieldset>`);
  };
  render();

  form.addEventListener("input", (e) => {
    if (e.target.name === "amount" || e.target.name === "date") touched.add(e.target.name);
  });
  form.addEventListener("change", (e) => {
    collect();
    box.hidden = true;
    if (["debit", "renew", "renewDate"].includes(e.target.name)) {
      const focused = e.target.name;
      if (focused === "renew" && st.renew && !st.renewDate) st.renewDate = first.renewDate;
      render();
      form.elements.namedItem(focused)?.focus();
    }
  });

  const save = () => {
    collect();
    const res = planCardSettlement(card, app.state, {
      debit: st.debit, renew: st.renew, amount: parseAmount(st.amount), accountId: st.accountId, date: st.date,
      renewDate: st.renewDate, today: app.today, txId: app.newId(), now: Date.now(),
    });
    if (res.error) {
      box.textContent = res.error;
      box.hidden = false;
      if (res.field) form.elements.namedItem(res.field)?.focus();
      return;
    }
    dlg.close();
    const msg = st.debit && st.renew ? "Addebito registrato e plafond rinnovato" : st.debit ? "Addebito registrato" : "Plafond rinnovato";
    app.commitWithUndo(res.ops, msg);
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  dlg.querySelector("[data-save]").addEventListener("click", save);
  return dlg;
}
