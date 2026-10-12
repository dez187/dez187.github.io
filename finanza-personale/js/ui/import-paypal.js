import { html, raw, esc } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { fmtDate, fmtEUR, MINUS } from "../lib/format.js";
import { readFileText } from "../lib/dom.js";
import { readSpreadsheet } from "../lib/spreadsheet.js";
import { detectDelimiter, parseCsv } from "../domain/csvimport.js";
import { isPaypalTx, matchPaypal, parsePaypalActivity, paypalPatch, paypalRange } from "../domain/paypal.js";
import { suggestCategory } from "../domain/rules.js";
import { sortCategories } from "../domain/categories.js";
import { openSheet } from "./feedback.js";

function resultText(n, targets) {
  if (n) return n === 1 ? `1 movimento “PayPal” su ${targets} ha trovato il negozio.` : `${n} movimenti “PayPal” su ${targets} hanno trovato il negozio.`;
  if (!targets) return "Non ci sono movimenti “PayPal” da completare.";
  return targets === 1
    ? "L'unico movimento “PayPal” non corrisponde a nessun pagamento del file: controlla il periodo scaricato."
    : `Nessuno dei ${targets} movimenti “PayPal” corrisponde a un pagamento del file: controlla il periodo scaricato.`;
}

// "PayPal in chiaro": si carica l'attività scaricata da PayPal e i movimenti descritti solo come "PayPal"
// prendono il nome del negozio (e, se una regola o i movimenti passati lo suggeriscono, la categoria).
export function openPaypalImport(app) {
  const { state } = app;
  const st = { name: "", result: null, include: new Map(), cats: new Map(), error: "" };
  const range = paypalRange(state.transactions, app.today);
  const anyPaypal = state.transactions.some(isPaypalTx);
  const dlg = openSheet({
    title: "PayPal in chiaro",
    wide: true,
    closeOnBackdrop: false,
    body: html`<div class="csv-import" data-root></div>`,
    footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-apply disabled>Applica</button>`,
  });
  const root = dlg.querySelector("[data-root]");
  const applyBtn = dlg.querySelector("[data-apply]");
  const expOptions = sortCategories(state.categories).filter((c) => c.kind !== "Entrata").map((c) => `<option value="${esc(c.name)}">${esc((c.emoji ? c.emoji + " " : "") + c.name)}</option>`).join("");
  const incOptions = sortCategories(state.categories).filter((c) => c.kind === "Entrata").map((c) => `<option value="${esc(c.name)}">${esc((c.emoji ? c.emoji + " " : "") + c.name)}</option>`).join("");

  function start() {
    root.innerHTML = String(html`
      <label class="field" for="pp-file"><span class="field-label">Attività PayPal (CSV o Excel)</span><input class="input file" id="pp-file" type="file" accept=".csv,.xlsx,.xls,text/csv,text/plain"></label>
      ${st.error ? html`<p class="form-error" role="alert">${st.error}</p>` : ""}
      <div class="help-box">
        <p><strong>Dove trovare il file</strong></p>
        <ul>
          <li>Su paypal.com (dal computer): Attività → Scarica estratti/Report attività → <strong>Tutte le transazioni</strong>, formato CSV.</li>
          <li>${range ? html`Scegli il periodo ${fmtDate(range.from)} – ${fmtDate(range.to)}: ci ${range.count === 1 ? "è 1 movimento" : `sono ${range.count} movimenti`} “PayPal” ancora senza nome.` : anyPaypal ? "Tutti i movimenti “PayPal” hanno già il nome del negozio: puoi caricare l'attività dei prossimi mesi quando servirà." : "Per ora non ci sono movimenti “PayPal”: importa prima gli estratti della banca e delle carte."}</li>
        </ul>
        <p class="muted">Il file viene letto solo sul tuo dispositivo. Cambiano solo descrizione e categoria dei movimenti “PayPal” che scegli; la descrizione originale resta salvata.</p>
      </div>`);
    applyBtn.disabled = true;
  }

  function render() {
    if (!st.result) return start();
    const { matches, targets, from, to } = st.result;
    const chosen = matches.filter((m) => st.include.get(m.tx.id));
    root.innerHTML = String(html`
      <p class="sheet-text">${st.name}${from ? `: attività ${from === to ? `del ${fmtDate(from)}` : `${fmtDate(from)} – ${fmtDate(to)}`}` : ""}. ${resultText(matches.length, targets)}</p>
      ${matches.length ? html`<div class="table-wrap import-table"><table class="table">
        <thead><tr><th scope="col"><span class="sr-only">Applica</span></th><th scope="col">Data</th><th scope="col">Negozio</th><th scope="col">Categoria</th><th scope="col" class="num">Importo</th></tr></thead>
        <tbody>${matches.map((m) => {
          const t = m.tx;
          return html`<tr>
            <td class="c-check"><input type="checkbox" data-id="${t.id}" aria-label="Applica a ${m.name}"${raw(st.include.get(t.id) ? " checked" : "")}></td>
            <td class="c-date nowrap">${fmtDate(t.date)}</td>
            <td class="c-desc desc-cell"><strong>${m.name}</strong>${m.kind === "instalment" ? html` <span class="badge warn" title="Un terzo di un acquisto Paga in 3 dello stesso periodo">rata, probabile</span>` : ""}${t.paypalName ? html` <span class="badge subtle">già fatto</span>` : ""}<span class="cell-sub">${m.item ? `${m.item} · ` : ""}era: ${t.origDescription || t.description}</span></td>
            <td class="c-cat"><select class="input sm" data-cat="${t.id}" aria-label="Categoria di ${m.name}">${raw(t.kind === "Entrata" ? incOptions : expOptions)}</select></td>
            <td class="c-amount num ${t.kind === "Entrata" ? "pos" : "neg"}">${t.kind === "Entrata" ? "+" : MINUS}${fmtEUR(t.amount)}</td>
          </tr>`;
        })}</tbody></table></div>` : ""}
      <p class="muted"><button type="button" class="btn sm ghost" data-pp="change">${icon("file", 16)} Usa un altro file</button></p>`);
    root.querySelectorAll("select[data-cat]").forEach((sel) => {
      const v = st.cats.get(sel.dataset.cat);
      if (v && ![...sel.options].some((o) => o.value === v)) sel.add(new Option(v, v));
      sel.value = v;
    });
    applyBtn.disabled = !chosen.length;
    applyBtn.textContent = chosen.length ? `Applica a ${chosen.length} moviment${chosen.length === 1 ? "o" : "i"}` : "Applica";
  }

  async function load(file) {
    try {
      const sheet = await readSpreadsheet(await file.arrayBuffer());
      let rows;
      if (sheet) rows = sheet.rows;
      else {
        const text = await readFileText(file);
        rows = parseCsv(text, detectDelimiter(text));
      }
      const entries = parsePaypalActivity(rows);
      if (!entries) throw new Error("Il file non sembra l'attività di PayPal: servono le colonne Data, Nome e Lordo (o Importo).");
      const result = matchPaypal(entries, state.transactions);
      st.include = new Map();
      st.cats = new Map();
      for (const m of result.matches) {
        const t = m.tx;
        st.include.set(t.id, !t.paypalName);
        // Categoria: quella suggerita dal nome del negozio (regole, movimenti passati), altrimenti quella di adesso.
        const s = suggestCategory(m.name, t.kind, state.rules, state.transactions.filter((x) => x.id !== t.id), state.categories);
        const ok = s && s.category && s.category !== "Giroconto" && state.categories.some((c) => c.name === s.category && (t.kind === "Entrata" ? c.kind === "Entrata" : c.kind !== "Entrata"));
        st.cats.set(t.id, ok ? s.category : t.category || (t.kind === "Entrata" ? "Altre entrate" : "Altro"));
      }
      Object.assign(st, { name: file.name, result, error: "" });
    } catch (e) {
      st.result = null;
      st.error = (e && e.message) || "Lettura del file non riuscita.";
    }
    render();
  }

  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "pp-file" && el.files && el.files[0]) { load(el.files[0]); return; }
    if (el.dataset.id) { st.include.set(el.dataset.id, el.checked); const n = st.result.matches.filter((m) => st.include.get(m.tx.id)).length; applyBtn.disabled = !n; applyBtn.textContent = n ? `Applica a ${n} moviment${n === 1 ? "o" : "i"}` : "Applica"; }
    if (el.dataset.cat) st.cats.set(el.dataset.cat, el.value);
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest('[data-pp="change"]')) { st.result = null; render(); root.querySelector("#pp-file")?.click(); }
  });
  applyBtn.addEventListener("click", () => {
    if (!st.result) return;
    const ops = [];
    for (const m of st.result.matches) {
      if (!st.include.get(m.tx.id) || !app.store.find("transactions", m.tx.id)) continue;
      ops.push({ op: "update", coll: "transactions", id: m.tx.id, data: paypalPatch(m, st.cats.get(m.tx.id)) });
    }
    if (!ops.length) return;
    dlg.close();
    app.commitWithUndo(ops, ops.length === 1 ? "1 movimento PayPal aggiornato" : `${ops.length} movimenti PayPal aggiornati`);
  });
  render();
  return dlg;
}
