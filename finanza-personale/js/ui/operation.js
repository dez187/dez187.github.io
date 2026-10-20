import { html, raw } from "../lib/html.js";
import { FREQUENCIES, addDays } from "../lib/dates.js";
import { fmtDate, numToInput, onDate, parseAmount, round } from "../lib/format.js";
import { nameOf, staleTxFields } from "../domain/finance.js";
import { cleanName, knownNames } from "../domain/people.js";
import { countDue, nextOccurrence, readEnd, scheduleEndText, scheduleTxDeleteOps } from "../domain/schedules.js";
import { openSheet, confirmDialog } from "./feedback.js";
import { accountOptions, categoryOptions } from "./components.js";
import { newCategoryOp } from "./forms.js";
import { normText, suggestCategory } from "../domain/rules.js";
import { offerRuleApply } from "./entity.js";

// Nuova operazione: Uscita, Entrata, Giroconto (anche ripetuto) o Ricorrente (spesa o entrata programmata).
const MODES = ["Uscita", "Entrata", "Giroconto", "Ricorrente"];
const REPEAT = ["Nessuna", ...FREQUENCIES];

function payValue(t) {
  if (t.cardId) return `card:${t.cardId}`;
  if (t.accountId) return `account:${t.accountId}`;
  return "";
}

function splitPay(v) {
  const s = String(v || "");
  if (s.startsWith("card:")) return { accountId: "", cardId: s.slice(5) };
  if (s.startsWith("account:")) return { accountId: s.slice(8), cardId: "" };
  return { accountId: "", cardId: "" };
}

// Lato di un giroconto nel modulo: "account:<id>" oppure "card:<id>".
function sideValue(cardId, accountId) {
  return cardId ? `card:${cardId}` : accountId ? `account:${accountId}` : "";
}

function field(label, control, { wide = false, hint = "", id } = {}) {
  return html`<label class="field${wide ? " wide" : ""}"${id ? html` for="${id}"` : ""}><span class="field-label">${label}</span>${control}${hint ? html`<span class="field-hint">${hint}</span>` : ""}</label>`;
}

function select(name, options, value, extra = "") {
  return html`<select class="input" id="op-${name}" name="${name}"${raw(extra)}>${options.map((o) => html`<option value="${o}"${raw(o === value ? " selected" : "")}>${o}</option>`)}</select>`;
}

function endFields(v) {
  return html`
    ${field("Fine", select("endMode", ["Nessuna fine", "Numero di rate", "Data di fine"], v.endMode || "Nessuna fine"), { id: "op-endMode" })}
    ${v.endMode === "Numero di rate" ? field("Numero di rate", html`<input class="input num" id="op-endCount" name="endCount" inputmode="numeric" value="${v.endCount || ""}" autocomplete="off">`, { id: "op-endCount" }) : ""}
    ${v.endMode === "Data di fine" ? field("Data di fine", html`<input class="input" type="date" id="op-endDate" name="endDate" value="${v.endDate || ""}">`, { id: "op-endDate" }) : ""}`;
}

const SUGGESTED = { rule: "Suggerita da una regola automatica", history: "Suggerita dai movimenti con la stessa descrizione", similar: "Suggerita da un movimento con una descrizione simile", name: "Suggerita dal nome della categoria" };

function categoryField(state, kind, v) {
  return html`${field("Categoria", html`<select class="input" id="op-category" name="category">${categoryOptions(state.categories, kind, v.category)}</select><span class="field-hint" id="op-category-hint">${SUGGESTED[v.suggested] || ""}</span>`, { id: "op-category" })}
    ${v.category === "__new__" ? field("Nome nuova categoria", html`<input class="input" id="op-newCategory" name="newCategory" value="${v.newCategory || ""}" autocomplete="off">`, { id: "op-newCategory" }) : ""}`;
}

// Casella "ricorda la categoria": crea una regola automatica al salvataggio.
function ruleField(v) {
  return html`<div class="field wide rule-field">
    <label class="check"><input type="checkbox" name="makeRule" value="1"${raw(v.makeRule ? " checked" : "")}><span>Usa sempre questa categoria per le descrizioni che contengono…</span></label>
    ${v.makeRule ? html`<input class="input" id="op-rulePattern" name="rulePattern" value="${v.rulePattern || ""}" aria-label="Testo che attiva la regola" autocomplete="off">` : ""}
  </div>`;
}

