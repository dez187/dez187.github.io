import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addMonthsYm, monthOf } from "../lib/dates.js";
import { fmtEUR, fmtMonth, fmtNum, numToInput, parseAmount } from "../lib/format.js";
import { budgetMonth, suggestBudgets } from "../domain/budget.js";
import { categoryId, guessEmoji, sortCategories } from "../domain/categories.js";
import { emptyState, meter } from "../ui/components.js";
import { openSheet } from "../ui/feedback.js";
import { cardHead, pageHead } from "./shared.js";

const view = { ym: null };

// "a fine mese circa X": quanto speso più quello che di solito si spende nei giorni che restano.
function projText(r) {
  if (r.projected == null || r.projected <= r.spent + 0.5) return "";
  return html` · <span class="${r.atRisk ? "warn-text" : "muted"}">a fine mese circa ${fmtEUR(r.projected)}</span>`;
}

function statusText(r) {
  if (r.status === "over") return html`<span class="neg">${icon("alert", 14)} sforato di ${fmtEUR(-r.remaining)}</span>${projText(r)}`;
  if (r.status === "warn") return html`<span class="warn-text">${icon("alert", 14)} restano ${fmtEUR(r.remaining)}</span>${projText(r)}`;
  if (r.status === "ok") return html`<span class="muted">restano ${fmtEUR(r.remaining)}</span>${projText(r)}`;
  return html`<span class="muted">nessun budget</span>`;
}

export default {
  id: "budget",
  title: "Budget",
  render(app) {
    const { state, today } = app;
    if (!view.ym) view.ym = monthOf(today);
    const b = budgetMonth(state.categories, state.transactions, view.ym, today);
    const budgeted = b.rows.filter((r) => r.budget > 0);
    const others = b.rows.filter((r) => !(r.budget > 0) && r.spent > 0);
    const unused = b.rows.filter((r) => !(r.budget > 0) && !(r.spent > 0) && r.id);
    const pctAll = b.totalBudget > 0 ? (b.spentBudgeted / b.totalBudget) * 100 : 0;
    const status = pctAll > 100 ? "over" : pctAll >= 85 ? "warn" : "ok";
    const isCurrent = view.ym === monthOf(today);
    return html`
      ${pageHead("Budget", html`
        <div class="period-nav"><button type="button" class="icon-btn" data-action="bd-step" data-value="-1" aria-label="Mese precedente">${icon("chevronLeft")}</button><span class="period-label" aria-live="polite">${fmtMonth(view.ym)}</span><button type="button" class="icon-btn" data-action="bd-step" data-value="1" aria-label="Mese successivo">${icon("chevronRight")}</button></div>
        <button type="button" class="btn" data-action="bd-suggest">${icon("bolt", 18)}<span>Suggerisci</span></button>
        <button type="button" class="btn" data-action="bd-categories">${icon("tag", 18)}<span>Categorie</span></button>`)}
      <div class="grid">
        <section class="card span-12 budget-hero" aria-labelledby="h-bd-sum">
          ${budgeted.length ? html`
            <div class="bh-top">
              <div><h2 class="card-label" id="h-bd-sum">${b.remaining >= 0 ? "Ancora da spendere" : "Oltre il budget"}</h2><p class="hero-value ${b.remaining < 0 ? "neg" : ""}">${fmtEUR(Math.abs(b.remaining))}</p>
                <p class="stat-sub">${fmtEUR(b.spentBudgeted)} spesi su ${fmtEUR(b.totalBudget)} di budget${isCurrent && b.perDay ? ` · circa ${fmtEUR(b.perDay)} al giorno per ${b.daysLeft} giorni` : ""}</p>
                ${isCurrent && b.projectedBudgeted != null ? html`<p class="stat-sub ${b.projectedBudgeted > b.totalBudget ? "warn-text" : ""}">Al ritmo solito, a fine mese circa ${fmtEUR(b.projectedBudgeted)} su ${fmtEUR(b.totalBudget)}.</p>` : ""}</div>
              <div class="bh-side"><span class="muted">Spese totali del mese</span><strong>${fmtEUR(b.spentAll)}</strong></div>
            </div>
            ${meter(pctAll, status, "Budget del mese usato")}`
          : html`<h2 class="card-label" id="h-bd-sum">Budget del mese</h2>${emptyState("Nessun budget impostato", "Tocca una categoria qui sotto e imposta un tetto mensile: vale per ogni mese finché non lo cambi.", "")}`}
          ${b.excluded > 0.004 ? html`<p class="card-foot">Le rate dei finanziamenti (${fmtEUR(b.excluded)} questo mese) non rientrano nel budget: le trovi nel flusso di cassa.</p>` : ""}
        </section>

        ${budgeted.length ? html`<section class="card span-12" aria-labelledby="h-bd-list">
          ${cardHead("Categorie con budget", "", "h-bd-list")}
          <ul class="budget-list">${budgeted.map((r) => html`<li>
            <button type="button" class="budget-row" data-action="bd-set" data-id="${r.id}">
              <span class="bd-emoji" aria-hidden="true">${r.emoji || "🏷️"}</span>
              <span class="br-main"><span class="br-top"><span class="row-title">${r.name}</span><span class="br-vals"><strong>${fmtEUR(r.spent)}</strong> <span class="muted">di ${fmtEUR(r.budget)}</span></span></span>
                ${meter(r.pct, r.status, `${r.name}: ${fmtNum(r.pct, 0)}% del budget`)}
                <span class="br-status">${statusText(r)}</span></span>
            </button></li>`)}</ul>
        </section>` : ""}

        ${others.length ? html`<section class="card span-6" aria-labelledby="h-bd-other">
          ${cardHead("Spese senza budget", html`<strong>${fmtEUR(others.reduce((s, r) => s + r.spent, 0))}</strong>`, "h-bd-other")}
          <ul class="list">${others.map((r) => html`<li><button type="button" class="row" data-action="bd-set" data-id="${r.id || ""}" data-name="${r.name}"><span class="avatar emoji" aria-hidden="true">${r.emoji || guessEmoji(r.name)}</span><span class="row-main"><span class="row-title">${r.name}</span><span class="row-sub">${r.projected != null && r.projected > r.spent + 0.5 ? `a fine mese circa ${fmtEUR(r.projected)} · ` : ""}Imposta un budget</span></span><span class="amount">${fmtEUR(r.spent)}</span></button></li>`)}</ul>
        </section>` : ""}

        ${unused.length ? html`<section class="card span-6" aria-labelledby="h-bd-unused">
          ${cardHead("Altre categorie", "", "h-bd-unused")}
          <div class="chips">${unused.map((r) => html`<button type="button" class="chip" data-action="bd-set" data-id="${r.id}">${r.emoji || "🏷️"} ${r.name}</button>`)}</div>
        </section>` : ""}
      </div>`;
  },

  actions: {
    "bd-step": (el, app) => { view.ym = addMonthsYm(view.ym, Number(el.dataset.value)); app.rerender(); },
    "bd-set": (el, app) => openBudgetEditor(app, el.dataset.id, el.dataset.name),
    "bd-categories": (el, app) => openCategoriesManager(app),
    "bd-suggest": (el, app) => openBudgetSuggestions(app),
  },
};

