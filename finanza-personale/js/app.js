import { html } from "./lib/html.js";
import { icon, logo } from "./lib/icons.js";
import { addDays, addPeriod, todayStr } from "./lib/dates.js";
import { fmtPct, fmtPrice, numToInput, onDate } from "./lib/format.js";
import { copyText, downloadText, readFileText } from "./lib/dom.js";
import { normalizeIban } from "./lib/iban.js";
import { createStore, invertOps } from "./data/store.js";
import { PATCH_FORMAT, backupCounts, buildBackup, importOps, isFullBackup, parseBackup, parsePatch, patchPlan, transactionsCsv, wipeOps } from "./data/backup.js";
import { BUNDLE_FORMAT, parseBundle } from "./domain/bundle.js";
import { openBundleImport } from "./ui/import-bundle.js";
import { HOLDING_CLASSES, totals } from "./domain/finance.js";
import { planSchedules, resumePatch } from "./domain/schedules.js";
import { planLoanPayments } from "./domain/loans.js";
import { buildSnapshot, sameSnapshot } from "./domain/history.js";
import { ANNUAL, annualOps } from "./domain/annual.js";
import { snoozeData } from "./domain/alerts.js";
import { CATEGORIES_VERSION, seedCategoryOps, upgradeCategoryOps } from "./domain/categories.js";
import { refreshPrices } from "./domain/prices.js";
import { disposeCharts } from "./ui/charts.js";
import { alertDialog, confirmDialog, openSheet, toast } from "./ui/feedback.js";
import { openOperationForm } from "./ui/operation.js";
import { openEntityForm } from "./ui/entity.js";
import { openCardSettlement } from "./ui/card-settle.js";
import { openCsvImport } from "./ui/import-csv.js";
import { openPaypalImport } from "./ui/import-paypal.js";
import { openRulesManager } from "./pages/settings.js";
import dashboard from "./pages/dashboard.js";
import accounts, { openAccountDetail } from "./pages/accounts.js";
import transactions from "./pages/transactions.js";
import cashflow from "./pages/cashflow.js";
import budget, { openCategoriesManager } from "./pages/budget.js";
import investments, { openPacRegister, skipPac } from "./pages/investments.js";
import settings from "./pages/settings.js";
import goals from "./pages/goals.js";
import forecast from "./pages/forecast.js";
import people from "./pages/people.js";

const PAGES = { "": dashboard, conti: accounts, transazioni: transactions, flusso: cashflow, previsioni: forecast, budget, obiettivi: goals, persone: people, investimenti: investments, impostazioni: settings };
const NAV = [
  { path: "", label: "Panoramica", icon: "home" },
  { path: "conti", label: "Conti", icon: "wallet" },
  { path: "transazioni", label: "Transazioni", icon: "list" },
  { path: "flusso", label: "Flusso di cassa", icon: "flow" },
  { path: "previsioni", label: "Previsioni", icon: "forecast" },
  { path: "budget", label: "Budget", icon: "target" },
  { path: "obiettivi", label: "Obiettivi", icon: "flag" },
  { path: "persone", label: "Persone e viaggi", icon: "user" },
  { path: "investimenti", label: "Investimenti", icon: "trend" },
];
const TABS = [
  { path: "", label: "Panoramica", icon: "home" },
  { path: "conti", label: "Conti", icon: "wallet" },
  { path: "transazioni", label: "Movimenti", icon: "list" },
  { path: "previsioni", label: "Previsioni", icon: "forecast" },
];
// Azioni che aprono qualcos'altro: chiudono prima la finestra da cui sono state avviate.
const CLOSES_DIALOG = new Set(["edit-tx", "edit-schedule", "edit", "add", "account-detail", "register-pac", "new-op", "settle-card", "import-csv", "import-paypal", "open-rules"]);

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = h.split("?");
  const page = path.split("/")[0];
  return { page: PAGES[page] ? page : "", params: new URLSearchParams(query) };
}

