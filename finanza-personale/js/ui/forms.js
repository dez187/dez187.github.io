import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { numToInput, parseAmount } from "../lib/format.js";
import { ACCOUNT_TYPES, CARD_NETWORKS } from "../domain/finance.js";
import { PAC_FREQUENCIES } from "../domain/pac.js";
import { categoryId, guessEmoji, sortCategories } from "../domain/categories.js";
import { RULE_KINDS } from "../domain/rules.js";
import { openSheet } from "./feedback.js";
import { accountOptions, assetOptions } from "./components.js";
import { emojiFieldHTML, wireEmojiFields } from "./emoji-picker.js";
import { formatIban, ibanError, isValidIban, normalizeIban } from "../lib/iban.js";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

// Schede dei moduli: una per tipo di elemento.
export const ENTITY_FORMS = {
  accounts: {
    noun: "conto", titles: ["Nuovo conto", "Modifica conto"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true, placeholder: "es. Conto principale" },
      { key: "bank", label: "Banca o istituto", type: "text" },
      { key: "type", label: "Tipo", type: "select", options: ACCOUNT_TYPES },
      { key: "iban", label: "IBAN", type: "iban", wide: true, placeholder: "IT00 X000 0000 0000 0000 0000 000", hint: "Facoltativo: lo vedi nella pagina Conti e lo copi con un tocco." },
      { key: "balance", label: "Saldo (€)", type: "amount", required: true, negative: true },
      { key: "balanceDate", label: "Saldo aggiornato al", type: "date", hint: "I movimenti successivi a questa data si aggiungono o si sottraggono da soli. Cambiando il saldo, la data passa a oggi." },
      { key: "note", label: "Note", type: "textarea", wide: true },
    ],
    defaults: (today) => ({ type: "Conto corrente", balanceDate: today }),
  },
  creditCards: {
    noun: "carta", titles: ["Nuova carta di credito", "Modifica carta di credito"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true, placeholder: "es. Amex" },
      { key: "issuer", label: "Emittente", type: "text" },
      { key: "network", label: "Circuito", type: "select", options: CARD_NETWORKS },
      { key: "limit", label: "Massimale mensile (€)", type: "amount", required: true },
      { key: "spent", label: "Speso finora (€)", type: "amount" },
      { key: "spentDate", label: "Speso aggiornato al", type: "date" },
      { key: "resetDate", label: "Prossimo rinnovo plafond", type: "date", hint: "Da questa data il credito torna disponibile." },
      { key: "note", label: "Note", type: "textarea", wide: true },
    ],
    defaults: (today, addMonth) => ({ limit: 1500, spent: 0, spentDate: today, resetDate: addMonth(today), network: "Visa" }),
  },
  loans: {
    noun: "finanziamento", titles: ["Nuovo finanziamento", "Modifica finanziamento"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true, placeholder: "es. Prestito auto" },
      { key: "lender", label: "Istituto", type: "text" },
      { key: "principal", label: "Capitale iniziale (€)", type: "amount" },
      { key: "remaining", label: "Debito residuo (€)", type: "amount", required: true },
      { key: "rate", label: "Tasso annuo (%)", type: "number" },
      { key: "monthlyPayment", label: "Rata mensile (€)", type: "amount" },
      { key: "accountId", label: "Conto di addebito", type: "account" },
      { key: "nextDate", label: "Prossima rata", type: "date", hint: "Con conto e data, alla scadenza l'app registra la rata e scala la quota capitale dal debito residuo." },
      { key: "endDate", label: "Ultima rata", type: "month" },
      { key: "note", label: "Note", type: "textarea", wide: true },
    ],
    defaults: () => ({}),
  },
  etf: {
    noun: "ETF", titles: ["Nuovo ETF", "Modifica ETF"],
    fields: holdingFields("broker", "Broker", true),
    defaults: () => ({}),
  },
  stocks: {
    noun: "azione", titles: ["Nuova azione", "Modifica azione"],
    fields: holdingFields("broker", "Broker", true),
    defaults: () => ({}),
  },
  crypto: {
    noun: "crypto", titles: ["Nuova crypto", "Modifica crypto"],
    fields: holdingFields("exchange", "Exchange o wallet", false),
    defaults: () => ({}),
  },
  pac: {
    noun: "piano di accumulo", titles: ["Nuovo piano di accumulo", "Modifica piano di accumulo"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true, placeholder: "es. PAC MSCI World" },
      { key: "asset", label: "Strumento", type: "asset", required: true },
      { key: "amount", label: "Importo per versamento (€)", type: "amount", required: true },
      { key: "frequency", label: "Frequenza", type: "select", options: PAC_FREQUENCIES },
      { key: "nextDate", label: "Prossimo versamento", type: "date", required: true },
      { key: "accountId", label: "Conto di addebito", type: "account" },
      { key: "status", label: "Stato", type: "select", options: ["Attivo", "In pausa"] },
      { key: "note", label: "Note", type: "textarea", wide: true },
    ],
    defaults: (today) => ({ frequency: "Mensile", nextDate: today, status: "Attivo" }),
  },
  categories: {
    noun: "categoria", titles: ["Nuova categoria", "Modifica categoria"],
    fields: [
      { key: "emoji", label: "Icona", type: "emoji", placeholder: "🏷️" },
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "kind", label: "Tipo", type: "select", options: ["Uscita", "Entrata"] },
      { key: "budget", label: "Budget mensile (€)", type: "amount", hint: "Lascia 0 per non impostare un budget." },
    ],
    defaults: () => ({ kind: "Uscita", budget: 0 }),
  },
  rules: {
    noun: "regola", titles: ["Nuova regola", "Modifica regola"],
    fields: [
      { key: "pattern", label: "Se la descrizione contiene", type: "text", required: true, placeholder: "es. Esselunga", wide: true, hint: "Maiuscole e accenti non contano." },
      { key: "category", label: "Usa la categoria", type: "category", required: true, withTransfer: true },
      { key: "kind", label: "Vale per", type: "select", options: RULE_KINDS },
    ],
    defaults: () => ({ kind: "Tutti" }),
  },
  goals: {
    noun: "obiettivo", titles: ["Nuovo obiettivo", "Modifica obiettivo"],
    fields: [
      { key: "emoji", label: "Icona", type: "emoji", placeholder: "🎯" },
      { key: "name", label: "Nome", type: "text", required: true, placeholder: "es. Fondo emergenze" },
      { key: "target", label: "Obiettivo (€)", type: "amount", required: true },
      { key: "targetDate", label: "Da raggiungere entro", type: "month" },
      { key: "accountId", label: "Conto collegato", type: "account", hint: "Il progresso segue il saldo del conto. Senza conto, aggiorni tu quanto hai messo da parte." },
      { key: "saved", label: "Già messo da parte (€)", type: "amount", hint: "Usato solo se non colleghi un conto." },
      { key: "note", label: "Note", type: "textarea", wide: true },
    ],
    defaults: () => ({ emoji: "🎯", saved: 0 }),
  },
};

