import { html, raw } from "../lib/html.js";
import { fmtDate, fmtEUR, fmtSigned, onDate } from "../lib/format.js";
import { CREATE, anchorOps, anchorPlan, bundleStatus, correctionRows, createOps, defaultMapping, historyOps, missingCategoryOps, newRules, remapTransaction, txSides } from "../domain/bundle.js";
import { txRoute } from "../domain/finance.js";
import { openSheet } from "./feedback.js";
import { accountOptions } from "./components.js";

const MAX_SIMILAR = 200;
const FIELD_NAMES = { amount: "importo", date: "data", description: "descrizione", category: "categoria", kind: "tipo" };

// Importazione di un pacchetto di movimenti (formato "patrimonio-movimenti"): per ogni conto o carta
// del pacchetto si sceglie dove finisce nell'app e cosa fare del saldo; i movimenti già presenti si
// riconoscono da soli, quelli solo simili si possono aggiungere uno per uno.
export function openBundleImport(app, bundle) {
  const { state } = app;
  const st = { mapping: defaultMapping(bundle.sources, state), modes: new Map(), similar: new Set(), skipFix: new Set(), rules: true, history: true, similarOpen: false };

  const dlg = openSheet({
    title: "Importa movimenti",
    wide: true,
    closeOnBackdrop: false,
    body: html`<div class="bundle-import" data-root></div>`,
    footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-import>Importa</button>`,
  });
  const root = dlg.querySelector("[data-root]");
  const importBtn = dlg.querySelector("[data-import]");
  const targetOf = (s) => {
    const id = st.mapping.get(s.key);
    return id && id !== CREATE ? (s.type === "card" ? state.creditCards : state.accounts).find((x) => x.id === id) || null : null;
  };
  // Saldo o speso che l'app mostra adesso (registrato + movimenti successivi).
  const currentOf = (s, target) => {
    const t = app.derived().totals;
    return s.type === "card" ? t.cards.get(target.id)?.spent : t.balances.get(target.id);
  };

  function compute() {
    const items = [];
    let unmapped = 0;
    for (const t of bundle.transactions) {
      const data = remapTransaction(t.data, st.mapping, state);
      if (data) items.push({ id: t.id, data, origin: txSides(t.data).map((x) => x.key) });
      else unmapped++;
    }
    const statuses = bundleStatus(items, state.transactions);
    const rows = items.map((it, i) => ({ ...it, ...statuses[i] }));
    const chosen = rows.filter((r) => r.status === "new" || (r.status === "similar" && st.similar.has(r.id)));
    const fixes = correctionRows(bundle, state.transactions);
    return { rows, chosen, unmapped, fixes };
  }

  function sourceBlock(s, rows, chosen) {
    const mine = rows.filter((r) => r.origin.includes(s.key));
    const count = (status) => mine.filter((r) => r.status === status).length;
    const creating = st.mapping.get(s.key) === CREATE;
    const target = targetOf(s);
    const total = bundle.transactions.filter((t) => txSides(t.data).some((x) => x.key === s.key)).length;
    const plan = target ? anchorPlan(s, target, chosen.map((r) => r.data), app.today) : null;
    if (plan && !st.modes.has(s.key)) st.modes.set(s.key, plan.mode);
    const mode = st.modes.get(s.key);
    const radio = (value, label, sub) => html`<label class="choice"><input type="radio" name="mode-${s.key}" data-mode="${s.key}" value="${value}"${raw(mode === value ? " checked" : "")}><span><strong>${label}</strong>${sub ? html`<span class="muted">${sub}</span>` : ""}</span></label>`;
    const isCard = s.type === "card";
    const what = isCard ? "lo speso" : "il saldo";
    const fromFile = isCard ? s.spent : s.balance;
    const toImport = count("new") + mine.filter((r) => r.status === "similar" && st.similar.has(r.id)).length;
    return html`<fieldset class="block bundle-source">
      <div class="bundle-head">
        <div><p class="setting-title">${s.name}</p><p class="setting-sub">${total === 1 ? "1 movimento" : `${total} movimenti`}${s.from && s.to ? ` ${onDate("da", s.from)} ${onDate("a", s.to)}` : ""}${s.file ? ` · ${s.file}` : ""}</p></div>
        <label class="field bundle-target"><span class="field-label">Nell'app</span><select class="input" data-map="${s.key}"><option value="">— non importare —</option>${s.create ? html`<option value="${CREATE}"${raw(creating ? " selected" : "")}>＋ Nuovo conto “${s.name}”</option>` : ""}${isCard
          ? state.creditCards.map((c) => html`<option value="${c.id}"${raw(target && target.id === c.id ? " selected" : "")}>${c.name || "Carta"}</option>`)
          : accountOptions(state, target ? target.id : "")}</select></label>
      </div>
      ${target || creating ? html`<p class="import-counts"><span><strong>${toImport}</strong> da importare</span>${count("present") ? html`<span class="muted">${count("present")} già present${count("present") === 1 ? "e" : "i"}</span>` : ""}${count("similar") ? html`<span class="muted">${count("similar") === 1 ? "1 possibile doppione" : `${count("similar")} possibili doppioni`}</span>` : ""}${count("imported") ? html`<span class="muted">${count("imported")} già importat${count("imported") === 1 ? "o" : "i"}</span>` : ""}</p>` : ""}
      ${creating ? html`<p class="form-note">Verrà creato il conto “${s.name}”${s.create.bank ? ` (${s.create.bank})` : ""}${s.balance ? ` con il saldo dell'estratto: ${fmtEUR(s.balance.value)} ${onDate("a", s.balance.date)}` : ""}.</p>`
        : plan ? html`<div class="choices">
          ${plan.options.includes("file") ? radio("file", `Usa ${isCard ? "lo speso" : "il saldo"} dell'estratto: ${fmtEUR(fromFile.value)} ${onDate("a", fromFile.date)}`, `Consigliato: è il dato della ${isCard ? "carta" : "banca"}, comprende già tutti i movimenti.`) : ""}
          ${plan.options.includes("today") ? radio("today", `${isCard ? "Lo speso" : "Il saldo"} che vedi ora (${fmtEUR(currentOf(s, target))}) è giusto a oggi`, "I movimenti importati diventano storico e non lo cambiano.") : ""}
          ${radio("keep", `Lascia ${what} com'è${plan.asOf ? ` (aggiornato ${onDate("a", plan.asOf)})` : ""}`, plan.count ? `${plan.count === 1 ? "Un movimento importato lo cambia" : `${plan.count} movimenti importati lo cambiano`} di ${fmtSigned(plan.delta)}.` : "Nessun movimento importato lo cambia.")}
        </div>`
        : html`<p class="form-note">Questi movimenti non verranno importati${s.id && !(isCard ? state.creditCards : state.accounts).some((x) => x.id === s.id) ? ": il conto del pacchetto non esiste nell'app, sceglilo qui sopra" : ""}.</p>`}
    </fieldset>`;
  }

  function render() {
    const body = dlg.querySelector(".sheet-body");
    const scroll = body ? body.scrollTop : 0;
    const { rows, chosen, unmapped, fixes } = compute();
    const similar = rows.filter((r) => r.status === "similar");
    const cats = missingCategoryOps(bundle, chosen.map((r) => r.data), state.categories);
    const rules = newRules(bundle, state.rules);
    const hist = historyOps(bundle, state.history, true);
    const histNew = hist.filter((o) => o.op === "set");
    const inc = chosen.filter((r) => r.data.kind === "Entrata").reduce((s, r) => s + r.data.amount, 0);
    const out = chosen.filter((r) => r.data.kind === "Uscita").reduce((s, r) => s + r.data.amount, 0);
    const transfers = chosen.filter((r) => r.data.kind === "Giroconto").length;
    const dates = chosen.map((r) => r.data.date).sort();
    const done = !chosen.length && !fixes.length && !hist.length && rows.length > 0 && rows.every((r) => r.status === "imported" || r.status === "present");
    root.innerHTML = String(html`
      ${bundle.note ? html`<p class="sheet-text">${bundle.note}</p>` : ""}
      <p class="import-counts" role="status"><span><strong>${chosen.length}</strong> ${chosen.length === 1 ? "movimento" : "movimenti"} da importare</span>${dates.length ? html`<span class="muted">${onDate("da", dates[0])} ${onDate("a", dates[dates.length - 1])}</span>` : ""}<span class="pos">+${fmtEUR(inc)}</span><span class="neg">−${fmtEUR(out)}</span>${transfers ? html`<span class="muted">${transfers === 1 ? "1 giroconto" : `${transfers} giroconti`}</span>` : ""}</p>
      ${done ? html`<p class="form-note">Non c'è niente di nuovo: questi movimenti sono già tutti nell'app.</p>` : ""}
      ${bundle.sources.map((s) => sourceBlock(s, rows, chosen))}
      ${fixes.length ? html`<fieldset class="block"><legend class="field-label">Correzioni ai movimenti che avevi già registrato</legend>
        <ul class="list compact bundle-similar">${fixes.map((f) => html`<li><label class="check"><input type="checkbox" data-fix="${f.id}"${raw(st.skipFix.has(f.id) ? "" : " checked")}><span><strong>${fmtDate(f.tx.date)} · ${f.tx.description} · ${fmtEUR(f.tx.amount)}</strong><span class="muted">${f.note || ""}${f.note ? " — " : ""}${Object.entries(f.data).filter(([k]) => FIELD_NAMES[k]).map(([k, v]) => `${FIELD_NAMES[k]}: ${k === "amount" ? fmtEUR(v) : v}`).join(", ")}</span></span></label></li>`)}</ul>
      </fieldset>` : ""}
      ${similar.length ? html`<details class="mapping"${raw(st.similarOpen ? " open" : "")} data-similar-box>
        <summary>Possibili doppioni (${similar.length}): stesso importo a pochi giorni da un movimento già registrato</summary>
        <p class="muted">Restano fuori, a meno che tu non li spunti.</p>
        <ul class="list compact bundle-similar">${similar.slice(0, MAX_SIMILAR).map((r) => html`<li><label class="check"><input type="checkbox" data-similar="${r.id}"${raw(st.similar.has(r.id) ? " checked" : "")}><span><strong>${fmtDate(r.data.date)} · ${r.data.description} · ${fmtEUR(r.data.amount)}</strong><span class="muted">${txRoute(r.data, state)} — simile a “${r.of.description || "movimento"}” ${onDate("di", r.of.date)}</span></span></label></li>`)}</ul>
      </details>` : ""}
      ${rules.length ? html`<label class="check"><input type="checkbox" data-opt="rules"${raw(st.rules ? " checked" : "")}><span><strong>Crea anche ${rules.length === 1 ? "1 regola automatica" : `${rules.length} regole automatiche`}</strong><span class="muted">${rules.slice(0, 8).map((r) => `“${r.pattern}” → ${r.category}`).join(" · ")}${rules.length > 8 ? " …" : ""}</span></span></label>` : ""}
      ${hist.length ? html`<label class="check"><input type="checkbox" data-opt="history"${raw(st.history ? " checked" : "")}><span><strong>Ricostruisci lo storico del disponibile: ${bundle.history.length} giorni ${onDate("da", bundle.history[0].date)}</strong><span class="muted">Per i grafici dell'andamento${hist.length > histNew.length ? `; corregge anche ${hist.length - histNew.length === 1 ? "1 giorno già registrato" : `${hist.length - histNew.length} giorni già registrati`}, calcolati con i saldi di allora` : ""}.</span></span></label>` : ""}
      ${cats.length ? html`<p class="form-note">Nuove categorie: ${cats.map((o) => `${o.data.emoji} ${o.data.name}`).join(", ")}.</p>` : ""}
      ${unmapped ? html`<p class="form-note">${unmapped === 1 ? "1 movimento resta fuori" : `${unmapped} movimenti restano fuori`}: riguardano conti esclusi o che non esistono nell'app.</p>` : ""}
      ${bundle.skipped ? html`<p class="form-note">${bundle.skipped} righe del file non erano valide e sono state ignorate.</p>` : ""}`);
    if (body) body.scrollTop = scroll;
    const fixCount = fixes.filter((f) => !st.skipFix.has(f.id)).length;
    importBtn.disabled = !chosen.length && !fixCount && !(st.history && hist.length);
    importBtn.textContent = chosen.length ? `Importa ${chosen.length} moviment${chosen.length === 1 ? "o" : "i"}` : "Importa";
  }

  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.map) {
      st.mapping.set(el.dataset.map, el.value || null);
      st.modes.delete(el.dataset.map);
      st.similar.clear();
    } else if (el.dataset.mode) st.modes.set(el.dataset.mode, el.value);
    else if (el.dataset.similar) { if (el.checked) st.similar.add(el.dataset.similar); else st.similar.delete(el.dataset.similar); }
    else if (el.dataset.fix) { if (el.checked) st.skipFix.delete(el.dataset.fix); else st.skipFix.add(el.dataset.fix); }
    else if (el.dataset.opt) st[el.dataset.opt] = el.checked;
    else return;
    const box = root.querySelector("[data-similar-box]");
    st.similarOpen = !!(box && box.open);
    const focus = el.dataset.similar ? `[data-similar="${el.dataset.similar}"]` : el.dataset.fix ? `[data-fix="${el.dataset.fix}"]` : el.dataset.map ? `[data-map="${el.dataset.map}"]` : null;
    render();
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
  });

  importBtn.addEventListener("click", () => {
    const { chosen, fixes } = compute();
    const now = Date.now();
    const ops = [];
    for (const s of bundle.sources) if (st.mapping.get(s.key) === CREATE && !state.accounts.some((a) => a.id === s.id)) ops.push(...createOps(s, app.today, now));
    ops.push(...missingCategoryOps(bundle, chosen.map((r) => r.data), state.categories));
    chosen.forEach((r, i) => ops.push({ op: "set", coll: "transactions", id: r.id, data: { ...r.data, createdAt: now + i } }));
    for (const f of fixes) if (!st.skipFix.has(f.id)) ops.push({ op: "update", coll: "transactions", id: f.id, data: f.data });
    for (const s of bundle.sources) {
      const target = targetOf(s);
      if (target) ops.push(...anchorOps(s, target, st.modes.get(s.key) || "keep", app.today, currentOf(s, target)));
    }
    if (st.rules) newRules(bundle, state.rules).forEach((r, i) => ops.push({ op: "set", coll: "rules", id: app.newId(), data: { ...r, createdAt: now + i } }));
    if (st.history) ops.push(...historyOps(bundle, state.history, true));
    if (!ops.length) return;
    dlg.close();
    app.commitWithUndo(ops, chosen.length ? `Importati ${chosen.length} movimenti` : "Modifiche importate");
  });

  render();
  return dlg;
}