function shell(session) {
  const user = session.mode === "firebase"
    ? html`${session.photo ? html`<img class="avatar-img sm" src="${session.photo}" alt="" width="28" height="28" referrerpolicy="no-referrer">` : html`<span class="avatar sm">${icon("user", 16)}</span>`}<span class="user-name">${session.name || session.email || "Account"}</span>`
    : html`<span class="avatar sm">${icon("user", 16)}</span><span class="user-name">Modalità locale</span>`;
  return html`
    <div class="app">
      <aside class="sidebar" id="sidebar" aria-label="Menu principale">
        <div class="brand">${logo(30)}<span>Finanza Personale</span><button type="button" class="icon-btn drawer-close" data-action="close-drawer" aria-label="Chiudi menu">${icon("x")}</button></div>
        <button type="button" class="btn primary block" data-action="new-op">${icon("plus", 18)}<span>Nuova operazione</span></button>
        <nav class="nav" aria-label="Sezioni">
          ${NAV.map((n) => html`<a href="#/${n.path}" data-nav="${n.path}">${icon(n.icon)}<span>${n.label}</span></a>`)}
        </nav>
        <div class="sidebar-foot">
          <p class="sync" id="sync-status"></p>
          <a class="user-chip" href="#/impostazioni" data-nav="impostazioni">${user}${icon("sliders", 18)}</a>
        </div>
      </aside>
      <div class="scrim" data-action="close-drawer" hidden></div>
      <div class="content">
        <header class="topbar">
          <button type="button" class="icon-btn" data-action="open-drawer" aria-label="Apri il menu" aria-controls="sidebar" aria-expanded="false">${icon("menu")}</button>
          <span class="topbar-title" id="topbar-title">Finanza Personale</span>
          <button type="button" class="icon-btn accent" data-action="new-op" aria-label="Nuova operazione">${icon("plus")}</button>
        </header>
        <main id="main" class="main" tabindex="-1"></main>
      </div>
      <nav class="tabbar" aria-label="Sezioni principali">
        ${TABS.map((n) => html`<a href="#/${n.path}" data-nav="${n.path}">${icon(n.icon, 22)}<span>${n.label}</span></a>`)}
        <button type="button" data-action="open-drawer" aria-controls="sidebar">${icon("menu", 22)}<span>Altro</span></button>
      </nav>
    </div>`;
}