function openBudgetEditor(app, id, name) {
  let cat = id ? app.store.find("categories", id) : null;
  const catName = cat ? cat.name : name;
  if (!catName) return;
  const dlg = openSheet({
    title: `Budget · ${catName}`,
    closeOnBackdrop: false,
    body: html`<form class="form" novalidate><label class="field" for="bd-amount"><span class="field-label">Tetto mensile (€)</span><input class="input num" id="bd-amount" inputmode="decimal" value="${cat && cat.budget ? numToInput(cat.budget) : ""}" placeholder="0,00" autocomplete="off"><span class="field-hint">Vale per tutti i mesi. Lascia vuoto o 0 per togliere il budget.</span></label><p class="form-error" role="alert" hidden></p><button type="submit" hidden></button></form>`,
    footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-save>Salva</button>`,
  });
  const input = dlg.querySelector("#bd-amount");
  const save = () => {
    const raw = input.value.trim();
    const v = raw === "" ? 0 : parseAmount(raw);
    if (!Number.isFinite(v) || v < 0) {
      const box = dlg.querySelector(".form-error");
      box.textContent = "Inserisci un importo valido.";
      box.hidden = false;
      input.focus();
      return;
    }
    const op = cat
      ? { op: "update", coll: "categories", id: cat.id, data: { budget: v } }
      : { op: "set", coll: "categories", id: categoryId(catName), data: { name: catName, emoji: guessEmoji(catName), kind: "Uscita", budget: v, order: 900 } };
    dlg.close();
    app.commitWithUndo([op], v > 0 ? `Budget di ${catName}: ${fmtEUR(v)} al mese` : `Budget di ${catName} rimosso`);
  };
  dlg.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  dlg.querySelector("[data-save]").addEventListener("click", save);
  input.focus();
}

// Budget suggeriti dagli ultimi 6 mesi: si scelgono le categorie e si può correggere l'importo prima di applicare.
// Si aggiorna solo il budget delle categorie spuntate, con "Annulla" nella notifica.
function openBudgetSuggestions(app) {
  const list = suggestBudgets(app.state.categories, app.state.transactions, app.today);
  if (!list.length) {
    openSheet({ title: "Budget suggeriti", body: html`<p class="sheet-text">Servono spese in una categoria in almeno quattro degli ultimi sei mesi per proporre un budget.</p>` });
    return;
  }
  const dlg = openSheet({
    title: "Budget suggeriti",
    wide: true,
    closeOnBackdrop: false,
    body: html`<p class="sheet-text">Proposta per le categorie presenti in almeno 4 degli ultimi 6 mesi: la spesa tipica (la maggiore tra mediana e media), arrotondata ai 10 € sopra. Rate dei finanziamenti, addebiti delle carte e investimenti restano fuori.</p>
      <div class="table-wrap"><table class="table bd-suggest">
        <thead><tr><th scope="col"><span class="sr-only">Applica</span></th><th scope="col">Categoria</th><th scope="col" class="num hide-sm">Tipica</th><th scope="col" class="num hide-sm">Massima</th><th scope="col" class="num">Attuale</th><th scope="col" class="num">Nuovo budget (€)</th></tr></thead>
        <tbody>${list.map((r, i) => html`<tr>
          <td><input type="checkbox" data-row="${i}" aria-label="Applica a ${r.name}"${raw(r.current > 0 ? "" : " checked")}></td>
          <th scope="row">${r.emoji || "🏷️"} ${r.name}<span class="cell-sub">in ${r.months} mesi su 6</span></th>
          <td class="num hide-sm">${fmtEUR(Math.max(r.median, r.average))}</td>
          <td class="num hide-sm">${fmtEUR(r.max)}</td>
          <td class="num">${r.current > 0 ? fmtEUR(r.current) : html`<span class="muted">—</span>`}</td>
          <td class="num"><input class="input num sm" data-value="${i}" inputmode="decimal" autocomplete="off" value="${numToInput(r.suggested)}" aria-label="Nuovo budget per ${r.name}"></td></tr>`)}</tbody>
      </table></div>
      <p class="form-error" role="alert" hidden></p>`,
    footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-apply>Applica</button>`,
  });
  dlg.querySelector("[data-apply]").addEventListener("click", () => {
    const ops = [];
    for (const [i, r] of list.entries()) {
      if (!dlg.querySelector(`[data-row="${i}"]`)?.checked) continue;
      const v = parseAmount(dlg.querySelector(`[data-value="${i}"]`)?.value || "");
      if (!Number.isFinite(v) || v < 0) {
        const box = dlg.querySelector(".form-error");
        box.textContent = `Importo non valido per ${r.name}.`;
        box.hidden = false;
        return;
      }
      if (Math.abs(v - r.current) > 0.004) ops.push({ op: "update", coll: "categories", id: r.id, data: { budget: v } });
    }
    dlg.close();
    if (ops.length) app.commitWithUndo(ops, ops.length === 1 ? "1 budget impostato" : `${ops.length} budget impostati`);
  });
}