// Campo da evidenziare quando la fine di una programmazione non va bene.
// Ultimo conto usato per le uscite e per le entrate, solo su questo dispositivo: lo si propone la volta dopo.
const payKey = (income) => `patrimonio:lastPay:${income ? "in" : "out"}`;
function lastPay(state, income) {
  let v = "";
  try { v = localStorage.getItem(payKey(income)) || ""; } catch {}
  const [type, id] = v.split(":");
  const list = type === "account" ? state.accounts : type === "card" ? state.creditCards : [];
  return (list || []).some((x) => x.id === id) ? v : "";
}
function rememberPay(income, value) {
  try { if (value) localStorage.setItem(payKey(income), value); } catch {}
}

const endField = (v) => (v.endMode === "Numero di rate" ? "endCount" : v.endMode === "Data di fine" ? "endDate" : "endMode");

// Note, persona e viaggio (facoltativi): con chi è la spesa e quanto ti deve restituire, o chi ti restituisce i soldi.
function peopleFields(mode, v, ctx, note = "") {
  // Aperta se ha dei valori, finché l'utente non la apre o la chiude: da lì vale la sua scelta.
  const open = v.moreOpen === undefined ? !!(v.person || v.tag || v.note || (mode === "Uscita" && v.owed)) : !!v.moreOpen;
  return html`<details class="field wide op-more"${raw(open ? " open" : "")}>
    <summary>Note, persona e viaggio <span class="muted">(facoltativo)</span></summary>
    <div class="form-grid">
      ${note}
      ${field(mode === "Uscita" ? "Con chi o per chi" : "Da chi (restituzione)", html`<input class="input" id="op-person" name="person" value="${v.person || ""}" list="op-people" autocomplete="off" placeholder="es. Cinzia">`, { id: "op-person", hint: mode === "Entrata" ? "Un'entrata da una persona chiude quanto ti doveva: non conta tra le entrate." : "" })}
      ${mode === "Uscita" ? field("Ti deve restituire (€)", html`<input class="input num" id="op-owed" name="owed" inputmode="decimal" value="${v.owed || ""}" autocomplete="off" placeholder="0,00">`, { id: "op-owed", hint: "Questa parte non è una tua spesa: la ritrovi in Persone finché non te la restituisce." }) : ""}
      ${field("Viaggio o evento", html`<input class="input" id="op-tag" name="tag" value="${v.tag || ""}" list="op-tags" autocomplete="off" placeholder="es. Londra ottobre 2026">`, { id: "op-tag", wide: mode !== "Uscita" })}
    </div>
    <datalist id="op-people">${ctx.people.map((n) => html`<option value="${n}"></option>`)}</datalist>
    <datalist id="op-tags">${ctx.tags.map((n) => html`<option value="${n}"></option>`)}</datalist>
  </details>`;
}