export function startApp({ backend, session, onSignOut, onLeaveLocal, installer }) {
  const store = createStore(backend);
  const { state } = store;
  const root = document.getElementById("root");
  root.innerHTML = String(shell(session));
  const main = document.getElementById("main");
  const sidebar = document.getElementById("sidebar");
  const scrim = root.querySelector(".scrim");
  let derivedCache = { version: -1, today: "", value: null };
  let renderQueued = false;
  let lastRouteKey = null;
  let loadError = null;

  const app = {
    store, state, session,
    get today() { return todayStr(); },
    get online() { return navigator.onLine; },
    get canInstall() { return !!(installer && installer.available()); },
    derived() {
      const t = todayStr();
      if (derivedCache.version !== store.version || derivedCache.today !== t) {
        derivedCache = { version: store.version, today: t, value: { totals: totals(state, t) } };
      }
      return derivedCache.value;
    },
    newId: () => store.newId(),
    commit(ops) {
      return store.commit(ops).catch((e) => {
        console.error("Salvataggio non riuscito", e);
        toast(`Salvataggio non riuscito: ${friendlyError(e)}`, { type: "error", timeout: 8000 });
        throw e;
      });
    },
    // Salva subito (anche offline: Firestore sincronizza appena torna la rete) e offre "Annulla".
    // undoExtra: operazioni in più calcolate al momento dell'annullamento (es. i movimenti generati nel frattempo).
    commitWithUndo(ops, message, { undoExtra } = {}) {
      const inverse = invertOps(ops, state);
      app.commit(ops).catch(() => {});
      toast(message, { action: inverse.length ? "Annulla" : null, onAction: () => app.commit([...(undoExtra ? undoExtra() : []), ...inverse]).then(() => toast("Modifica annullata")).catch(() => {}) });
    },
    rerender: () => scheduleRender(),
    navigate: (hash) => { location.hash = hash; },
    openEntity: (coll, id, presets) => openEntityForm(app, coll, id, presets),
    openTransaction(id) {
      const tx = store.find("transactions", id);
      if (tx) openOperationForm(app, { tx });
    },
    getTheme() {
      try { return localStorage.getItem("patrimonio:theme") || "auto"; } catch { return "auto"; }
    },
    setTheme(v) {
      try { if (v === "auto") localStorage.removeItem("patrimonio:theme"); else localStorage.setItem("patrimonio:theme", v); } catch {}
      if (v === "auto") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", v);
      scheduleRender();
    },
    refreshPrices: runPriceRefresh,
    importFile,
  };

  // ---------- rendering ----------
  // setTimeout e non requestAnimationFrame: così la pagina si aggiorna anche se la scheda non è in primo piano.
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      render();
    }, 0);
  }

  function render() {
    const route = parseRoute();
    const page = PAGES[route.page];
    const routeKey = location.hash;
    const routeChanged = routeKey !== lastRouteKey;
    updateNav(route.page, page.title);
    if (!store.ready || loadError === "denied") {
      main.innerHTML = String(loadError === "denied"
        ? html`<div class="state-screen"><p class="empty-title">Account non autorizzato</p><p>${session.email || "Questo account"} non può usare questa app: i dati sono riservati all'account del proprietario.</p>${session.mode === "firebase" ? html`<button type="button" class="btn primary" data-action="sign-out-now">${icon("logout", 18)} Esci e cambia account</button>` : ""}</div>`
        : loadError
          ? html`<div class="state-screen"><p class="empty-title">Impossibile leggere i dati</p><p>${loadError}</p></div>`
          : html`<div class="state-screen" role="status"><span class="spinner" aria-hidden="true"></span><p>Caricamento dei dati…</p></div>`);
      return;
    }
    // La pagina si considera "aperta" solo quando si vede davvero (non la schermata di caricamento).
    lastRouteKey = routeKey;
    const active = document.activeElement;
    const focusId = !routeChanged && active && main.contains(active) && active.id ? active.id : null;
    const sel = focusId && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
    const y = window.scrollY;
    disposeCharts();
    // changed: si è appena arrivati da un link (anche lo stesso di prima): i parametri come ?tab= valgono di nuovo.
    const r = { ...route, changed: routeChanged };
    main.innerHTML = String(page.render(app, r));
    if (page.mount) page.mount(main, app, r);
    if (routeChanged) {
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, y);
      if (focusId) {
        const el = document.getElementById(focusId);
        if (el) {
          el.focus({ preventScroll: true });
          if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch {}
        }
      }
    }
  }

  function updateNav(pageKey, title) {
    root.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === pageKey) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = `${title} · Finanza Personale`;
    const tt = document.getElementById("topbar-title");
    if (tt) tt.textContent = title;
    const sync = document.getElementById("sync-status");
    if (sync) {
      sync.innerHTML = String(navigator.onLine
        ? html`${icon("cloud", 16)}<span>${session.mode === "firebase" ? "Sincronizzato" : "Salvato su questo dispositivo"}</span>`
        : html`${icon("cloudOff", 16)}<span>Offline: le modifiche si sincronizzano al ritorno della rete</span>`);
    }
  }

  function openDrawer(open) {
    sidebar.classList.toggle("open", open);
    scrim.hidden = !open;
    root.querySelectorAll('[data-action="open-drawer"]').forEach((b) => b.setAttribute("aria-expanded", String(open)));
    if (open) sidebar.querySelector("a, button").focus();
  }

  // ---------- azioni ----------
  const actions = {
    "new-op": (el) => openOperationForm(app, { mode: el.dataset.mode || null }),
    // Dall'avviso di un addebito scoperto: il giroconto già compilato, da confermare.
    "cover-debit": (el) => {
      const ok = (id) => state.accounts.some((a) => a.id === id);
      if (!ok(el.dataset.from) || !ok(el.dataset.to)) return;
      openOperationForm(app, { mode: "Giroconto", preset: { from: `account:${el.dataset.from}`, to: `account:${el.dataset.to}`, amount: numToInput(Number(el.dataset.amount) || 0), description: "Copertura addebiti", date: app.today } });
    },
    "edit-tx": (el) => app.openTransaction(el.dataset.id),
    "edit-schedule": (el) => {
      const s = store.find("schedules", el.dataset.id);
      if (s) openOperationForm(app, { schedule: s });
    },
    "toggle-schedule": (el) => {
      const s = store.find("schedules", el.dataset.id);
      if (!s) return;
      const data = s.status === "In pausa" ? resumePatch(s, app.today) : { status: "In pausa" };
      app.commitWithUndo([{ op: "update", coll: "schedules", id: s.id, data }], s.status === "In pausa" ? "Operazione ripresa" : "Operazione in pausa");
    },
    edit: (el) => openEntityForm(app, el.dataset.coll, el.dataset.id),
    add: (el) => openEntityForm(app, el.dataset.coll),
    "account-detail": (el) => openAccountDetail(app, el.dataset.coll, el.dataset.id),
    "copy-iban": async (el) => {
      const a = store.find("accounts", el.dataset.id);
      const iban = a ? normalizeIban(a.iban) : "";
      if (!iban) return;
      const ok = await copyText(iban, el);
      const msg = ok ? "IBAN copiato" : "Copia non riuscita: tieni premuto sull'IBAN per selezionarlo";
      // Nel dettaglio del conto (una finestra) la notifica resterebbe sotto: l'esito compare accanto al pulsante.
      const status = el.closest(".iban-line")?.querySelector("[data-copy-status]");
      if (!status) return toast(msg, { type: ok ? "info" : "error" });
      status.textContent = msg;
      status.className = `copy-status ${ok ? "pos" : "neg"}`;
      clearTimeout(status._timer);
      status._timer = setTimeout(() => { status.textContent = ""; }, ok ? 4000 : 10000);
    },
    "register-pac": (el) => openPacRegister(app, el.dataset.id),
    "skip-pac": (el) => skipPac(app, el.dataset.id),
    "settle-card": (el) => openCardSettlement(app, el.dataset.id, { renew: el.dataset.renew === "1" ? true : undefined }),
    "import-csv": (el) => openCsvImport(app, { target: el.dataset.target || "" }),
    "import-paypal": () => openPaypalImport(app),
    "open-rules": () => openRulesManager(app),
    // Rimanda un avviso di una settimana. "Annulla" lo fa scadere ieri: va bene sia con l'unione profonda di
    // Firestore sia con quella semplice della modalità locale (la mappa riscritta contiene anche gli altri).
    "snooze-alert": (el) => {
      const key = el.dataset.key;
      if (!key) return;
      app.commit([{ op: "merge", coll: "settings", id: "prefs", data: snoozeData(state.settings, key, app.today, 7) }]).catch(() => {});
      // Annulla tocca solo questo avviso, partendo da com'è adesso (non da com'era prima del clic).
      const undo = () => {
        const now = state.settings.alertSnooze && typeof state.settings.alertSnooze === "object" ? state.settings.alertSnooze : {};
        app.commit([{ op: "merge", coll: "settings", id: "prefs", data: { alertSnooze: { ...now, [key]: addDays(app.today, -1) } } }]).catch(() => {});
      };
      toast("Te lo ricordo tra una settimana", { action: "Annulla", onAction: undo });
    },
    "snooze-backup": () => {
      app.commit([{ op: "merge", coll: "settings", id: "prefs", data: { backupSnoozeUntil: addPeriod(app.today, "Settimanale") } }]).catch(() => {});
      toast("Te lo ricordo tra una settimana");
    },
    "sign-out-now": () => onSignOut && onSignOut(),
    "refresh-prices": () => runPriceRefresh({ silent: false }),
    "export-json": () => {
      const now = new Date().toISOString();
      downloadText(JSON.stringify(buildBackup(state, now), null, 2), `patrimonio-backup-${app.today}.json`, "application/json");
      app.commit([{ op: "merge", coll: "settings", id: "prefs", data: { lastBackupAt: now } }]).catch(() => {});
      toast("Backup scaricato: conservalo in un posto sicuro");
    },
    "export-csv": () => {
      downloadText(transactionsCsv(state), `movimenti-${app.today}.csv`, "text/csv;charset=utf-8");
      toast("Movimenti esportati");
    },
    "open-categories": () => openCategoriesManager(app),
    wipe: async () => {
      const ok = await confirmDialog({ title: "Eliminare tutti i dati?", text: "Conti, movimenti, investimenti, storico e categorie verranno cancellati definitivamente.", confirmLabel: "Elimina tutto", danger: true, requireText: "ELIMINA" });
      if (!ok) return;
      app.commit([...wipeOps(state), { op: "delete", coll: "settings", id: "prefs" }]).then(() => toast("Tutti i dati sono stati eliminati")).catch(() => {});
    },
    "set-theme": (el) => app.setTheme(el.dataset.value),
    "toggle-auto-prices": () => {
      const on = state.settings.autoPrices !== false;
      app.commit([{ op: "merge", coll: "settings", id: "prefs", data: { autoPrices: !on } }]).catch(() => {});
    },
    install: () => installer && installer.prompt(),
    "sign-out": async () => {
      const ok = await confirmDialog({ title: "Uscire?", text: "Per rientrare ti servirà l'accesso con Google. La copia dei dati su questo dispositivo verrà cancellata.", confirmLabel: "Esci" });
      if (ok && onSignOut) onSignOut();
    },
    "leave-local": () => onLeaveLocal && onLeaveLocal(),
    "open-drawer": () => openDrawer(true),
    "close-drawer": () => openDrawer(false),
    "toggle-menu": (el) => {
      const list = document.getElementById(el.getAttribute("aria-controls"));
      if (!list) return;
      const open = list.hidden;
      closeMenus();
      list.hidden = !open;
      el.setAttribute("aria-expanded", String(open));
      if (open) list.querySelector("button")?.focus();
    },
  };

  function closeMenus(except) {
    document.querySelectorAll(".menu-list:not([hidden])").forEach((m) => {
      if (except && m.contains(except)) return;
      m.hidden = true;
      const b = document.querySelector(`[aria-controls="${m.id}"]`);
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }

  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!e.target.closest('[data-action="toggle-menu"]')) closeMenus(e.target);
    if (!el || el.disabled) return;
    const action = el.dataset.action;
    const page = PAGES[parseRoute().page];
    const handler = (page.actions && page.actions[action]) || actions[action];
    if (!handler) return;
    if (el.tagName === "A") e.preventDefault();
    const dlg = el.closest("dialog");
    if (dlg && CLOSES_DIALOG.has(action)) dlg.close();
    if (sidebar.classList.contains("open") && action !== "open-drawer" && !el.closest(".nav")) openDrawer(false);
    handler(el, app, e);
  }

  function onInput(e) {
    const el = e.target.closest("[data-input]");
    if (!el || !main.contains(el)) return;
    const page = PAGES[parseRoute().page];
    if (!page.onInput) return;
    if (e.type === "input" && el.tagName === "SELECT") return;
    if (e.type === "change" && el.type === "search") return;
    page.onInput(el.dataset.input, el.value, app, el);
  }

  function onKey(e) {
    if (e.key === "Escape" && sidebar.classList.contains("open")) openDrawer(false);
  }

  function onRoute() {
    openDrawer(false);
    closeMenus();
    scheduleRender();
  }

  const onOnline = () => scheduleRender();
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onInput);
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", onRoute);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOnline);
  root.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", () => openDrawer(false)));

  // ---------- attività in background ----------
  let seeded = false;
  let schedSig = "";
  let schedBackoff = 0;
  let histTimer = null;
  let lastSnapshot = null;
  let annualSig = "";
  let pricesChecked = false;
  let priceRun = null;

  let firstUseSet = false;
  function runOnceJobs() {
    const s = state.settings;
    if (!firstUseSet && !s.firstUseAt) {
      firstUseSet = true;
      store.commit([{ op: "merge", coll: "settings", id: "prefs", data: { firstUseAt: app.today } }]).catch(() => {});
    }
    if (seeded) return;
    if (!s.categoriesSeeded && !state.categories.length) {
      seeded = true;
      const ops = seedCategoryOps([], state.transactions);
      ops.push({ op: "merge", coll: "settings", id: "prefs", data: { categoriesSeeded: true, categoriesVersion: CATEGORIES_VERSION } });
      store.commit(ops).catch((e) => console.error("Categorie iniziali non create", e));
    } else if (s.categoriesSeeded && !(s.categoriesVersion >= CATEGORIES_VERSION)) {
      // Categorie predefinite aggiunte in una versione successiva (es. "Carta di credito").
      seeded = true;
      const ops = upgradeCategoryOps(state.categories, s.categoriesVersion);
      ops.push({ op: "merge", coll: "settings", id: "prefs", data: { categoriesVersion: CATEGORIES_VERSION } });
      store.commit(ops).catch((e) => console.error("Categorie non aggiornate", e));
    }
  }

  function runJobs() {
    if (!store.ready || loadError === "denied") return;
    // Le scritture "una volta sola" partono solo dopo aver letto le impostazioni dal server: una copia
    // locale vuota o vecchia (nuovo dispositivo, rete lenta) non deve far riscrivere categorie e date.
    if (store.isFresh("settings")) runOnceJobs();
    // Operazioni programmate e rate automatiche solo con i dati letti dal server: un dispositivo con la copia
    // locale vecchia riscriverebbe rate già corrette o eliminate su un altro e il debito residuo.
    if (Date.now() >= schedBackoff && store.isFresh("transactions") && store.isFresh("loans") && store.isFresh("schedules")) {
      const plan = planSchedules(state.schedules, state.transactions, app.today);
      const loans = planLoanPayments(state, app.today);
      const ops = [...plan.ops, ...loans.ops];
      if (ops.length) {
        const sig = ops.map((o) => `${o.coll}/${o.id}`).join("|");
        if (sig !== schedSig) {
          schedSig = sig;
          store.commit(ops)
            .then(() => {
              if (plan.created) toast(plan.created === 1 ? "Registrata 1 operazione programmata" : `Registrate ${plan.created} operazioni programmate`);
              if (loans.created) toast(loans.created === 1 ? "Registrata 1 rata di un finanziamento" : `Registrate ${loans.created} rate dei finanziamenti`);
            })
            .catch((e) => { schedSig = ""; schedBackoff = Date.now() + 60000; console.error("Operazioni programmate non registrate", e); });
        }
      }
    }
    clearTimeout(histTimer);
    histTimer = setTimeout(() => {
      if (!store.ready) return;
      const snap = buildSnapshot(app.derived().totals, app.today);
      if (!sameSnapshot(store.find("history", snap.date), snap) && !sameSnapshot(lastSnapshot, snap)) {
        lastSnapshot = snap;
        store.commit([{ op: "set", coll: "history", id: snap.date, data: snap }]).catch((e) => { lastSnapshot = null; console.error("Istantanea non salvata", e); });
      }
      // Posizioni di inizio e fine anno per il riepilogo annuale: solo aggiunte, e la prima dell'anno
      // solo dopo aver letto i riepiloghi dal server (una copia locale vuota non deve riscriverla).
      const annual = annualOps(state, app.today, store.isFresh(ANNUAL), HOLDING_CLASSES.every((c) => store.isFresh(c.key)));
      const sig = JSON.stringify(annual);
      if (annual.length && sig !== annualSig) {
        annualSig = sig;
        store.commit(annual).catch((e) => { annualSig = ""; console.error("Riepilogo annuale non salvato", e); });
      }
    }, 2500);
    if (!pricesChecked) {
      pricesChecked = true;
      const last = Date.parse(state.settings.lastPriceRefresh || "") || 0;
      const holdings = state.etf.length + state.stocks.length + state.crypto.length;
      if (state.settings.autoPrices !== false && holdings && navigator.onLine && Date.now() - last > 12 * 3600000) {
        setTimeout(() => runPriceRefresh({ silent: true }), 1500);
      }
    }
  }

  async function runPriceRefresh({ silent = false } = {}) {
    if (priceRun) return priceRun;
    if (!(state.etf.length + state.stocks.length + state.crypto.length)) {
      if (!silent) toast("Nessuna posizione da aggiornare");
      return null;
    }
    if (!navigator.onLine) {
      if (!silent) toast("Sei offline: i prezzi si aggiornano quando torna la connessione", { type: "error" });
      return null;
    }
    const closeProgress = silent ? () => {} : toast("Aggiornamento dei prezzi in corso…", { timeout: 0 });
    priceRun = refreshPrices(state, { today: app.today })
      .then(async ({ ops, results }) => {
        closeProgress();
        const all = [...ops, { op: "merge", coll: "settings", id: "prefs", data: { lastPriceRefresh: new Date().toISOString() } }];
        await app.commit(all).catch(() => {});
        const ok = results.filter((r) => r.ok).length;
        const failed = results.filter((r) => !r.ok);
        const big = results.filter((r) => r.bigMove || r.note);
        const msg = failed.length ? `Prezzi aggiornati: ${ok} su ${results.length}` : `Prezzi aggiornati (${ok})`;
        toast(msg + (big.length ? ` · ${big.length} da controllare` : ""), { action: failed.length || big.length || !silent ? "Dettagli" : null, onAction: () => showPriceResults(results), timeout: 7000 });
        return results;
      })
      .catch((e) => {
        closeProgress();
        console.error(e);
        if (!silent) toast("Aggiornamento prezzi non riuscito", { type: "error" });
        return null;
      })
      .finally(() => { priceRun = null; });
    return priceRun;
  }

  function showPriceResults(results) {
    const failed = results.filter((r) => !r.ok);
    const done = results.filter((r) => r.ok).sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0));
    openSheet({
      title: "Aggiornamento prezzi",
      wide: true,
      body: html`
        ${failed.length ? html`<h3 class="subhead">Non aggiornati (${failed.length})</h3><ul class="list">${failed.map((r) => html`<li class="row static"><span class="row-main"><span class="row-title">${r.name}</span><span class="row-sub">${r.error}</span></span><span class="amount muted">${fmtPrice(r.oldPrice)}</span></li>`)}</ul>` : ""}
        <h3 class="subhead">Aggiornati (${done.length})</h3>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Strumento</th><th scope="col" class="num">Prima</th><th scope="col" class="num">Ora</th><th scope="col" class="num">Variazione</th></tr></thead><tbody>
          ${done.map((r) => html`<tr><th scope="row">${r.name}<span class="cell-sub">${r.venue}${r.note ? html` · <span class="warn-text">${r.note}</span>` : ""}</span></th><td class="num">${fmtPrice(r.oldPrice)}</td><td class="num">${fmtPrice(r.price)}</td><td class="num ${r.bigMove ? "warn-text" : ""}">${r.change == null ? "—" : fmtPct(r.change * 100, 1, true)}</td></tr>`)}
        </tbody></table></div>
        <p class="card-foot">Le variazioni oltre il 40% sono evidenziate: controlla che lo strumento sia quello giusto.</p>`,
    });
  }

  function applyPatch(patch) {
    const rows = patchPlan(patch, state, () => app.newId());
    const actionable = rows.filter((r) => r.op);
    const NAMES = { avgPrice: "prezzo medio", quantity: "quantità", currentPrice: "prezzo attuale", isin: "ISIN", name: "nome", broker: "broker", balance: "saldo" };
    const FIELDS = ["isin", "quantity", "avgPrice", "currentPrice", "broker"];
    const title = (r) => (r.doc ? r.doc.name || r.doc.id : r.data.name || Object.values(r.match)[0]);
    const LABEL = { etf: "ETF", stocks: "Azione", crypto: "Crypto", accounts: "Conto", creditCards: "Carta", loans: "Finanziamento", goals: "Obiettivo" };
    const fmtVal = (v) => (typeof v === "number" ? v.toLocaleString("it-IT", { maximumFractionDigits: 6 }) : v == null || v === "" ? "—" : String(v));
    const dlg = openSheet({
      title: "Applica aggiornamenti",
      wide: true,
      closeOnBackdrop: false,
      body: html`${patch.note ? html`<p class="sheet-text">${patch.note}</p>` : ""}
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col"><span class="sr-only">Applica</span></th><th scope="col">Elemento</th><th scope="col">Modifica</th></tr></thead><tbody>
        ${rows.map((r, i) => html`<tr>
          <td>${r.op ? html`<input type="checkbox" data-row="${i}" checked aria-label="Applica a ${title(r)}">` : ""}</td>
          <th scope="row">${title(r)}<span class="cell-sub">${LABEL[r.coll] || r.coll}${r.isNew ? html` · <span class="badge accent">nuovo</span>` : ""}</span></th>
          <td>${r.isNew ? FIELDS.filter((f) => r.data[f] != null).map((f) => html`<div>${NAMES[f] || f}: <strong>${fmtVal(r.data[f])}</strong></div>`)
            : !r.doc ? html`<span class="badge warn">non trovato</span>`
            : !r.changes.length ? html`<span class="muted">già aggiornato</span>`
            : r.changes.map((c) => html`<div>${NAMES[c.field] || c.field}: <span class="muted">${fmtVal(c.from)}</span> → <strong>${fmtVal(c.to)}</strong></div>`)}</td></tr>`)}
        </tbody></table></div>`,
      footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-go${actionable.length ? "" : " disabled"}>Applica le modifiche selezionate</button>`,
    });
    dlg.querySelector("[data-go]").addEventListener("click", () => {
      const ops = rows.filter((r, i) => r.op && dlg.querySelector(`[data-row="${i}"]`)?.checked).map((r) => (r.isNew ? { ...r.op, data: { ...r.op.data, createdAt: Date.now() } } : r.op));
      dlg.close();
      if (ops.length) app.commitWithUndo(ops, ops.length === 1 ? "1 elemento aggiornato" : `${ops.length} elementi aggiornati`);
    });
  }

  async function importFile(file) {
    let parsed;
    try {
      const json = JSON.parse(await readFileText(file));
      if (json && json.format === PATCH_FORMAT) { applyPatch(parsePatch(json)); return; }
      if (json && json.format === BUNDLE_FORMAT) { openBundleImport(app, parseBundle(json)); return; }
      parsed = parseBackup(json);
    } catch (e) {
      await alertDialog("File non valido", (e && e.message) || "Il file non è un backup di Patrimonio.");
      return;
    }
    const counts = backupCounts(parsed);
    const labels = { accounts: "conti", creditCards: "carte", loans: "finanziamenti", transactions: "movimenti", schedules: "operazioni programmate", etf: "ETF", stocks: "azioni", crypto: "crypto", pac: "piani di accumulo", history: "giorni di storico", categories: "categorie", rules: "regole", goals: "obiettivi", annual: "riepiloghi annuali degli investimenti" };
    // "Sostituisci" cancella tutto ciò che non è nel file: si offre solo per un backup completo e non è mai la scelta iniziale.
    const full = isFullBackup(parsed);
    const dlg = openSheet({
      title: "Importa backup",
      closeOnBackdrop: false,
      body: html`<p class="sheet-text">${parsed.exportedAt ? `Backup ${onDate("di", String(parsed.exportedAt).slice(0, 10))}: ` : "Il file contiene: "}${counts.map((c) => `${c.count} ${labels[c.coll]}`).join(", ")}.</p>
        ${parsed.warnings.map((w) => html`<p class="alert-inline">${icon("alert", 18)} ${w}</p>`)}
        <fieldset class="choices"><legend class="field-label">Cosa fare con i dati attuali</legend>
          <label class="choice"><input type="radio" name="mode" value="merge" checked><span><strong>Unisci</strong><span class="muted">Aggiunge gli elementi del backup; quelli con lo stesso identificativo vengono aggiornati. Non cancella niente.</span></span></label>
          ${full
            ? html`<label class="choice"><input type="radio" name="mode" value="replace"><span><strong>Sostituisci</strong><span class="muted">Elimina i dati attuali e tiene solo quelli del backup.</span></span></label>`
            : html`<p class="form-note">Il file non è un backup completo: si può solo unire ai dati attuali.</p>`}
        </fieldset>`,
      footer: html`<span class="spacer"></span><button type="button" class="btn" data-sheet-close>Annulla</button><button type="button" class="btn primary" data-go>Importa</button>`,
    });
    dlg.querySelector("[data-go]").addEventListener("click", async (ev) => {
      const mode = dlg.querySelector('input[name="mode"]:checked')?.value || "merge";
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = "Importazione…";
      let ops = importOps(parsed, state, mode);
      const cats = mode === "replace" ? (parsed.collections.categories || []).map((r) => ({ name: r.data.name })) : [...state.categories, ...(parsed.collections.categories || []).map((r) => ({ name: r.data.name }))];
      ops.push(...seedCategoryOps(cats, (parsed.collections.transactions || []).map((r) => r.data)));
      ops.push({ op: "merge", coll: "settings", id: "prefs", data: { categoriesSeeded: true, categoriesVersion: CATEGORIES_VERSION } });
      // Un elemento eliminato e subito riscritto (es. una categoria predefinita) va solo riscritto.
      const written = new Set(ops.filter((o) => o.op !== "delete").map((o) => `${o.coll}/${o.id}`));
      ops = ops.filter((o) => o.op !== "delete" || !written.has(`${o.coll}/${o.id}`));
      try {
        await Promise.race([app.commit(ops), new Promise((r) => setTimeout(r, 4000))]);
        dlg.close();
        toast(navigator.onLine ? "Importazione completata" : "Importazione salvata: verrà sincronizzata al ritorno della rete", { timeout: 6000 });
        location.hash = "#/";
      } catch {
        btn.disabled = false;
        btn.textContent = "Importa";
      }
    });
  }

  // ---------- avvio ----------
  store.onError((coll, err) => {
    console.error("Lettura non riuscita", coll, err);
    loadError = err && err.code === "permission-denied" ? "denied" : `Errore nella lettura di “${coll}”: ${friendlyError(err)}`;
    scheduleRender();
  });
  store.subscribe(() => {
    scheduleRender();
    runJobs();
  });
  scheduleRender();

  return {
    app,
    stop() {
      store.stop();
      disposeCharts();
      clearTimeout(histTimer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("input", onInput);
      document.removeEventListener("change", onInput);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onRoute);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
      document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      if (backend.destroy) backend.destroy();
    },
  };
}

function friendlyError(e) {
  const code = (e && e.code) || "";
  if (code === "permission-denied") return "permesso negato";
  if (code === "unavailable") return "servizio non raggiungibile";
  if (code === "resource-exhausted") return "limite di utilizzo raggiunto";
  if (e && e.name === "QuotaExceededError") return "spazio del browser esaurito";
  return (e && e.message) || "errore sconosciuto";
}