export function openCategoriesManager(app) {
  const list = sortCategories(app.state.categories);
  const dlg = openSheet({
    title: "Categorie",
    wide: true,
    body: html`<p class="sheet-text">Le categorie organizzano movimenti e budget. Rinominandone una, si aggiornano anche i movimenti che la usano.</p>
      ${["Uscita", "Entrata"].map((k) => html`<h3 class="subhead">${k === "Uscita" ? "Uscite" : "Entrate"}</h3><ul class="list">${list.filter((c) => (k === "Entrata" ? c.kind === "Entrata" : c.kind !== "Entrata")).map((c) => html`<li><button type="button" class="row" data-cat="${c.id}"><span class="avatar emoji" aria-hidden="true">${c.emoji || "🏷️"}</span><span class="row-main"><span class="row-title">${c.name}</span><span class="row-sub">${c.budget > 0 ? `budget ${fmtEUR(c.budget)} al mese` : "nessun budget"}</span></span>${icon("chevronRight", 18)}</button></li>`)}</ul>`)}`,
    footer: html`<span class="spacer"></span><button type="button" class="btn primary" data-new>${icon("plus", 18)} Nuova categoria</button>`,
  });
  dlg.addEventListener("click", (e) => {
    const row = e.target.closest("[data-cat]");
    if (row) { dlg.close(); app.openEntity("categories", row.dataset.cat); }
    if (e.target.closest("[data-new]")) { dlg.close(); app.openEntity("categories"); }
  });
}