function fieldsFor(mode, v, state, ctx) {
  const note = field("Note", html`<textarea class="input" id="op-note" name="note" rows="2">${v.note || ""}</textarea>`, { wide: true, id: "op-note" });
  const desc = (ph) => field("Descrizione", html`<input class="input" id="op-description" name="description" value="${v.description || ""}" placeholder="${ph}" autocomplete="off" required>`, { wide: true, id: "op-description" });
  const date = (label) => field(label, html`<input class="input" type="date" id="op-date" name="date" value="${v.date || ""}"${raw(ctx.lockDate ? " disabled" : "")} required>`, { id: "op-date" });
  if (mode === "Uscita" || mode === "Entrata") {
    return html`
      ${desc(mode === "Uscita" ? "es. Spesa al supermercato" : "es. Stipendio")}
      ${categoryField(state, mode, v)}
      ${field(mode === "Uscita" ? "Pagato con" : "Accreditato su", html`<select class="input" id="op-payWith" name="payWith"><option value="">— nessun conto —</option>${accountOptions(state, v.payWith, { prefix: "account:", cards: true })}</select>`, { id: "op-payWith" })}
      ${date("Data")}
      ${peopleFields(mode, v, ctx, note)}
      ${ruleField(v)}`;
  }
  if (mode === "Giroconto") {
    const repeat = v.repeat || "Nessuna";
    // Un lato può essere una carta (ricarica fatta con la carta, pagamento della carta), tranne che nei giroconti ripetuti.
    const cards = !ctx.lockFrequency;
    const empty = (side) => html`<option value="">${ctx.keepEmpty && ctx.keepEmpty[side] ? "— non indicato —" : "— scegli —"}</option>`;
    return html`
      ${field(cards ? "Da conto o carta" : "Da conto", html`<select class="input" id="op-from" name="from" required>${empty("from")}${accountOptions(state, v.from, { prefix: "account:", cards })}</select>`, { id: "op-from" })}
      ${field(cards ? "A conto o carta" : "A conto", html`<select class="input" id="op-to" name="to" required>${empty("to")}${accountOptions(state, v.to, { prefix: "account:", cards })}</select>`, { id: "op-to" })}
      ${date(repeat === "Nessuna" ? "Data del movimento" : "Primo giroconto")}
      ${ctx.allowRepeat ? field("Ripeti", select("repeat", REPEAT, repeat, ctx.lockFrequency ? " disabled" : ""), { id: "op-repeat" }) : ""}
      ${ctx.fromTx && repeat !== "Nessuna" ? firstNote : ""}
      ${desc("es. Accantonamento")}
      ${ctx.allowRepeat && repeat !== "Nessuna" ? endFields(v) : ""}
      ${note}`;
  }
  const income = v.recKind === "Entrata";
  return html`
    <div class="field wide"><span class="field-label" id="op-reckind-label">Tipo</span>
      <div class="seg" role="group" aria-labelledby="op-reckind-label">
        <button type="button" data-reckind="Uscita" aria-pressed="${!income}">Spesa ricorrente</button>
        <button type="button" data-reckind="Entrata" aria-pressed="${income}">Entrata ricorrente</button>
      </div>
    </div>
    ${desc(income ? "es. Stipendio" : "es. Abbonamento palestra")}
    ${categoryField(state, income ? "Entrata" : "Uscita", v)}
    ${field(income ? "Accredita su" : "Addebita su", html`<select class="input" id="op-payWith" name="payWith" required><option value="">— scegli —</option>${accountOptions(state, v.payWith, { prefix: "account:", cards: true })}</select>`, { id: "op-payWith" })}
    ${date(income ? "Primo accredito" : "Primo addebito")}
    ${field("Frequenza", select("frequency", FREQUENCIES, v.frequency || "Mensile", ctx.lockFrequency ? " disabled" : ""), { id: "op-frequency" })}
    ${ctx.fromTx ? firstNote : ""}
    ${endFields(v)}
    ${note}`;
}

const firstNote = html`<p class="form-note">Questo movimento diventa il primo della serie: i successivi li registra l'app alla scadenza.</p>`;