function categorySelectOptions(categories, value, withTransfer) {
  const list = sortCategories(categories || []);
  const out = list.filter((c) => c.kind !== "Entrata");
  const inc = list.filter((c) => c.kind === "Entrata");
  const opt = (name, label) => html`<option value="${name}"${raw(name === value ? " selected" : "")}>${label}</option>`;
  const known = list.some((c) => c.name === value) || (withTransfer && value === "Giroconto");
  return html`
    <optgroup label="Uscite">${out.map((c) => opt(c.name, `${c.emoji ? c.emoji + " " : ""}${c.name}`))}</optgroup>
    <optgroup label="Entrate">${inc.map((c) => opt(c.name, `${c.emoji ? c.emoji + " " : ""}${c.name}`))}</optgroup>
    ${withTransfer ? html`<optgroup label="Tra i miei conti">${opt("Giroconto", "🔁 Giroconto (escluso da entrate e uscite)")}</optgroup>` : ""}
    ${value && !known ? opt(value, value) : ""}`;
}

function holdingFields(placeKey, placeLabel, withIsin) {
  const f = [
    { key: "name", label: "Nome", type: "text", required: true },
    withIsin
      ? { key: "isin", label: "ISIN", type: "isin", hint: "Serve per aggiornare il prezzo in automatico (es. IE00B4L5Y983)." }
      : { key: "symbol", label: "Simbolo", type: "text", placeholder: "es. BTC", hint: "Serve per aggiornare il prezzo in automatico.", upper: true },
    { key: placeKey, label: placeLabel, type: "text" },
    { key: "quantity", label: "Quantità", type: "number", required: true },
    { key: "avgPrice", label: "Prezzo medio di carico (€)", type: "number", hint: "Lascia 0 se non lo conosci: il guadagno non verrà stimato." },
    { key: "currentPrice", label: "Prezzo attuale (€)", type: "number", required: true },
    { key: "note", label: "Note", type: "textarea", wide: true },
  ];
  return f;
}

