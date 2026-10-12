import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { addPeriod, perMonth } from "../lib/dates.js";
import { downloadText } from "../lib/dom.js";
import { fmtDate, fmtDayMonth, fmtEUR, fmtNum, fmtPct, fmtPrice, fmtQty, fmtRelative, fmtSigned, numToInput, onDate, parseAmount, toNum } from "../lib/format.js";
import { HOLDING_CLASSES, holdingValue, nameOf } from "../domain/finance.js";
import { futureValue, pacIsDue, pacStats, planPacRegistration, planPacSkip, resolveAsset } from "../domain/pac.js";
import { annualCsv, annualReport, annualYears } from "../domain/annual.js";
import { areaChart, donutChart } from "../ui/charts.js";
import { badge, emptyState, iconAvatar } from "../ui/components.js";
import { openSheet } from "../ui/feedback.js";
import { cardHead, deltaLine, pageHead, rangeSwitch, seriesFor } from "./shared.js";

const view = { range: "3M", cls: "all", routeKey: "" };
// Data del prossimo versamento: con "tra N giorni" se è vicina (più in là fmtRelative ripeterebbe la data).
const nextText = (date, today) => {
  const rel = fmtRelative(date, today);
  return /^(il |l')/.test(rel) ? fmtDate(date) : `${fmtDate(date)} (${rel})`;
};

function gainCell(h) {
  const avg = toNum(h.avgPrice);
  if (!(avg > 0)) return html`<span class="muted" title="Prezzo di carico non inserito">—</span>`;
  const cost = toNum(h.quantity) * avg;
  const gain = holdingValue(h) - cost;
  return html`<span class="${gain >= 0 ? "pos" : "neg"}">${fmtSigned(gain)}</span><span class="cell-sub ${gain >= 0 ? "pos" : "neg"}">${fmtPct(cost > 0 ? (gain / cost) * 100 : null, 1, true)}</span>`;
}

function holdingsTable(app, total) {
  const { state } = app;
  const classes = view.cls === "all" ? HOLDING_CLASSES : HOLDING_CLASSES.filter((c) => c.key === view.cls);
  const rows = classes.flatMap((c) => (state[c.key] || []).map((h) => ({ c, h, value: holdingValue(h) }))).sort((a, b) => b.value - a.value);
  if (!rows.length) return emptyState("Nessuna posizione", "Aggiungi un ETF, un'azione o una crypto.", "");
  return html`<div class="table-wrap"><table class="table holdings">
    <thead><tr><th scope="col">Strumento</th><th scope="col" class="num hide-sm">Quantità</th><th scope="col" class="num hide-md">Prezzo medio</th><th scope="col" class="num hide-sm">Prezzo</th><th scope="col" class="num">Valore</th><th scope="col" class="num">Guadagno</th><th scope="col" class="num hide-md">Peso</th></tr></thead>
    <tbody>${rows.map(({ c, h, value }) => {
      const code = c.key === "crypto" ? h.symbol || "" : h.isin || "";
      return html`<tr>
        <th scope="row"><button type="button" class="cell-link" data-action="edit" data-coll="${c.key}" data-id="${h.id}"><span class="cell-title">${h.name || "Senza nome"}</span><span class="cell-sub"><span class="class-dot" style="background:var(--series-${c.series})" aria-hidden="true"></span>${c.singular}${code ? html` · <span translate="no">${code}</span>` : ""}${h.broker || h.exchange ? ` · ${h.broker || h.exchange}` : ""}</span></button></th>
        <td class="num hide-sm">${fmtQty(h.quantity)}</td>
        <td class="num hide-md">${toNum(h.avgPrice) > 0 ? fmtPrice(h.avgPrice) : html`<span class="muted">—</span>`}</td>
        <td class="num hide-sm">${fmtPrice(h.currentPrice)}${h.priceDate ? html`<span class="cell-sub" title="${h.priceSource || ""}">${fmtDayMonth(h.priceDate)}</span>` : ""}</td>
        <td class="num"><strong>${fmtEUR(value)}</strong></td>
        <td class="num">${gainCell(h)}</td>
        <td class="num hide-md">${fmtPct(total > 0 ? (value / total) * 100 : 0, 1)}</td>
      </tr>`;
    })}</tbody></table></div>`;
}

function pacSection(app) {
  const { state, today } = app;
  const list = state.pac;
  return html`<section class="card span-12" id="pac" aria-labelledby="h-pac">
    ${cardHead("Piani di accumulo", html`<button type="button" class="btn sm" data-action="add" data-coll="pac">${icon("plus", 16)} Nuovo piano</button>`, "h-pac")}
    ${list.length ? html`<ul class="pac-grid">${list.map((p) => {
      const t = resolveAsset(p.asset, state);
      const due = pacIsDue(p, today);
      const paused = p.status === "In pausa";
      const st = pacStats(p, state, today);
      const monthly = perMonth(toNum(p.amount), p.frequency || "Mensile");
      const base = st.partial ? st.invested : st.value;
      const fv = [0, 4, 7].map((r) => futureValue({ value: base, monthly: paused ? 0 : monthly, years: 10, annualReturn: r }).value);
      return html`<li class="pac-card${due ? " due" : ""}">
        <div class="pac-top">${iconAvatar("trend", "aqua")}<button type="button" class="row-main linklike" data-action="edit" data-coll="pac" data-id="${p.id}"><span class="row-title">${p.name || "Piano"}</span><span class="row-sub">${t ? t.holding.name : "strumento mancante"}</span></button>${paused ? badge("in pausa", "warn") : due ? badge("da registrare", "accent") : ""}</div>
        <dl class="facts compact"><div><dt>Versamento</dt><dd><span class="inv">${fmtEUR(p.amount)}</span> · ${String(p.frequency || "").toLowerCase()}</dd></div><div><dt>Prossimo</dt><dd>${p.nextDate ? nextText(p.nextDate, today) : "—"}</dd></div><div><dt>Conto</dt><dd>${p.accountId ? nameOf(state.accounts, p.accountId) : "—"}</dd></div>
          <div><dt>Versato con l'app</dt><dd>${st.count ? `${fmtEUR(st.invested)} · ${st.count === 1 ? "1 versamento" : `${st.count} versamenti`}` : "—"}</dd></div>
          <div><dt>Valore di quelle quote</dt><dd>${!st.count ? "—" : st.partial ? html`<span class="muted" title="Alcuni versamenti non hanno il numero di quote">non calcolabile</span>` : html`${fmtEUR(st.value)} <span class="${st.gain >= 0 ? "pos" : "neg"}">${fmtSigned(st.gain)}</span>`}</dd></div>
          <div><dt>Rendimento annuo</dt><dd>${st.annual != null ? html`<span class="${st.annual >= 0 ? "pos" : "neg"}">${fmtPct(st.annual, 1, true)}</span>` : st.count && !st.partial && st.days < 90 ? html`<span class="muted">dopo 3 mesi</span>` : "—"}</dd></div>
          <div><dt>Fra 10 anni (0% · 4% · 7%)</dt><dd>${fv.map((v) => fmtEUR(v)).join(" · ")}</dd></div></dl>
        ${due ? html`<div class="pac-actions"><button type="button" class="btn sm primary" data-action="register-pac" data-id="${p.id}">Registra versamento</button><button type="button" class="btn sm ghost" data-action="skip-pac" data-id="${p.id}">Salta</button></div>` : ""}
      </li>`;
    })}</ul>` : emptyState("Nessun piano di accumulo", "Collega un versamento periodico a un ETF, un'azione o una crypto già presenti.", "")}
  </section>`;
}

export default {
  id: "investments",
  title: "Investimenti",
  render(app, route) {
    const { state } = app;
    const key = `${route.params.get("classe") || ""}|${route.params.get("sezione") || ""}`;
    if (route.changed || key !== view.routeKey) {
      view.routeKey = key;
      const cls = route.params.get("classe");
      if (cls && HOLDING_CLASSES.some((c) => c.key === cls)) view.cls = cls;
    }
    const t = app.derived().totals;
    const inv = t.inv.total;
    const s = seriesFor(app, "investments", view.range, inv.value);
    const last = state.settings.lastPriceRefresh;
    return html`
      ${pageHead("Investimenti", html`
        <button type="button" class="btn" data-action="inv-annual">${icon("file", 18)}<span>Riepilogo annuale</span></button>
        <button type="button" class="btn" data-action="refresh-prices">${icon("refresh", 18)}<span>Aggiorna prezzi</span></button>
        <div class="menu"><button type="button" class="btn primary" data-action="toggle-menu" aria-expanded="false" aria-controls="inv-add-menu">${icon("plus", 18)}<span>Aggiungi</span></button>
          <div class="menu-list" id="inv-add-menu" hidden>${HOLDING_CLASSES.map((c) => html`<button type="button" data-action="add" data-coll="${c.key}">${c.singular}</button>`)}<button type="button" data-action="add" data-coll="pac">Piano di accumulo</button></div></div>`)}
      <div class="grid">
        <section class="card span-3 stat"><p class="stat-label">Valore totale</p><p class="stat-value">${fmtEUR(inv.value)}</p><p class="stat-sub">${inv.count} posizioni</p></section>
        <section class="card span-3 stat"><p class="stat-label">Guadagno o perdita</p><p class="stat-value ${inv.gain >= 0 ? "pos" : "neg"}">${inv.cost > 0 ? fmtSigned(inv.gain) : "—"}</p><p class="stat-sub">${inv.cost > 0 ? html`${fmtPct(inv.gainPct, 1, true)} su ${fmtEUR(inv.cost)} investiti` : "Manca il prezzo di carico"}</p></section>
        <section class="card span-3 stat"><p class="stat-label">Senza prezzo di carico</p><p class="stat-value">${inv.missingCost}</p><p class="stat-sub">${inv.missingCost ? "posizioni escluse dal guadagno" : "tutte le posizioni incluse"}</p></section>
        <section class="card span-3 stat"><p class="stat-label">Prezzi aggiornati</p><p class="stat-value small">${last ? fmtRelative(last.slice(0, 10), app.today) : "mai"}</p><p class="stat-sub">onvista per ETF e azioni, Coinbase per le crypto</p></section>

        <section class="card span-8 hero" aria-labelledby="h-inv-chart">
          <div class="card-head"><div><h2 class="card-label" id="h-inv-chart">Valore degli investimenti</h2><p class="hero-value">${fmtEUR(inv.value)}</p><p class="hero-delta">${deltaLine(s.points, s.range)}</p></div>${rangeSwitch("inv-range", view.range)}</div>
          <div class="chart" data-chart="inv-history"></div>
        </section>
        <section class="card span-4" aria-labelledby="h-inv-alloc">
          ${cardHead("Ripartizione", "", "h-inv-alloc")}
          <div class="chart donut" data-chart="inv-alloc"></div>
          <ul class="legend-list">${HOLDING_CLASSES.map((c) => {
            const cs = t.inv.byClass[c.key];
            return html`<li><i class="key" style="background:var(--series-${c.series})"></i><span class="ll-name">${c.label}</span><span class="ll-val">${fmtEUR(cs.value)}</span><span class="ll-sub">${fmtPct(inv.value ? (cs.value / inv.value) * 100 : 0, 1)}${cs.cost > 0 ? html` · <span class="${cs.gain >= 0 ? "pos" : "neg"}">${fmtSigned(cs.gain)}</span>` : ""}</span></li>`;
          })}</ul>
        </section>

        <section class="card span-12" aria-labelledby="h-holdings">
          <div class="card-head"><h2 class="card-title" id="h-holdings">Posizioni</h2>
            <div class="seg seg-sm" role="group" aria-label="Classe">${[["all", "Tutte"], ...HOLDING_CLASSES.map((c) => [c.key, c.label])].map(([k, l]) => html`<button type="button" data-action="inv-cls" data-value="${k}" aria-pressed="${view.cls === k}">${l}</button>`)}</div></div>
          ${holdingsTable(app, inv.value)}
          <p class="card-foot">Il guadagno considera solo le posizioni con prezzo medio di carico inserito. Tocca un nome per modificarlo.</p>
        </section>

        ${pacSection(app)}
      </div>`;
  },

  mount(root, app, route) {
    const t = app.derived().totals;
    const s = seriesFor(app, "investments", view.range, t.inv.total.value);
    const h = root.querySelector('[data-chart="inv-history"]');
    if (h) areaChart(h, { points: s.points, height: 220, xFormat: fmtDayMonth, tipDate: fmtDate, seriesLabel: "Investimenti", color: "var(--series-1)", summary: `Valore degli investimenti ${s.range.name}.` });
    const a = root.querySelector('[data-chart="inv-alloc"]');
    if (a) donutChart(a, {
      size: 176, centerLabel: "Totale",
      slices: HOLDING_CLASSES.map((c) => ({ label: c.label, value: t.inv.byClass[c.key].value, color: `var(--series-${c.series})` })),
      summary: `Ripartizione: ${HOLDING_CLASSES.map((c) => `${c.label} ${fmtEUR(t.inv.byClass[c.key].value)}`).join(", ")}.`,
    });
    if (route.params.get("sezione") === "pac" && route.changed) {
      const el = root.querySelector("#pac");
      if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
    }
  },

  actions: {
    "inv-range": (el, app) => { view.range = el.dataset.value; app.rerender(); },
    "inv-cls": (el, app) => { view.cls = el.dataset.value; app.rerender(); },
    "inv-annual": (el, app) => openAnnualReport(app),
  },
};

// Riepilogo annuale per la dichiarazione dei redditi: posizioni a inizio e fine anno, versamenti dei PAC.
export function openAnnualReport(app, year) {
  const years = annualYears(app.state, app.today);
  let y = year || years[0];
  const LABEL = { etf: "ETF", stocks: "Azione", crypto: "Crypto" };
  const qty = (v) => (v == null ? html`<span class="muted">—</span>` : fmtQty(v));
  const eur = (v) => (v == null ? html`<span class="muted">—</span>` : fmtEUR(v));
  const body = () => {
    const r = annualReport(app.state, y, app.today);
    return html`<div class="form-grid"><label class="field" for="ar-year"><span class="field-label">Anno</span><select class="input" id="ar-year">${years.map((v) => html`<option value="${v}"${raw(v === y ? " selected" : "")}>${v}</option>`)}</select></label></div>
      <p class="sheet-text">${r.start ? html`Inizio: posizioni ${onDate("a", r.start.date)}${r.start.date.slice(5) !== "01-01" ? " (primo giorno salvato dall'app)" : ""}.` : "Inizio anno: non salvato dall'app (servono i documenti del broker)."} ${r.end ? html`Fine: ${r.current ? "posizioni di oggi" : `posizioni ${onDate("a", r.end.date)}`}.` : "Fine anno: non disponibile."}</p>
      ${r.rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Strumento</th><th scope="col" class="num hide-sm">Quantità inizio</th><th scope="col" class="num">Valore inizio</th><th scope="col" class="num hide-sm">Quantità fine</th><th scope="col" class="num">Valore fine</th><th scope="col" class="num hide-sm">Versato (PAC)</th></tr></thead>
        <tbody>${r.rows.map((x) => html`<tr><th scope="row">${x.name || "Senza nome"}<span class="cell-sub">${LABEL[x.coll] || x.coll}${x.code ? html` · <span translate="no">${x.code}</span>` : ""}${x.broker ? ` · ${x.broker}` : ""}</span></th><td class="num hide-sm">${qty(x.startQty)}</td><td class="num">${eur(x.startValue)}</td><td class="num hide-sm">${qty(x.endQty)}</td><td class="num">${eur(x.endValue)}</td><td class="num hide-sm">${x.contributions ? fmtEUR(x.contributions) : html`<span class="muted">—</span>`}</td></tr>`)}</tbody>
      </table></div>
      <h3 class="subhead">Per broker</h3>
      <ul class="list compact">${r.byBroker.map((b) => html`<li class="ar-broker"><span>${b.broker || "Senza broker"} <span class="muted">· ${b.count === 1 ? "1 strumento" : `${b.count} strumenti`}</span></span><span>${r.start ? `${fmtEUR(b.startValue)} → ` : ""}<strong>${fmtEUR(b.endValue)}</strong>${b.contributions ? html` <span class="muted">· versati ${fmtEUR(b.contributions)}</span>` : ""}</span></li>`)}</ul>
      <dl class="facts">
        <div><dt>Valore a inizio anno</dt><dd>${r.totals.startValue != null ? fmtEUR(r.totals.startValue) : "—"}</dd></div>
        <div><dt>Valore a fine anno</dt><dd>${r.totals.endValue != null ? fmtEUR(r.totals.endValue) : "—"}</dd></div>
        <div><dt>Versato con i PAC</dt><dd>${fmtEUR(r.totals.contributions)}${r.unattributed ? html` <span class="muted">(di cui ${fmtEUR(r.unattributed)} di piani o strumenti non più presenti)</span>` : ""}</dd></div>
        <div><dt>Vendite registrate (Disinvestimenti)</dt><dd>${fmtEUR(r.sales)}</dd></div>
      </dl>` : emptyState("Nessuna posizione per quest'anno", "")}
      <p class="card-foot">Dati utili per la dichiarazione dei redditi (ad esempio per gli investimenti presso intermediari esteri). Se e come dichiararli dipende dal broker e dal regime fiscale: verifica con chi ti fa il 730. I valori usano i prezzi salvati dall'app, che possono differire da quelli ufficiali del broker.</p>`;
  };
  const dlg = openSheet({
    title: "Riepilogo annuale degli investimenti",
    wide: true,
    body: body(),
    footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Chiudi</button><button type="button" class="btn primary" data-csv>${icon("download", 18)} Scarica CSV</button>`,
  });
  const sheetBody = dlg.querySelector(".sheet-body");
  dlg.addEventListener("change", (e) => {
    if (e.target.id !== "ar-year") return;
    y = Number(e.target.value);
    sheetBody.innerHTML = String(body());
    sheetBody.querySelector("#ar-year")?.focus();
  });
  dlg.querySelector("[data-csv]").addEventListener("click", () => {
    downloadText(annualCsv(annualReport(app.state, y, app.today)), `investimenti-${y}.csv`, "text/csv;charset=utf-8");
  });
}

// Registrazione di un versamento PAC: importo e prezzo di esecuzione si possono correggere prima di salvare.
export function openPacRegister(app, id) {
  const pac = app.store.find("pac", id);
  if (!pac) return;
  const target = resolveAsset(pac.asset, app.state);
  const price = target ? toNum(target.holding.currentPrice) : 0;
  const dlg = openSheet({
    title: `Versamento · ${pac.name || "Piano"}`,
    closeOnBackdrop: false,
    body: html`<form class="form" novalidate>
      <p class="sheet-text">${target ? html`Acquisto di <strong>${target.holding.name}</strong> ${onDate("di", pac.nextDate)}${pac.accountId ? `, addebitato su ${nameOf(app.state.accounts, pac.accountId)}` : ""}.` : "Lo strumento collegato non esiste più: modifica il piano."}</p>
      <div class="form-grid">
        <label class="field" for="pr-amount"><span class="field-label">Importo (€)</span><input class="input num" id="pr-amount" inputmode="decimal" value="${numToInput(pac.amount)}" autocomplete="off"></label>
        <label class="field" for="pr-price"><span class="field-label">Prezzo di esecuzione (€)</span><input class="input num" id="pr-price" inputmode="decimal" value="${numToInput(price)}" autocomplete="off"></label>
      </div>
      <p class="form-note" data-preview></p>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" hidden></button></form>`,
    footer: html`<button type="button" class="btn ghost" data-skip>Salta questa scadenza</button><span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-save${target ? "" : " disabled"}>Registra</button>`,
  });
  const amountEl = dlg.querySelector("#pr-amount"), priceEl = dlg.querySelector("#pr-price"), preview = dlg.querySelector("[data-preview]");
  const upd = () => {
    const a = parseAmount(amountEl.value), p = parseAmount(priceEl.value);
    preview.textContent = a > 0 && p > 0 ? `Quote acquistate: ${fmtNum(a / p, 6)}. Prossimo versamento: ${fmtDate(addPeriod(pac.nextDate, pac.frequency))}.` : "";
  };
  upd();
  dlg.addEventListener("input", upd);
  const save = () => {
    const res = planPacRegistration(pac, app.state, app.today, { amount: parseAmount(amountEl.value), price: parseAmount(priceEl.value) });
    if (res.error) {
      const box = dlg.querySelector(".form-error");
      box.textContent = res.error;
      box.hidden = false;
      return;
    }
    dlg.close();
    app.commitWithUndo(res.ops, `Versamento registrato: ${fmtNum(res.units, 6)} quote`);
  };
  dlg.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  dlg.querySelector("[data-save]").addEventListener("click", save);
  dlg.querySelector("[data-skip]").addEventListener("click", () => {
    dlg.close();
    app.commitWithUndo(planPacSkip(pac).ops, "Scadenza saltata");
  });
  amountEl.focus();
}

export function skipPac(app, id) {
  const pac = app.store.find("pac", id);
  if (!pac) return;
  app.commitWithUndo(planPacSkip(pac).ops, `${pac.name || "Piano"}: scadenza saltata`);
}