// ctx: { state, today, newId, commitWithUndo(ops, message), commit(ops) }
export function openOperationForm(app, { tx = null, schedule = null, mode = null, preset = {} } = {}) {
  const { state, today } = app;
  let allowed = MODES;
  let v;
  const ctx = { allowRepeat: true, lockFrequency: false, lockDate: false, people: knownNames(state.transactions, "person"), tags: knownNames(state.transactions, "tag") };
  if (tx) {
    const m = tx.kind === "Giroconto" ? "Giroconto" : tx.kind === "Entrata" ? "Entrata" : "Uscita";
    // Un movimento si trasforma come se fosse nuovo (anche in ricorrente o giroconto ripetuto, di cui diventa il
    // primo), tranne quelli generati da un'operazione programmata, da un PAC o da un finanziamento, che si ripetono già.
    const generated = !!(tx.scheduleId || tx.pacId || tx.loanId);
    allowed = generated ? ["Uscita", "Entrata", "Giroconto"] : MODES;
    Object.assign(ctx, { allowRepeat: !generated, fromTx: !generated });
    v = {
      mode: m, amount: numToInput(tx.amount), description: tx.description || "", category: tx.category || "Altro", payWith: payValue(tx), date: tx.date || today,
      from: sideValue(tx.fromCardId, tx.fromAccountId), to: sideValue(tx.toCardId, tx.toAccountId), note: tx.note || "", categoryTouched: true,
      person: tx.person || "", owed: tx.owed ? numToInput(tx.owed) : "", tag: tx.tag || "",
      repeat: "Nessuna", frequency: "Mensile", recKind: m === "Entrata" ? "Entrata" : "Uscita", endMode: "Nessuna fine",
    };
    // Un giroconto importato può avere un lato "non indicato": modificandolo si può lasciare così.
    if (m === "Giroconto") ctx.keepEmpty = { from: !v.from, to: !v.to };
  } else if (schedule) {
    const isTransfer = schedule.type === "transfer";
    allowed = [isTransfer ? "Giroconto" : "Ricorrente"];
    Object.assign(ctx, { lockFrequency: true, lockDate: true });
    v = {
      mode: allowed[0], amount: numToInput(schedule.amount), description: schedule.description || "", category: schedule.category || "Altro",
      payWith: schedule.payWith || "", date: schedule.startDate, from: sideValue("", schedule.fromAccountId), to: sideValue("", schedule.toAccountId),
      repeat: isTransfer ? schedule.frequency : "Nessuna", frequency: schedule.frequency, recKind: schedule.type === "income" ? "Entrata" : "Uscita",
      endMode: schedule.endMode || "Nessuna fine", endCount: schedule.endCount || "", endDate: schedule.endDate || "", note: schedule.note || "",
      categoryTouched: true,
    };
  } else {
    v = { mode: mode || "Uscita", amount: "", description: "", category: "Altro", payWith: lastPay(state, mode === "Entrata"), date: today, from: "", to: "", repeat: "Nessuna", frequency: "Mensile", recKind: "Uscita", endMode: "Nessuna fine", note: "", ...preset };
    if (v.mode === "Entrata" && v.category === "Altro") v.category = "Altre entrate";
  }

  const title = tx ? "Modifica movimento" : schedule ? "Modifica operazione programmata" : "Nuova operazione";
  const info = schedule
    ? html`<p class="form-note">${schedule.status === "Concluso" ? "Conclusa" : `Prossima: ${fmtDate(nextOccurrence(schedule))}`} · ${scheduleEndText(schedule)}. Data di inizio e frequenza non si possono cambiare: per farlo crea una nuova operazione.</p>`
    : tx && (tx.scheduleId || tx.pacId || tx.loanId)
      ? html`<p class="form-note">${tx.loanId ? `Rata del finanziamento ${nameOf(state.loans, tx.loanId, "non più presente")}, registrata in automatico` : `Movimento generato da ${tx.pacId ? "un piano di accumulo" : "un'operazione programmata"}`}: le modifiche valgono solo per questo movimento.</p>`
      : tx && tx.cardPaymentFor
        ? html`<p class="form-note">Addebito della carta ${nameOf(state.creditCards, tx.cardPaymentFor, "non più presente")}${tx.cycleFrom && tx.cycleTo ? ` per le spese ${onDate("da", addDays(tx.cycleFrom, 1))} ${onDate("a", tx.cycleTo)}` : ""}: nel flusso di cassa e nel budget conta solo la parte non già registrata come spese sulla carta.</p>`
        : "";

  const dlg = openSheet({
    title,
    closeOnBackdrop: false,
    body: html`<form class="form op-form" novalidate>
      ${allowed.length > 1 ? html`<div class="seg seg-block" role="group" aria-label="Tipo di operazione">${allowed.map((m) => html`<button type="button" data-mode="${m}" aria-pressed="${m === v.mode}">${m}</button>`)}</div>` : ""}
      ${info}
      <label class="amount-input" for="op-amount"><span class="sr-only">Importo in euro</span><input id="op-amount" name="amount" inputmode="decimal" placeholder="0,00" value="${v.amount}" autocomplete="off" required><span class="amount-cur" aria-hidden="true">€</span></label>
      <div class="form-grid" data-fields></div>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" hidden></button>
    </form>`,
    footer: html`${tx || schedule ? html`<button type="button" class="btn ghost danger-text" data-delete>Elimina</button>` : ""}<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-submit>Salva</button>`,
  });
  const form = dlg.querySelector("form");
  const box = form.querySelector(".form-error");
  const holder = form.querySelector("[data-fields]");

  const collect = () => {
    for (const el of form.elements) if (el.name && !el.disabled) v[el.name] = el.type === "checkbox" ? el.checked : el.value;
  };
  const kindOf = (mode) => (mode === "Ricorrente" ? v.recKind || "Uscita" : mode);
  const kindNow = () => kindOf(v.mode);

  // Cambio di tipo: la categoria resta se vale anche per il nuovo tipo, il conto passa da "pagato con" ai lati
  // del giroconto e viceversa (un'uscita parte dal suo conto, un'entrata arriva sul suo).
  const switchMode = (next) => {
    const before = kindNow();
    if (next === "Ricorrente" && (v.mode === "Uscita" || v.mode === "Entrata")) v.recKind = v.mode;
    v.mode = next;
    const after = kindNow();
    if (after === before) return;
    if (after === "Giroconto") {
      if (!v.from && !v.to && v.payWith) v[before === "Entrata" ? "to" : "from"] = v.payWith;
      return;
    }
    if (before === "Giroconto" && !v.payWith) v.payWith = (after === "Entrata" ? v.to : v.from) || "";
    if (!state.categories.some((c) => c.name === v.category && (after === "Entrata") === (c.kind === "Entrata"))) {
      Object.assign(v, { category: after === "Entrata" ? "Altre entrate" : "Altro", categoryTouched: false, suggested: "" });
    }
  };

  // Dopo aver scritto la descrizione, propone la categoria (regole, poi movimenti precedenti)
  // senza ridisegnare il modulo, così il focus resta dove l'utente l'ha portato.
  const suggest = () => {
    if (v.categoryTouched || !["Uscita", "Entrata", "Ricorrente"].includes(v.mode)) return;
    const sel = form.elements.namedItem("category");
    const hint = form.querySelector("#op-category-hint");
    const s = suggestCategory(form.elements.namedItem("description")?.value, kindNow(), state.rules, state.transactions, state.categories);
    if (!sel || !s || ![...sel.options].some((o) => o.value === s.category)) return;
    sel.value = s.category;
    v.category = s.category;
    v.suggested = s.source;
    if (hint) hint.textContent = SUGGESTED[s.source];
  };
  const render = () => {
    holder.innerHTML = String(fieldsFor(v.mode, v, state, ctx));
  };
  render();

  form.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]");
    if (m) {
      collect();
      switchMode(m.dataset.mode);
      form.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b === m)));
      box.hidden = true;
      render();
      suggest();
      return;
    }
    const rk = e.target.closest("[data-reckind]");
    if (rk) {
      collect();
      v.recKind = rk.dataset.reckind;
      v.category = v.recKind === "Entrata" ? "Altre entrate" : "Altro";
      render();
    }
  });
  // La sezione "Persona e viaggio" resta come l'ha lasciata l'utente anche quando il modulo si ridisegna.
  form.addEventListener("toggle", (e) => { if (e.target.matches && e.target.matches("details.op-more")) v.moreOpen = e.target.open; }, true);
  form.addEventListener("change", (e) => {
    if (e.target.name === "description") suggest();
    if (e.target.name === "category") { v.categoryTouched = true; v.suggested = ""; }
    if (e.target.name === "makeRule") {
      collect();
      if (v.makeRule && !v.rulePattern) v.rulePattern = String(v.description || "").trim();
      render();
      const p = form.elements.namedItem("rulePattern");
      if (p) p.focus();
      return;
    }
    if (["category", "repeat", "endMode"].includes(e.target.name)) {
      collect();
      render();
      const again = form.elements.namedItem(e.target.name === "category" && v.category === "__new__" ? "newCategory" : e.target.name);
      if (again) again.focus();
    }
    box.hidden = true;
  });

  const fail = (message, name) => {
    box.textContent = message;
    box.hidden = false;
    const el = name && form.elements.namedItem(name);
    // Il campo può stare nella sezione "Persona e viaggio" chiusa: la si apre per mostrarlo.
    const section = el && el.closest && el.closest("details");
    if (section && !section.open) section.open = true;
    if (el && el.focus) el.focus();
    return false;
  };

  const submit = async () => {
    collect();
    const amount = parseAmount(v.amount);
    if (!(amount > 0)) return fail("Inserisci un importo maggiore di zero.", "amount");
    const ops = [];
    let category = v.category;
    if (category === "__new__") {
      const name = String(v.newCategory || "").trim();
      if (!name) return fail("Scrivi il nome della nuova categoria.", "newCategory");
      category = name;
      if (!state.categories.some((c) => c.name === name)) ops.push(newCategoryOp(name, v.mode === "Entrata" || (v.mode === "Ricorrente" && v.recKind === "Entrata") ? "Entrata" : "Uscita"));
    }
    const description = String(v.description || "").trim();
    const note = String(v.note || "").trim();
    const mode = v.mode;
    if (!v.date) return fail("Indica la data.", "date");

    if (mode === "Uscita" || mode === "Entrata") {
      if (!description) return fail("Scrivi una descrizione.", "description");
      const data = { date: v.date, description, category: category || (mode === "Entrata" ? "Altre entrate" : "Altro"), kind: mode, amount, ...splitPay(v.payWith), note };
      // Persona, quanto deve restituire e viaggio: si scrivono solo se indicati (o per svuotare quelli di prima).
      const person = cleanName(v.person), tag = cleanName(v.tag);
      let owed = 0;
      if (mode === "Uscita" && String(v.owed || "").trim()) {
        owed = parseAmount(v.owed);
        if (!Number.isFinite(owed) || owed < 0) return fail("Indica quanto ti deve restituire, in euro.", "owed");
        if (owed > amount + 0.004) return fail("Non può restituirti più della spesa.", "owed");
        if (owed > 0 && !person) return fail("Scrivi chi ti deve restituire i soldi.", "person");
      }
      if (person || (tx && tx.person)) data.person = person;
      if (owed > 0 || (tx && tx.owed)) data.owed = round(owed, 2);
      if (tag || (tx && tx.tag)) data.tag = tag;
      if (tx) ops.push({ op: "update", coll: "transactions", id: tx.id, data: { ...data, ...staleTxFields(tx, mode) } });
      else ops.push({ op: "set", coll: "transactions", id: app.newId(), data: { ...data, createdAt: Date.now() } });
      let rule = null;
      if (v.makeRule) {
        const pattern = String(v.rulePattern || "").trim();
        if (pattern.length < 2) return fail("Scrivi il testo che attiva la regola (almeno due caratteri).", "rulePattern");
        rule = { pattern, category: data.category, kind: mode };
        const same = (state.rules || []).find((r) => normText(r.pattern) === normText(pattern) && (r.kind || "Tutti") === mode);
        if (same) ops.push({ op: "update", coll: "rules", id: same.id, data: { category: data.category } });
        else ops.push({ op: "set", coll: "rules", id: app.newId(), data: { ...rule, createdAt: Date.now() } });
      }
      rememberPay(mode === "Entrata", v.payWith);
      app.commitWithUndo(ops, tx ? "Movimento aggiornato" : mode === "Uscita" ? "Uscita registrata" : "Entrata registrata");
      if (rule) setTimeout(() => offerRuleApply(app, rule), 400);
      return true;
    }

    if (mode === "Giroconto") {
      const from = splitPay(v.from), to = splitPay(v.to);
      const keep = ctx.keepEmpty || {};
      if (!v.from && !keep.from) return fail("Scegli da dove partono i soldi.", "from");
      if (!v.to && !keep.to) return fail("Scegli dove arrivano i soldi.", "to");
      if (v.from && v.from === v.to) return fail("Scegli due conti diversi.", "to");
      if (from.cardId && to.cardId) return fail("Un giroconto non può andare da una carta a un'altra.", "to");
      const repeated = schedule || (v.repeat || "Nessuna") !== "Nessuna";
      if (repeated && (from.cardId || to.cardId)) return fail("I giroconti ripetuti vanno da un conto a un conto.", from.cardId ? "from" : "to");
      if (repeated && (!v.from || !v.to)) return fail("Per ripeterlo scegli tutti e due i conti.", v.from ? "to" : "from");
      const base = { description: description || "Giroconto", amount, fromAccountId: from.accountId, toAccountId: to.accountId, note };
      const txData = { ...base, fromCardId: from.cardId, toCardId: to.cardId, date: v.date, category: "Giroconto", kind: "Giroconto" };
      if (tx && !repeated) {
        ops.push({ op: "update", coll: "transactions", id: tx.id, data: { ...txData, ...staleTxFields(tx, "Giroconto") } });
        app.commitWithUndo(ops, tx.kind === "Giroconto" ? "Giroconto aggiornato" : "Movimento trasformato in giroconto");
        return true;
      }
      if (schedule) {
        const end = readEnd(v, schedule.startDate);
        if (end.error) return fail(end.error, endField(v));
        ops.push({ op: "update", coll: "schedules", id: schedule.id, data: { ...base, ...end } });
        app.commitWithUndo(ops, "Giroconto programmato aggiornato");
        return true;
      }
      if (!repeated) {
        ops.push({ op: "set", coll: "transactions", id: app.newId(), data: { ...txData, createdAt: Date.now() } });
        app.commitWithUndo(ops, "Giroconto registrato");
        return true;
      }
      const end = readEnd(v, v.date);
      if (end.error) return fail(end.error, endField(v));
      const sched = { type: "transfer", ...base, frequency: v.repeat, startDate: v.date, ...end, done: 0, status: "Attivo", createdAt: Date.now() };
      return createSchedule(app, sched, ops, "Giroconto programmato", tx ? { ...txData, ...staleTxFields(tx, "Giroconto") } : null);
    }

    // Ricorrente
    if (!description) return fail("Scrivi una descrizione.", "description");
    if (!v.payWith) return fail(v.recKind === "Entrata" ? "Scegli dove accreditare." : "Scegli dove addebitare.", "payWith");
    const income = v.recKind === "Entrata";
    if (schedule) {
      const end = readEnd(v, schedule.startDate);
      if (end.error) return fail(end.error, endField(v));
      ops.push({ op: "update", coll: "schedules", id: schedule.id, data: { description, category: category || "Altro", amount, payWith: v.payWith, note, ...end } });
      app.commitWithUndo(ops, "Operazione programmata aggiornata");
      return true;
    }
    const end = readEnd(v, v.date);
    if (end.error) return fail(end.error, endField(v));
    const sched = { type: income ? "income" : "expense", description, category: category || (income ? "Altre entrate" : "Altro"), amount, payWith: v.payWith, frequency: v.frequency || "Mensile", startDate: v.date, ...end, done: 0, status: "Attivo", note, createdAt: Date.now() };
    const kind = income ? "Entrata" : "Uscita";
    rememberPay(income, v.payWith);
    const first = tx ? { date: v.date, description, category: sched.category, kind, amount, ...splitPay(v.payWith), note, ...staleTxFields(tx, kind) } : null;
    return createSchedule(app, sched, ops, income ? "Entrata ricorrente creata" : "Spesa ricorrente creata", first);
  };

  // first: i dati del movimento in modifica, che diventa la prima occorrenza (le successive le registra l'app).
  async function createSchedule(appCtx, sched, ops, message, first = null) {
    const due = countDue(sched, appCtx.today);
    const extra = first ? due - 1 : due;
    if (first ? extra > 0 : due > 1) {
      const ok = await confirmDialog({
        title: "Registrare gli arretrati?",
        text: first
          ? `Questo movimento diventa il primo; fino a oggi ${extra === 1 ? "ne verrà registrato subito un altro" : `ne verranno registrati subito altri ${extra}`}.`
          : `La prima data è nel passato: verranno registrati subito ${due} movimenti fino a oggi.`,
        confirmLabel: "Registra",
      });
      if (!ok) return false;
    }
    const id = appCtx.newId();
    if (first) ops.push({ op: "update", coll: "transactions", id: tx.id, data: { ...first, scheduleId: id } });
    ops.push({ op: "set", coll: "schedules", id, data: first ? { ...sched, done: 1 } : sched });
    // "Annulla" toglie anche i movimenti che la programmazione ha già registrato (arretrati e quello di oggi);
    // il movimento trasformato torna com'era.
    appCtx.commitWithUndo(ops, message, { undoExtra: () => scheduleTxDeleteOps(id, appCtx.state.transactions).filter((o) => !first || o.id !== tx.id) });
    return true;
  }

  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      if (await submit()) dlg.close();
    } catch (e) {
      console.error(e);
      fail("Salvataggio non riuscito: " + ((e && e.message) || "errore"));
    } finally {
      busy = false;
    }
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
  dlg.querySelector("[data-submit]").addEventListener("click", run);
  const del = dlg.querySelector("[data-delete]");
  if (del) {
    del.addEventListener("click", async () => {
      if (tx) {
        dlg.close();
        app.commitWithUndo([{ op: "delete", coll: "transactions", id: tx.id }], "Movimento eliminato");
        return;
      }
      const ok = await confirmDialog({
        title: "Eliminare l'operazione programmata?",
        text: "I movimenti già registrati restano; non ne verranno creati altri.",
        confirmLabel: "Elimina",
        danger: true,
      });
      if (!ok) return;
      dlg.close();
      app.commitWithUndo([{ op: "delete", coll: "schedules", id: schedule.id }], "Operazione programmata eliminata");
    });
  }
  const amountEl = form.elements.namedItem("amount");
  // Aperto per programmare delle rate con il numero ancora da scrivere: si parte da lì (l'importo c'è già).
  const countEl = !tx && !schedule && v.endMode === "Numero di rate" && !v.endCount && amountEl.value ? form.elements.namedItem("endCount") : null;
  if (countEl) countEl.focus();
  else {
    amountEl.focus();
    amountEl.select();
  }
  return dlg;
}