export function fieldHTML(f, value, state) {
  if (f.type === "emoji") return emojiFieldHTML(f, value);
  const id = `f-${f.key}`;
  const common = raw(` id="${id}" name="${f.key}"${f.required ? " required" : ""} autocomplete="off"`);
  let input;
  if (f.type === "select") {
    input = html`<select class="input"${common}>${f.options.map((o) => html`<option value="${o}"${raw(o === value ? " selected" : "")}>${o}</option>`)}</select>`;
  } else if (f.type === "account") {
    input = html`<select class="input"${common}><option value="">— nessuno —</option>${accountOptions(state, value || "")}</select>`;
  } else if (f.type === "asset") {
    input = html`<select class="input"${common}><option value="">— scegli —</option>${assetOptions(state, value || "")}</select>`;
  } else if (f.type === "category") {
    input = html`<select class="input"${common}><option value="">— scegli —</option>${categorySelectOptions(state.categories, value || "", f.withTransfer)}</select>`;
  } else if (f.type === "textarea") {
    input = html`<textarea class="input" rows="2"${common}>${value || ""}</textarea>`;
  } else if (f.type === "date" || f.type === "month") {
    input = html`<input class="input" type="${f.type}" value="${value || ""}"${common}>`;
  } else if (f.type === "iban") {
    input = html`<input class="input input-iban" type="text" value="${value ? formatIban(value) : ""}" maxlength="50" spellcheck="false" autocapitalize="characters" translate="no" data-iban${common}${f.placeholder ? html` placeholder="${f.placeholder}"` : ""}>`;
  } else if (f.type === "amount" || f.type === "number") {
    input = html`<input class="input num" type="text" inputmode="decimal" value="${numToInput(value)}"${common}${f.placeholder ? html` placeholder="${f.placeholder}"` : ""}>`;
  } else {
    input = html`<input class="input" type="text" value="${value || ""}"${common}${f.placeholder ? html` placeholder="${f.placeholder}"` : ""}${f.maxlength ? html` maxlength="${f.maxlength}"` : ""}${f.type === "isin" || f.upper ? raw(' spellcheck="false" autocapitalize="characters"') : ""}>`;
  }
  return html`<label class="field${f.wide ? " wide" : ""}${f.narrow ? " narrow" : ""}" for="${id}"><span class="field-label">${f.label}${f.required ? html`<span class="req" aria-hidden="true"> *</span>` : ""}</span>${input}${f.hint ? html`<span class="field-hint">${f.hint}</span>` : ""}</label>`;
}

// Legge e valida i campi: restituisce { data } oppure { error, field }.
export function readFields(form, fields) {
  const data = {};
  for (const f of fields) {
    const el = form.elements.namedItem(f.key);
    if (!el || el.disabled) continue;
    let v = el.value;
    if (f.type === "amount" || f.type === "number") {
      if (String(v).trim() === "") {
        if (f.required) return { error: `Compila "${f.label}".`, field: f.key };
        v = 0;
      } else {
        v = parseAmount(v);
        if (!Number.isFinite(v)) return { error: `"${f.label}": numero non valido.`, field: f.key };
        if (v < 0 && !f.negative) return { error: `"${f.label}" non può essere negativo.`, field: f.key };
      }
    } else {
      v = String(v).trim();
      if (f.type === "isin" || f.upper) v = v.toUpperCase().replace(/\s+/g, "");
      if (f.type === "iban") v = normalizeIban(v);
      if (f.required && !v) return { error: `Compila "${f.label}".`, field: f.key };
      if (f.type === "isin" && v && !ISIN_RE.test(v)) return { error: "ISIN non valido: 12 caratteri, es. IE00B4L5Y983.", field: f.key };
      // Un IBAN già salvato e non toccato (es. arrivato da un file) non blocca le altre modifiche del conto.
      if (f.type === "iban" && v && ibanError(v) && (typeof el.defaultValue !== "string" || normalizeIban(el.defaultValue) !== v)) return { error: ibanError(v), field: f.key };
    }
    data[f.key] = v;
  }
  return { data };
}

