import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addDays } from "../lib/dates.js";
import { fmtDayMonth, fmtEUR, numToInput } from "../lib/format.js";
import { copyText } from "../lib/dom.js";
import { formatIban, isValidIban, normalizeIban } from "../lib/iban.js";
import { owedPart, peopleSummary, refundMessage, tagsSummary } from "../domain/people.js";
import { emptyState, txRow } from "../ui/components.js";
import { openSheet } from "../ui/feedback.js";
import { openOperationForm } from "../ui/operation.js";
import { cached, cardHead, pageHead } from "./shared.js";

// Persone e viaggi: chi ti deve dei soldi (o a chi li devi), i rimborsi da chiedere con il tuo IBAN e quanto
// è costato davvero ogni viaggio o evento. Si scrive solo dai moduli (movimenti) e da "Registra restituzione".

const searchLink = (text) => `#/transazioni?cerca=${encodeURIComponent(text)}`;

function initials(name) {
  const parts = String(name).split(/\s+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

function personRow(p) {
  const owes = p.balance > 0.004, mine = p.balance < -0.004;
  return html`<li class="row-block">
    <div class="row">
      <span class="avatar tone-${owes ? "aqua" : mine ? "orange" : "neutral"}" aria-hidden="true">${initials(p.name)}</span>
      <span class="row-main"><span class="row-title">${p.name}</span>
        <span class="row-sub">${owes ? "ti deve" : mine ? "devi tu" : "siete in pari"} · ${p.items.length === 1 ? "1 movimento" : `${p.items.length} movimenti`}, l'ultimo ${fmtDayMonth(p.last)}</span></span>
      <span class="row-end"><span class="amount ${owes ? "pos" : mine ? "neg" : "muted"}">${fmtEUR(Math.abs(p.balance))}</span>${p.repaid > 0 ? html`<span class="row-note">già restituiti ${fmtEUR(p.repaid)}</span>` : ""}</span>
    </div>
    <div class="row-extra people-actions">
      ${owes ? html`<button type="button" class="btn sm primary" data-action="people-request" data-key="${p.key}">${icon("arrowDownRight", 16)} Chiedi i soldi<span class="sr-only"> a ${p.name}</span></button><button type="button" class="btn sm" data-action="people-repaid" data-key="${p.key}">${icon("check", 16)} Registra restituzione<span class="sr-only"> di ${p.name}</span></button>` : ""}
      ${mine ? html`<button type="button" class="btn sm" data-action="people-pay" data-key="${p.key}">${icon("check", 16)} Registra pagamento<span class="sr-only"> a ${p.name}</span></button>` : ""}
      <a class="btn sm ghost" href="${searchLink(p.name)}">${icon("list", 16)} Movimenti<span class="sr-only"> di ${p.name}</span></a>
    </div>
  </li>`;
}

export default {
  id: "people",
  title: "Persone e viaggi",
  render(app) {
    const { state, today } = app;
    const people = cached(app, "people", () => peopleSummary(state.transactions));
    const tags = cached(app, "tags", () => tagsSummary(state.transactions));
    const open = people.filter((p) => Math.abs(p.balance) > 0.004);
    const even = people.filter((p) => Math.abs(p.balance) <= 0.004);
    const credit = open.filter((p) => p.balance > 0).reduce((s, p) => s + p.balance, 0);
    const debt = open.filter((p) => p.balance < 0).reduce((s, p) => s - p.balance, 0);
    // Restituzioni degli ultimi 12 mesi senza una persona: si possono assegnare aprendole.
    const from = addDays(today, -365);
    const loose = state.transactions.filter((t) => t.kind === "Entrata" && t.category === "Rimborsi" && !String(t.person || "").trim() && t.date >= from && t.date <= today).slice(0, 30);
    return html`
      ${pageHead("Persone e viaggi", html`<button type="button" class="btn primary" data-action="new-op">${icon("plus", 18)}<span>Nuova operazione</span></button>`)}
      <div class="grid">
        <section class="card span-8" aria-labelledby="h-people">
          ${cardHead("Soldi da avere e da dare", open.length ? html`<span class="muted">${credit > 0.004 ? `ti devono ${fmtEUR(credit)}` : ""}${credit > 0.004 && debt > 0.004 ? " · " : ""}${debt > 0.004 ? `devi ${fmtEUR(debt)}` : ""}</span>` : "", "h-people")}
          ${open.length ? html`<ul class="list">${open.map(personRow)}</ul>` : emptyState(people.length ? "Siete tutti in pari" : "Ancora nessuna persona", people.length ? "Nessuno ti deve dei soldi e tu non ne devi a nessuno." : "Quando paghi qualcosa anche per qualcun altro, nel movimento apri “Persona e viaggio”: indica con chi e quanto ti deve restituire.")}
          ${even.length ? html`<details class="table-toggle"><summary>In pari (${even.length})</summary><ul class="list">${even.map(personRow)}</ul></details>` : ""}
        </section>

        <section class="card span-4" aria-labelledby="h-people-how">
          ${cardHead("Come funziona", "", "h-people-how")}
          <ul class="how-list">
            <li>In una spesa, “Ti deve restituire” è la parte di un'altra persona: non conta tra le tue uscite né nel budget.</li>
            <li>Un'entrata con una persona è una restituzione: chiude quanto ti doveva e non conta tra le entrate.</li>
            <li>Se ti ha restituito più del dovuto, “Registra pagamento” segna i soldi che gli ridai: tutta la spesa va in “Ti deve restituire”, così non conta tra le tue uscite e il saldo torna in pari.</li>
            <li>“Chiedi i soldi” prepara un messaggio con l'importo e il tuo IBAN, da condividere o copiare.</li>
            <li>Con “Viaggio o evento” vedi qui sotto quanto ti è costato davvero, al netto di quello che pagano gli altri.</li>
          </ul>
        </section>

        <section class="card span-12" aria-labelledby="h-tags">
          ${cardHead("Viaggi ed eventi", "", "h-tags")}
          ${tags.length ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Viaggio o evento</th><th scope="col" class="hide-sm">Periodo</th><th scope="col" class="num">Speso</th><th scope="col" class="num hide-sm">A carico di altri</th><th scope="col" class="num">Costo per te</th></tr></thead>
            <tbody>${tags.map((t) => html`<tr>
              <th scope="row"><a class="cell-link" href="${searchLink(t.name)}"><span class="cell-title">${t.name}</span><span class="cell-sub">${t.count === 1 ? "1 movimento" : `${t.count} movimenti`}</span></a></th>
              <td class="hide-sm">${t.from === t.to ? fmtDayMonth(t.from) : `${fmtDayMonth(t.from)} – ${fmtDayMonth(t.to)}`}${t.to.slice(0, 4) !== today.slice(0, 4) ? ` ${t.to.slice(0, 4)}` : ""}</td>
              <td class="num">${fmtEUR(t.spent)}</td>
              <td class="num hide-sm">${t.others > 0.004 ? fmtEUR(t.others) : "—"}</td>
              <td class="num"><strong>${fmtEUR(t.net)}</strong></td></tr>`)}</tbody>
          </table></div>` : emptyState("Nessun viaggio o evento", "Nei movimenti di un viaggio scrivi lo stesso nome in “Viaggio o evento” (es. “Londra ottobre 2026”): qui ne vedrai il costo totale.")}
        </section>

        ${loose.length ? html`<section class="card span-12" aria-labelledby="h-loose">
          ${cardHead("Rimborsi senza persona", html`<span class="muted">ultimi 12 mesi</span>`, "h-loose")}
          <p class="card-sub">Entrate nella categoria Rimborsi. Tocca un'entrata e indica chi te l'ha mandata: così chiude quanto quella persona ti doveva e non conta come entrata.</p>
          <div class="list">${loose.map((t) => txRow(t, state, { showDate: true, fmtDate: fmtDayMonth }))}</div>
        </section>` : ""}
      </div>`;
  },

  actions: {
    "people-repaid": (el, app) => {
      const p = peopleSummary(app.state.transactions).find((x) => x.key === el.dataset.key);
      if (!p) return;
      const hasCat = app.state.categories.some((c) => c.name === "Rimborsi" && c.kind === "Entrata");
      openOperationForm(app, { mode: "Entrata", preset: { amount: numToInput(Math.max(0, p.balance)), description: `Restituzione da ${p.name}`, category: hasCat ? "Rimborsi" : "Altre entrate", person: p.name, categoryTouched: true } });
    },
    // Soldi che devi tu (ti ha restituito più del dovuto): un'uscita che è tutta "da restituire" pareggia il conto.
    "people-pay": (el, app) => {
      const p = peopleSummary(app.state.transactions).find((x) => x.key === el.dataset.key);
      if (!p || !(p.balance < 0)) return;
      const amount = numToInput(-p.balance);
      openOperationForm(app, { mode: "Uscita", preset: { amount, owed: amount, description: `Restituzione a ${p.name}`, person: p.name, moreOpen: true } });
    },
    "people-request": (el, app) => openRequest(app, el.dataset.key),
  },
};

// Messaggio per chiedere il rimborso: importo, le spese ancora aperte e l'IBAN del conto scelto.
function openRequest(app, key) {
  const { state, session } = app;
  const p = peopleSummary(state.transactions).find((x) => x.key === key);
  if (!p || !(p.balance > 0)) return;
  // Le spese più recenti con una parte da restituire, finché coprono quanto deve.
  const reasons = [];
  let left = p.balance;
  for (const t of p.items) {
    if (left <= 0.004) break;
    const part = owedPart(t);
    if (!(part > 0)) continue;
    reasons.push(String(t.tag || t.description || "").trim());
    left -= part;
  }
  const withIban = state.accounts.filter((a) => isValidIban(a.iban));
  const st = { accountId: withIban[0] ? withIban[0].id : "", holder: session && session.mode === "firebase" ? session.name || "" : "" };
  const text = () => {
    const acc = withIban.find((a) => a.id === st.accountId);
    return refundMessage({ name: p.name, amount: p.balance, reasons: [...new Set(reasons.filter(Boolean))], iban: acc ? normalizeIban(acc.iban) : "", holder: st.holder });
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const dlg = openSheet({
    title: `Chiedi ${fmtEUR(p.balance)} a ${p.name}`,
    body: html`<form class="form" novalidate>
      <div class="form-grid">
        ${withIban.length ? html`<label class="field" for="rq-account"><span class="field-label">IBAN su cui ricevere</span><select class="input" id="rq-account" name="account">${withIban.map((a) => html`<option value="${a.id}"${raw(a.id === st.accountId ? " selected" : "")}>${a.name || "Conto"} · ${formatIban(a.iban).slice(0, 9)}…</option>`)}</select></label>` : html`<p class="form-note wide">Nessun conto ha l'IBAN: aggiungilo da Conti → Modifica per inserirlo nel messaggio.</p>`}
        ${withIban.length ? html`<label class="field" for="rq-holder"><span class="field-label">Intestatario (facoltativo)</span><input class="input" id="rq-holder" name="holder" value="${st.holder}" autocomplete="off"></label>` : ""}
        <label class="field wide" for="rq-text"><span class="field-label">Messaggio</span><textarea class="input" id="rq-text" name="text" rows="6">${text()}</textarea><span class="field-hint">Puoi cambiarlo prima di mandarlo.</span></label>
        <p class="form-note wide" data-stale hidden>Hai cambiato la riga dell'IBAN nel messaggio: aggiornala tu con il conto scelto.</p>
      </div>
    </form>`,
    footer: html`<span class="spacer"></span><button type="button" class="btn" data-copy>${icon("copy", 18)} Copia</button>${canShare ? html`<button type="button" class="btn primary" data-share>${icon("arrowUpRight", 18)} Condividi</button>` : ""}`,
  });
  const form = dlg.querySelector("form");
  // Invio in un campo non deve "inviare" il modulo (ricaricherebbe la pagina con l'IBAN nell'indirizzo).
  form.addEventListener("submit", (e) => e.preventDefault());
  const area = form.elements.namedItem("text");
  const stale = form.querySelector("[data-stale]");
  let edited = false;
  let auto = area.value;
  // Cambiando conto o intestatario cambia solo la riga dell'IBAN: anche in un messaggio già ritoccato la si
  // sostituisce, se è rimasta com'era; altrimenti lo si dice.
  const refresh = () => {
    const next = text();
    if (!edited) area.value = next;
    else {
      const before = auto.split("\n"), after = next.split("\n");
      let value = area.value, missed = false;
      before.forEach((line, i) => {
        if (line === after[i]) return;
        if (line && value.includes(line)) value = value.replace(line, after[i] ?? "");
        else missed = true;
      });
      area.value = value;
      stale.hidden = !missed;
    }
    auto = next;
  };
  area.addEventListener("input", () => { edited = true; });
  form.addEventListener("change", (e) => {
    if (e.target.name === "account") st.accountId = e.target.value;
    else if (e.target.name === "holder") st.holder = e.target.value;
    else return;
    refresh();
  });
  form.addEventListener("input", (e) => {
    if (e.target.name === "holder") { st.holder = e.target.value; refresh(); }
  });
  // L'esito si vede sul pulsante: le notifiche resterebbero sotto la finestra.
  const copyBtn = dlg.querySelector("[data-copy]");
  const copyLabel = copyBtn.innerHTML;
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(area.value, copyBtn);
    if (!ok) area.select();
    copyBtn.textContent = ok ? "Copiato" : "Non copiato: è selezionato";
    clearTimeout(copyBtn._t);
    copyBtn._t = setTimeout(() => { copyBtn.innerHTML = copyLabel; }, ok ? 2500 : 6000);
  });
  const share = dlg.querySelector("[data-share]");
  if (share) share.addEventListener("click", () => {
    navigator.share({ text: area.value }).catch(() => {});
  });
}
