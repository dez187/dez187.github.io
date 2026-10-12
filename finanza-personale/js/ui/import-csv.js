import { html, raw, esc } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { fmtDate, fmtEUR, fmtSigned, onDate, round, MINUS } from "../lib/format.js";
import { readFileText } from "../lib/dom.js";
import { CARD_PAYMENT, assignImportIds, buildItems, cardSignInverted, detectDelimiter, findHeaderRow, guessMapping, isStatementPayment, itemToTransaction, markDuplicates, parseCsv, productValues, sheetHints, suggestCardPayment } from "../domain/csvimport.js";
import { readSpreadsheet } from "../lib/spreadsheet.js";
import { suggestCategory } from "../domain/rules.js";
import { sortCategories } from "../domain/categories.js";
import { CARD_CATEGORY, cardCategoryOp } from "../domain/cards.js";
import { openSheet } from "./feedback.js";
import { accountOptions } from "./components.js";

// Importazione di un estratto conto (CSV o Excel): file → colonne → anteprima con doppioni e categorie → salvataggio.
const MAX_ROWS = 400;
const TRANSFER = "__transfer__";

function parseTarget(v) {
  const s = String(v || "");
  if (s.startsWith("card:")) return { type: "card", id: s.slice(5) };
  if (s.startsWith("account:")) return { type: "account", id: s.slice(8) };
  return null;
}

// Oltre alle categorie, per i movimenti di un conto: giroconto e (per le uscite) addebito mensile di una carta.
function optionList(categories, kind, withTransfer, cards = []) {
  const list = sortCategories(categories).filter((c) => (kind === "Entrata" ? c.kind === "Entrata" : c.kind !== "Entrata"));
  const options = list.map((c) => `<option value="${esc(c.name)}">${esc((c.emoji ? c.emoji + " " : "") + c.name)}</option>`).join("");
  if (!withTransfer) return options;
  const special = `<option value="${TRANSFER}">🔁 Giroconto</option>` + cards.map((c) => `<option value="${esc(CARD_PAYMENT + c.id)}">${esc(`💳 Addebito ${c.name || "carta"}`)}</option>`).join("");
  return `<optgroup label="Categorie">${options}</optgroup><optgroup label="Tra i miei conti e carte">${special}</optgroup>`;
}