// Cambiando saldo o speso senza toccare la data, la data di riferimento passa a oggi:
// i movimenti già registrati sono per forza inclusi nel nuovo valore.
export function refreshAsOfDate(coll, prev, data, today) {
  const pair = coll === "accounts" ? ["balance", "balanceDate"] : coll === "creditCards" ? ["spent", "spentDate"] : null;
  if (!pair || !prev) return data;
  const [valKey, dateKey] = pair;
  const changed = Math.abs(Number(data[valKey] || 0) - Number(prev[valKey] || 0)) > 0.0001;
  if (changed && (data[dateKey] || "") === (prev[dateKey] || "")) data[dateKey] = today;
  return data;
}

export function showFormError(form, message, field) {
  const box = form.querySelector(".form-error");
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
  if (field) {
    const el = form.elements.namedItem(field);
    if (el && el.focus) el.focus();
  }
}

// Modulo generico in una finestra: onSubmit(data) restituisce true per chiudere o un messaggio d'errore.
export function openFormSheet({ title, fieldsHTML, submitLabel = "Salva", onSubmit, extraFooter, wide = false, onReady }) {
  const dlg = openSheet({
    title,
    wide,
    closeOnBackdrop: false,
    body: html`<form class="form" novalidate><div class="form-grid">${fieldsHTML}</div><p class="form-error" role="alert" hidden></p><button type="submit" hidden></button></form>`,
    footer: html`${extraFooter || ""}<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-submit>${submitLabel}</button>`,
  });
  const form = dlg.querySelector("form");
  const submitBtn = dlg.querySelector("[data-submit]");
  let busy = false;
  const submit = async () => {
    if (busy) return;
    const box = form.querySelector(".form-error");
    box.hidden = true;
    busy = true;
    submitBtn.disabled = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = "Salvataggio…";
    try {
      const res = await onSubmit(form, dlg);
      if (res === true) dlg.close();
      else if (res && res.error) showFormError(form, res.error, res.field);
    } catch (e) {
      console.error(e);
      showFormError(form, "Salvataggio non riuscito: " + ((e && e.message) || "errore sconosciuto"));
    } finally {
      busy = false;
      if (dlg.open) {
        submitBtn.disabled = false;
        submitBtn.textContent = label;
      }
    }
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  submitBtn.addEventListener("click", submit);
  wireEmojiFields(form);
  // L'IBAN, se è giusto, si rimette a gruppi di quattro uscendo dal campo (si salva comunque senza spazi).
  for (const el of form.querySelectorAll("[data-iban]")) el.addEventListener("blur", () => { if (isValidIban(el.value)) el.value = formatIban(el.value); });
  if (onReady) onReady(form, dlg);
  // Il primo campo da compilare (il menu delle icone è facoltativo e resta chiuso).
  const first = [...form.querySelectorAll("input:not([type=hidden]):not([disabled]), select, textarea")].find((el) => !el.closest("[hidden]") && !el.closest("[data-emoji-field]"));
  if (first) first.focus();
  return dlg;
}

export function deleteButton(label = "Elimina") {
  return html`<button type="button" class="btn ghost danger-text" data-delete>${icon("trash", 18)} ${label}</button>`;
}

export function newCategoryOp(name, kind) {
  const n = String(name || "").trim();
  return { op: "set", coll: "categories", id: categoryId(n), data: { name: n, emoji: guessEmoji(n), kind: kind === "Entrata" ? "Entrata" : "Uscita", budget: 0, order: 900 } };
}
