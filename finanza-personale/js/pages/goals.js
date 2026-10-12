import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { fmtEUR, fmtMonthInline, fmtPct, numToInput, parseAmount, round, toNum } from "../lib/format.js";
import { nameOf } from "../domain/finance.js";
import { sortGoals } from "../domain/goals.js";
import { badge, emptyState, meter } from "../ui/components.js";
import { openSheet } from "../ui/feedback.js";
import { pageHead } from "./shared.js";

export function goalCard(app, goal, p, compact = false) {
  const status = p.status === "late" ? "warn" : "ok";
  const pace = p.status === "done"
    ? "Obiettivo raggiunto."
    : p.monthsLeft == null ? `Mancano ${fmtEUR(p.remaining)}.`
      : p.monthsLeft < 0 ? `Scadenza di ${fmtMonthInline(goal.targetDate)} superata: mancano ${fmtEUR(p.remaining)}.`
        : p.monthsLeft === 0 ? `Mancano ${fmtEUR(p.remaining)} entro questo mese.`
          : `Servono ${fmtEUR(p.perMonth)} al mese fino a ${fmtMonthInline(goal.targetDate)}.`;
  return html`<article class="goal-card${p.status === "done" ? " done" : ""}">
    <div class="goal-top">
      <span class="avatar emoji" aria-hidden="true">${goal.emoji || "🎯"}</span>
      <div class="row-main"><span class="row-title">${goal.name || "Obiettivo"}</span><span class="row-sub">${p.linked ? `Segue il saldo di ${nameOf(app.state.accounts, goal.accountId)}` : "Importo aggiornato a mano"}</span></div>
      ${p.status === "done" ? badge("raggiunto", "pos") : p.status === "late" ? badge("in ritardo", "warn") : ""}
    </div>
    <p class="goal-values"><strong>${fmtEUR(p.current)}</strong> <span class="muted">di ${fmtEUR(p.target)} · ${fmtPct(Math.min(999, p.pct), 0)}</span></p>
    ${meter(Math.min(100, p.pct), status, `${goal.name}: ${Math.round(p.pct)}%`)}
    <p class="goal-pace">${pace}</p>
    ${compact ? "" : html`<div class="goal-actions">
      ${p.linked ? "" : html`<button type="button" class="btn sm" data-action="goal-deposit" data-id="${goal.id}">${icon("plus", 16)} Aggiungi</button>`}
      <button type="button" class="btn sm ghost" data-action="edit" data-coll="goals" data-id="${goal.id}">${icon("pencil", 16)} Modifica</button>
    </div>`}
  </article>`;
}

export default {
  id: "goals",
  title: "Obiettivi",
  render(app) {
    const t = app.derived().totals;
    const list = sortGoals(app.state.goals, t, app.today);
    const totTarget = list.reduce((s, x) => s + x.p.target, 0);
    const totCurrent = list.reduce((s, x) => s + Math.min(x.p.current, x.p.target), 0);
    return html`
      ${pageHead("Obiettivi", html`<button type="button" class="btn primary" data-action="add" data-coll="goals">${icon("plus", 18)}<span>Nuovo obiettivo</span></button>`)}
      ${list.length
        ? html`<section class="card goals-summary" aria-label="Riepilogo obiettivi">
            <div><p class="stat-label">Accumulato</p><p class="stat-value">${fmtEUR(totCurrent)} <span class="stat-inline">su ${fmtEUR(totTarget)}</span></p></div>
            ${meter(totTarget > 0 ? (totCurrent / totTarget) * 100 : 0, "ok", "Avanzamento complessivo")}
            <p class="card-foot">Gli obiettivi collegati a un conto seguono il suo saldo; se due obiettivi usano lo stesso conto, ciascuno vede l'intero saldo.</p>
          </section>
          <div class="goal-grid">${list.map(({ goal, p }) => goalCard(app, goal, p))}</div>`
        : html`<section class="card">${emptyState("Nessun obiettivo", "Un fondo emergenze, una vacanza, l'anticipo per la casa: imposta quanto vuoi mettere da parte ed entro quando, e l'app ti dice quanto accantonare ogni mese.", html`<button type="button" class="btn primary sm" data-action="add" data-coll="goals">${icon("plus", 16)} Crea un obiettivo</button>`)}</section>`}`;
  },
  actions: {
    "goal-deposit": (el, app) => openGoalDeposit(app, el.dataset.id),
  },
};

// Versamento (o prelievo, con importo negativo) su un obiettivo senza conto collegato.
function openGoalDeposit(app, id) {
  const goal = app.store.find("goals", id);
  if (!goal) return;
  const dlg = openSheet({
    title: `Aggiungi a ${goal.name || "obiettivo"}`,
    closeOnBackdrop: false,
    body: html`<form class="form" novalidate><label class="field" for="gd-amount"><span class="field-label">Importo messo da parte (€)</span><input class="input num" id="gd-amount" inputmode="decimal" autocomplete="off" placeholder="0,00"><span class="field-hint">Già messi da parte: ${fmtEUR(goal.saved)}. Usa un importo negativo per un prelievo.</span></label><p class="form-error" role="alert" hidden></p><button type="submit" hidden></button></form>`,
    footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-save>Aggiungi</button>`,
  });
  const input = dlg.querySelector("#gd-amount");
  const save = () => {
    const v = parseAmount(input.value);
    if (!Number.isFinite(v) || v === 0) {
      const box = dlg.querySelector(".form-error");
      box.textContent = "Inserisci un importo.";
      box.hidden = false;
      input.focus();
      return;
    }
    const saved = Math.max(0, round(toNum(goal.saved) + v, 2));
    dlg.close();
    app.commitWithUndo([{ op: "update", coll: "goals", id: goal.id, data: { saved } }], `${goal.name}: ${fmtEUR(saved)} messi da parte`);
  };
  dlg.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  dlg.querySelector("[data-save]").addEventListener("click", save);
  input.value = numToInput("");
  input.focus();
}