export function openCsvImport(app, { target = "" } = {}) {
  const { state } = app;
  const st = {
    target: target || (state.accounts[0] ? `account:${state.accounts[0].id}` : ""),
    name: "", rows: null, headerIndex: -1, headers: [], mapping: null, amountMode: "single",
    product: "", products: [], invert: false, invertTouched: false, items: [], include: new Map(), cats: new Map(),
    balanceMode: null, error: "", mappingOpen: false, hints: {},
  };
  const validCategory = (name, kind) => state.categories.some((c) => c.name === name && (kind === "Entrata" ? c.kind === "Entrata" : c.kind !== "Entrata"));

  const dlg = openSheet({
    title: "Importa estratto conto",
    wide: true,
    closeOnBackdrop: false,
    body: html`<div class="csv-import" data-root></div>`,
    footer: html`<span class="import-summary" data-summary></span><span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-import disabled>Importa</button>`,
  });
  const root = dlg.querySelector("[data-root]");
  const summaryEl = dlg.querySelector("[data-summary]");
  const importBtn = dlg.querySelector("[data-import]");

  const colOptions = (value, allowNone = true) => html`${allowNone ? html`<option value="-1">— nessuna —</option>` : ""}${st.headers.map((h, i) => html`<option value="${i}"${raw(i === value ? " selected" : "")}>${h || `Colonna ${i + 1}`}</option>`)}`;

  function recompute() {
    const t = parseTarget(st.target);
    if (!st.rows || !t) { st.items = []; return; }
    const m = { ...st.mapping };
    if (st.amountMode === "single") { m.debit = -1; m.credit = -1; } else m.amount = -1;
    // Gli estratti delle carte riportano spesso le spese in positivo: in quel caso il segno si inverte da solo.
    const opts = { product: st.product, dateOrder: st.hints.dateOrder };
    if (!st.invertTouched) st.invert = t.type === "card" && cardSignInverted(buildItems(st.rows, st.headerIndex, m, opts).items);
    const { items } = buildItems(st.rows, st.headerIndex, m, { ...opts, invert: st.invert });
    assignImportIds(items, st.target);
    markDuplicates(items, state.transactions, t);
    for (const it of items) {
      if (it.skip) { st.include.set(it.line, false); continue; }
      const kind = it.amount < 0 ? "Uscita" : "Entrata";
      // Nell'estratto di una carta il pagamento del mese precedente non è un rimborso: resta da parte.
      it.payment = t.type === "card" && kind === "Entrata" && isStatementPayment(it.description);
      if (!st.include.has(it.line)) st.include.set(it.line, !it.dup && !it.payment);
      if (!st.cats.has(it.line)) {
        const s = suggestCategory(it.description, kind, state.rules, state.transactions, state.categories);
        let cat = s ? s.category : "";
        // L'addebito mensile di una carta sul conto: una regola esplicita vince, il resto no.
        const byRule = s && s.source === "rule" && cat !== CARD_CATEGORY;
        const cardId = t.type === "account" && kind === "Uscita" && !byRule ? suggestCardPayment(it.description, state.creditCards) : null;
        if (cardId) cat = CARD_PAYMENT + cardId;
        else {
          if (cat === "Giroconto") cat = t.type === "account" ? TRANSFER : "";
          if (cat !== TRANSFER && !validCategory(cat, kind)) cat = kind === "Entrata" ? "Altre entrate" : "Altro";
        }
        st.cats.set(it.line, cat);
      }
    }
    st.items = items;
    if (st.balanceMode == null) st.balanceMode = defaultBalanceMode(t);
  }

  function latestWithBalance() {
    const withBal = st.items.filter((it) => !it.skip && it.balance != null);
    if (!withBal.length) return null;
    const asc = withBal[0].date <= withBal[withBal.length - 1].date;
    const maxDate = withBal.reduce((m, it) => (it.date > m ? it.date : m), "");
    const sameDay = withBal.filter((it) => it.date === maxDate);
    return asc ? sameDay[sameDay.length - 1] : sameDay[0];
  }

  function defaultBalanceMode(t) {
    if (!t) return "keep";
    if (t.type === "card") {
      // Uno speso senza data di solito comprende già le spese dell'estratto: meglio non sommarle di nuovo.
      const card = state.creditCards.find((c) => c.id === t.id);
      return card && !card.spentDate ? "today" : "keep";
    }
    const acc = state.accounts.find((a) => a.id === t.id);
    const last = latestWithBalance();
    if (last && (!acc.balanceDate || acc.balanceDate <= last.date)) return "file";
    if (!acc.balanceDate) return "today";
    return "keep";
  }

  function balanceSection() {
    const t = parseTarget(st.target);
    if (!t || !st.items.length) return "";
    const chosen = st.items.filter((it) => !it.skip && st.include.get(it.line));
    const radio = (value, label, sub) => html`<label class="choice"><input type="radio" name="balanceMode" value="${value}"${raw(st.balanceMode === value ? " checked" : "")}><span><strong>${label}</strong>${sub ? html`<span class="muted">${sub}</span>` : ""}</span></label>`;
    if (t.type === "card") {
      const card = state.creditCards.find((c) => c.id === t.id);
      if (!card) return "";
      const inverted = st.invert ? html`<p class="form-note">Nel file le spese sono in positivo: il segno è stato invertito (si cambia in “Colonne del file”).</p>` : "";
      if (card.spentDate) return html`<p class="form-note">Lo speso della carta è aggiornato ${onDate("a", card.spentDate)}: le spese importate con data successiva si sommano allo speso.</p>${inverted}`;
      const added = chosen.filter((it) => it.date <= app.today).reduce((s, it) => s - it.amount, 0);
      return html`<fieldset class="choices"><legend class="field-label">Speso di ${card.name}: ${fmtEUR(card.spent)}, senza data</legend>
        ${radio("today", `Lo speso che vedi ora (${fmtEUR(app.derived().totals.cards.get(card.id)?.spent || 0)}) è giusto a oggi`, "Le spese importate servono come storico e non cambiano lo speso.")}
        ${radio("keep", "Somma le spese importate allo speso", `Lo speso cambierà di ${fmtSigned(added)}.`)}
      </fieldset>${inverted}`;
    }
    const acc = state.accounts.find((a) => a.id === t.id);
    const last = latestWithBalance();
    const after = chosen.filter((it) => !acc.balanceDate || it.date > acc.balanceDate);
    const delta = after.reduce((s, it) => s + it.amount, 0);
    const which = acc.balanceDate ? "successiv# alla data del saldo" : "importat#";
    const keepText = !after.length ? "Nessun movimento importato cambia il saldo."
      : after.length === 1 ? `Il movimento ${which.replace("#", "o")} lo cambierà di ${fmtSigned(delta)}.`
        : `I ${after.length} movimenti ${which.replace("#", "i")} lo cambieranno di ${fmtSigned(delta)}.`;
    return html`<fieldset class="choices"><legend class="field-label">Saldo di ${acc.name}: ${fmtEUR(acc.balance)}${acc.balanceDate ? ` aggiornato ${onDate("a", acc.balanceDate)}` : ", senza data"}</legend>
      ${last ? radio("file", `Usa il saldo del file: ${fmtEUR(last.balance)} ${onDate("a", last.date)}`, "Consigliato: il saldo della banca include già i movimenti importati.") : ""}
      ${!acc.balanceDate ? radio("today", `Il saldo che vedi ora (${fmtEUR(app.derived().totals.balances.get(acc.id) || 0)}) è giusto a oggi`, "I movimenti importati servono come storico e non cambiano il saldo.") : ""}
      ${radio("keep", "Lascia il saldo com'è", keepText)}
    </fieldset>`;
  }

  function renderStart(message) {
    root.innerHTML = String(html`
      <div class="form-grid">
        <label class="field" for="ci-target"><span class="field-label">Conto o carta dell'estratto</span><select class="input" id="ci-target" name="target">${accountOptions(state, st.target, { prefix: "account:", cards: true })}</select></label>
        <label class="field" for="ci-file"><span class="field-label">File CSV o Excel</span><input class="input file" id="ci-file" type="file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
      </div>
      ${message ? html`<p class="form-error" role="alert">${message}</p>` : ""}
      <div class="help-box">
        <p><strong>Dove trovare il file</strong></p>
        <ul>
          <li><strong>Revolut</strong>: nel conto, Estratto conto → Excel/CSV, scegli il periodo e scarica.</li>
          <li><strong>Banco BPM</strong> (YouWeb): Conti → Movimenti → esporta in Excel o CSV.</li>
          <li><strong>Unicredit</strong>: Conti → Movimenti → esporta in Excel (va bene anche il vecchio formato .xls).</li>
          <li><strong>American Express</strong>: Estratti conto e attività → Scarica → Excel.</li>
          <li><strong>Nexi</strong> (app o sito Nexi Pay): Movimenti → esporta in Excel.</li>
          <li>Qualsiasi altra banca: un file Excel o CSV con data, descrizione e importo (o colonne entrate/uscite) va bene.</li>
        </ul>
        <p class="muted">Il file viene letto solo sul tuo dispositivo. I movimenti già presenti vengono riconosciuti e non si duplicano, anche se importi due volte lo stesso file.</p>
        <p>Molti addebiti si chiamano solo “PayPal”? Dopo l'estratto <button type="button" class="btn sm ghost" data-action="import-paypal">${icon("upload", 16)} carica l'attività PayPal</button> per vedere i negozi.</p>
      </div>`);
    importBtn.disabled = true;
    summaryEl.textContent = "";
  }

  function render() {
    if (!st.rows) return renderStart(st.error);
    // Il riquadro delle colonne resta com'era (aperto, se lo si sta usando).
    const mappingBox = root.querySelector("details.mapping");
    if (mappingBox) st.mappingOpen = mappingBox.open;
    recompute();
    const t = parseTarget(st.target);
    const items = st.items;
    const valid = items.filter((it) => !it.skip);
    const chosen = valid.filter((it) => st.include.get(it.line));
    const dup = valid.filter((it) => it.dup).length;
    const skipped = items.filter((it) => it.skip).length;
    const inc = chosen.filter((it) => it.amount > 0).reduce((s, it) => s + it.amount, 0);
    const out = chosen.filter((it) => it.amount < 0).reduce((s, it) => s - it.amount, 0);
    const shown = items.slice(0, MAX_ROWS);
    const m = st.mapping;
    const expOpts = optionList(state.categories, "Uscita", t && t.type === "account", state.creditCards);
    const incOpts = optionList(state.categories, "Entrata", t && t.type === "account");
    root.innerHTML = String(html`
      <div class="form-grid three">
        <label class="field" for="ci-target"><span class="field-label">Conto o carta</span><select class="input" id="ci-target" name="target">${accountOptions(state, st.target, { prefix: "account:", cards: true })}</select></label>
        <div class="field"><span class="field-label">File</span><span class="file-name">${icon("file", 16)} ${st.name} <button type="button" class="btn sm ghost" data-ci="change-file">Cambia</button></span></div>
        ${st.products.length > 1 ? html`<label class="field" for="ci-product"><span class="field-label">Sezione del conto</span><select class="input" id="ci-product" name="product">${st.products.map((p) => html`<option value="${p}"${raw(p === st.product ? " selected" : "")}>${p}</option>`)}</select><span class="field-hint">Il file contiene più sezioni (es. conto e risparmi): importane una per volta.</span></label>` : ""}
      </div>
      <details class="mapping"${raw(st.mappingOpen || !valid.length ? " open" : "")}>
        <summary>${icon("table", 16)} Colonne del file</summary>
        <div class="form-grid three">
          <label class="field" for="ci-date"><span class="field-label">Data</span><select class="input" id="ci-date" name="map-date">${colOptions(m.date, false)}</select></label>
          <label class="field" for="ci-desc"><span class="field-label">Descrizione</span><select class="input" id="ci-desc" name="map-description">${colOptions(m.description)}</select></label>
          <label class="field" for="ci-mode"><span class="field-label">Importi</span><select class="input" id="ci-mode" name="amountMode"><option value="single"${raw(st.amountMode === "single" ? " selected" : "")}>Una colonna (negativi = uscite)</option><option value="split"${raw(st.amountMode === "split" ? " selected" : "")}>Due colonne: entrate e uscite</option></select></label>
          ${st.amountMode === "single"
            ? html`<label class="field" for="ci-amount"><span class="field-label">Importo</span><select class="input" id="ci-amount" name="map-amount">${colOptions(m.amount, false)}</select></label>`
            : html`<label class="field" for="ci-credit"><span class="field-label">Entrate (avere)</span><select class="input" id="ci-credit" name="map-credit">${colOptions(m.credit)}</select></label><label class="field" for="ci-debit"><span class="field-label">Uscite (dare)</span><select class="input" id="ci-debit" name="map-debit">${colOptions(m.debit)}</select></label>`}
          <label class="field" for="ci-balance"><span class="field-label">Saldo (facoltativo)</span><select class="input" id="ci-balance" name="map-balance">${colOptions(m.balance)}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="invert"${raw(st.invert ? " checked" : "")}><span>Inverti il segno (per estratti in cui le spese sono positive, come quelli delle carte)</span></label>
      </details>
      ${balanceSection()}
      <div class="import-counts" role="status">
        <span><strong>${chosen.length}</strong> da importare</span>
        ${inc > 0 ? html`<span class="pos">+${fmtEUR(inc)}</span>` : ""}${out > 0 ? html`<span class="neg">${MINUS}${fmtEUR(out)}</span>` : ""}
        ${dup ? html`<span class="muted">${dup} già presenti o simili</span>` : ""}
        ${skipped ? html`<span class="muted">${skipped} saltati</span>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn sm ghost" data-ci="all">Seleziona tutti i nuovi</button>
      </div>
      <div class="table-wrap import-table"><table class="table">
        <thead><tr><th scope="col"><span class="sr-only">Importa</span></th><th scope="col">Data</th><th scope="col">Descrizione</th><th scope="col">Categoria</th><th scope="col" class="num">Importo</th><th scope="col">Stato</th></tr></thead>
        <tbody>${shown.map((it) => {
          const status = it.skip ? html`<span class="badge subtle">${it.skip}</span>`
            : it.dup === "imported" ? html`<span class="badge subtle">già importato</span>`
            : it.dup === "present" ? html`<span class="badge warn">già presente</span>`
            : it.dup === "similar" ? html`<span class="badge warn">possibile doppione</span>`
            : it.payment ? html`<span class="badge warn" title="Il pagamento dell'estratto precedente non è un rimborso: di solito non va importato.">pagamento dell'estratto</span>`
            : html`<span class="badge pos">nuovo</span>`;
          return html`<tr class="${it.skip ? "is-skipped" : ""}">
            <td class="c-check"><input type="checkbox" data-line="${it.line}" aria-label="Importa la riga ${it.line}"${raw(!it.skip && st.include.get(it.line) ? " checked" : "")}${raw(it.skip ? " disabled" : "")}></td>
            <td class="c-date nowrap">${it.date ? fmtDate(it.date) : "—"}</td>
            <td class="c-desc desc-cell">${it.description}</td>
            <td class="c-cat">${it.skip ? "" : html`<select class="input sm" data-cat="${it.line}" aria-label="Categoria della riga ${it.line}">${raw(it.amount < 0 ? expOpts : incOpts)}</select>`}</td>
            <td class="c-amount num ${it.amount > 0 ? "pos" : it.amount < 0 ? "neg" : ""}">${it.amount == null ? "—" : fmtSigned(it.amount)}</td>
            <td class="c-status">${status}</td>
          </tr>`;
        })}</tbody>
      </table></div>
      ${items.length > shown.length ? html`<p class="muted">Anteprima delle prime ${MAX_ROWS} righe su ${items.length}: le altre vengono importate con le stesse regole.</p>` : ""}
      ${!items.length ? html`<p class="form-error" role="alert">Nessun movimento riconosciuto: controlla le colonne qui sopra.</p>` : ""}`);
    root.querySelectorAll("select[data-cat]").forEach((sel) => {
      const v = st.cats.get(Number(sel.dataset.cat));
      // Una categoria che non è più in elenco resta selezionabile, così ciò che si vede è ciò che si salva.
      if (v && ![...sel.options].some((o) => o.value === v)) sel.add(new Option(v, v));
      sel.value = v;
    });
    importBtn.disabled = !chosen.length;
    importBtn.textContent = chosen.length ? `Importa ${chosen.length} moviment${chosen.length === 1 ? "o" : "i"}` : "Importa";
    summaryEl.textContent = "";
  }

  async function loadFile(file) {
    try {
      // Excel (.xlsx o .xls) si riconosce dal contenuto, non dal nome; il resto si legge come CSV.
      const sheet = await readSpreadsheet(await file.arrayBuffer());
      let rows;
      if (sheet) rows = sheet.rows;
      else {
        const text = await readFileText(file);
        rows = parseCsv(text, detectDelimiter(text));
      }
      if (rows.length < 2) throw new Error(sheet ? "Il foglio Excel è vuoto." : "Il file è vuoto o non è un CSV.");
      let headerIndex = findHeaderRow(rows);
      let headers;
      if (headerIndex >= 0) headers = rows[headerIndex];
      else {
        headerIndex = -1;
        const width = Math.max(...rows.slice(0, 20).map((r) => r.length));
        headers = Array.from({ length: width }, (_, i) => `Colonna ${i + 1}`);
      }
      const mapping = headerIndex >= 0 ? guessMapping(headers) : { date: 0, description: 1, amount: 2, debit: -1, credit: -1, balance: -1, fee: -1, state: -1, product: -1, currency: -1, type: -1, category: -1 };
      Object.assign(st, { name: file.name, rows, headerIndex, headers, mapping, amountMode: mapping.amount >= 0 ? "single" : "split", include: new Map(), cats: new Map(), balanceMode: null, error: "", invert: false, invertTouched: false, mappingOpen: false, hints: sheetHints(rows, headerIndex) });
      st.products = productValues(rows, headerIndex, mapping);
      st.product = st.products.length > 1 ? st.products[0] : "";
      render();
    } catch (e) {
      st.rows = null;
      st.error = (e && e.message) || "Lettura del file non riuscita.";
      render();
    }
  }

  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "ci-file" && el.files && el.files[0]) { loadFile(el.files[0]); return; }
    if (el.name === "target") { st.target = el.value; st.include = new Map(); st.cats = new Map(); st.balanceMode = null; render(); return; }
    if (el.name === "product") { st.product = el.value; st.include = new Map(); st.cats = new Map(); st.balanceMode = null; render(); return; }
    if (el.name === "amountMode") { st.amountMode = el.value; st.include = new Map(); st.cats = new Map(); st.balanceMode = null; render(); return; }
    if (el.name && el.name.startsWith("map-")) { st.mapping[el.name.slice(4)] = Number(el.value); st.include = new Map(); st.cats = new Map(); st.balanceMode = null; render(); return; }
    if (el.name === "invert") { st.invert = el.checked; st.invertTouched = true; st.include = new Map(); st.cats = new Map(); render(); return; }
    if (el.name === "balanceMode") { st.balanceMode = el.value; return; }
    if (el.dataset.line) { st.include.set(Number(el.dataset.line), el.checked); renderInPlace(`input[data-line="${el.dataset.line}"]`); return; }
    if (el.dataset.cat) { st.cats.set(Number(el.dataset.cat), el.value); }
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ci]");
    if (!b) return;
    if (b.dataset.ci === "change-file") { st.rows = null; st.error = ""; render(); root.querySelector("#ci-file")?.click(); }
    if (b.dataset.ci === "all") { for (const it of st.items) if (!it.skip && !it.dup && !it.payment) st.include.set(it.line, true); renderInPlace('[data-ci="all"]'); }
  });

  // Ridisegna senza perdere il punto in cui si era arrivati nell'elenco, né il focus.
  function renderInPlace(focusSelector) {
    const body = dlg.querySelector(".sheet-body");
    const table = root.querySelector(".import-table");
    const pos = [body ? body.scrollTop : 0, table ? table.scrollTop : 0];
    render();
    if (body) body.scrollTop = pos[0];
    const again = root.querySelector(".import-table");
    if (again) again.scrollTop = pos[1];
    root.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  importBtn.addEventListener("click", () => {
    const t = parseTarget(st.target);
    if (!t) return;
    const now = Date.now();
    const ops = [];
    let n = 0;
    for (const it of st.items) {
      if (it.skip || !st.include.get(it.line)) continue;
      ops.push({ op: "set", coll: "transactions", id: it.id, data: itemToTransaction(it, t, st.cats.get(it.line), now + n, state.creditCards) });
      n++;
    }
    if (!n) return;
    const catOp = ops.some((o) => o.data.cardPaymentFor) ? cardCategoryOp(state.categories) : null;
    if (catOp) ops.unshift(catOp);
    // "Aggiornato a oggi": il valore registrato diventa quello che l'app mostra adesso, così non cambia.
    const totals = app.derived().totals;
    if (t.type === "account") {
      const last = latestWithBalance();
      if (st.balanceMode === "file" && last) ops.push({ op: "update", coll: "accounts", id: t.id, data: { balance: last.balance, balanceDate: last.date } });
      if (st.balanceMode === "today") ops.push({ op: "update", coll: "accounts", id: t.id, data: { balance: round(totals.balances.get(t.id) || 0, 2), balanceDate: app.today } });
    } else {
      const card = state.creditCards.find((c) => c.id === t.id);
      if (card && !card.spentDate && st.balanceMode === "today") ops.push({ op: "update", coll: "creditCards", id: t.id, data: { spent: round(totals.cards.get(t.id)?.spent || 0, 2), spentDate: app.today } });
    }
    dlg.close();
    app.commitWithUndo(ops, `Importat${n === 1 ? "o 1 movimento" : `i ${n} movimenti`}`);
  });

  render();
  return dlg;
}
