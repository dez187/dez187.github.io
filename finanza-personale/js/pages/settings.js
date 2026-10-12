import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { fmtDate, fmtRelative, onDate } from "../lib/format.js";
import { categoryFor } from "../domain/categories.js";
import { sortRules } from "../domain/rules.js";
import { emptyState } from "../ui/components.js";
import { openSheet } from "../ui/feedback.js";
import { cardHead, pageHead } from "./shared.js";

export const APP_VERSION = "2.1.0";

function row(title, text, control) {
  return html`<div class="setting"><div class="setting-text"><p class="setting-title">${title}</p>${text ? html`<p class="setting-sub">${text}</p>` : ""}</div><div class="setting-control">${control}</div></div>`;
}

export default {
  id: "settings",
  title: "Impostazioni",
  render(app) {
    const { state, session } = app;
    const theme = app.getTheme();
    const auto = state.settings.autoPrices !== false;
    const last = state.settings.lastPriceRefresh;
    const counts = [
      ["conti", state.accounts.length], ["carte", state.creditCards.length], ["finanziamenti", state.loans.length],
      ["movimenti", state.transactions.length], ["programmate", state.schedules.length],
      ["posizioni", state.etf.length + state.stocks.length + state.crypto.length], ["piani", state.pac.length], ["giorni di storico", state.history.length],
    ];
    return html`
      ${pageHead("Impostazioni")}
      <div class="grid">
        <section class="card span-6" aria-labelledby="h-set-account">
          ${cardHead("Account", "", "h-set-account")}
          ${session.mode === "firebase"
            ? html`<div class="profile">${session.photo ? html`<img class="avatar-img" src="${session.photo}" alt="" width="44" height="44" referrerpolicy="no-referrer">` : html`<span class="avatar">${icon("user", 20)}</span>`}<div><p class="setting-title">${session.name || "Utente"}</p><p class="setting-sub">${session.email || ""}</p></div></div>
              ${row("Sincronizzazione", "I dati sono salvati nel tuo progetto Firebase e restano disponibili anche offline su questo dispositivo.", html`<span class="badge ${app.online ? "pos" : "warn"}">${app.online ? "online" : "offline"}</span>`)}
              ${row("Esci", "All'uscita la copia dei dati salvata su questo dispositivo viene cancellata.", html`<button type="button" class="btn" data-action="sign-out">${icon("logout", 18)} Esci</button>`)}`
            : html`${row("Modalità locale", "I dati restano solo in questo browser. Per averli su tutti i dispositivi pubblica l'app su Firebase e accedi con Google.", html`<span class="badge warn">solo su questo dispositivo</span>`)}
              ${row("Esci dalla modalità locale", "Torni alla schermata iniziale; i dati locali restano salvati nel browser.", html`<button type="button" class="btn" data-action="leave-local">Esci</button>`)}`}
        </section>

        <section class="card span-6" aria-labelledby="h-set-look">
          ${cardHead("Aspetto", "", "h-set-look")}
          ${row("Tema", "", html`<div class="seg" role="group" aria-label="Tema">${[["auto", "Automatico", "monitor"], ["light", "Chiaro", "sun"], ["dark", "Scuro", "moon"]].map(([v, l, ic]) => html`<button type="button" data-action="set-theme" data-value="${v}" aria-pressed="${theme === v}">${icon(ic, 16)} ${l}</button>`)}</div>`)}
          ${app.canInstall ? row("Installa l'app", "Aggiungila alla schermata Home o al desktop per aprirla come un'app.", html`<button type="button" class="btn" data-action="install">Installa</button>`) : row("Installa l'app", "Su iPhone: Condividi → Aggiungi alla schermata Home. Su Android e computer: menu del browser → Installa app.", "")}
        </section>

        <section class="card span-6" aria-labelledby="h-set-prices">
          ${cardHead("Prezzi", "", "h-set-prices")}
          ${row("Aggiornamento automatico", "All'apertura, se sono passate più di 12 ore dall'ultimo aggiornamento. Fonti: onvista (ETF e azioni, tramite ISIN) e Coinbase (crypto).", html`<button type="button" class="switch" role="switch" aria-checked="${auto}" aria-label="Aggiornamento automatico dei prezzi" data-action="toggle-auto-prices"><span></span></button>`)}
          ${row("Ultimo aggiornamento", last ? `${fmtDate(last.slice(0, 10))} (${fmtRelative(last.slice(0, 10), app.today)})` : "Mai eseguito da questa app.", html`<button type="button" class="btn" data-action="refresh-prices">${icon("refresh", 18)} Aggiorna ora</button>`)}
        </section>

        <section class="card span-6" aria-labelledby="h-set-data">
          ${cardHead("Dati", "", "h-set-data")}
          ${row("Esporta backup completo", html`Tutti i dati in un file JSON. ${state.settings.lastBackupAt ? `Ultimo scaricato ${onDate("il", state.settings.lastBackupAt.slice(0, 10))}.` : "Non ne hai ancora scaricato uno."} Ogni 30 giorni la Panoramica te lo ricorda.`, html`<button type="button" class="btn" data-action="export-json">${icon("download", 18)} JSON</button>`)}
          ${row("Importa un backup o degli aggiornamenti", "Un backup JSON di questa app o del vecchio artifact (scegli se unirlo o sostituire i dati), oppure un file di aggiornamenti come i prezzi di carico.", html`<label class="btn">${icon("upload", 18)} Scegli file<input type="file" accept="application/json,.json" class="sr-only" data-input="import-file"></label>`)}
          ${row("Importa un estratto conto", "File Excel o CSV della banca o della carta (BPM, Unicredit, Revolut, Amex, Nexi e altre): i movimenti già presenti non vengono duplicati.", html`<button type="button" class="btn" data-action="import-csv">${icon("upload", 18)} Estratto</button>`)}
          ${row("PayPal in chiaro", "Carica l'attività scaricata da PayPal: i movimenti descritti solo come “PayPal” prendono il nome del negozio.", html`<button type="button" class="btn" data-action="import-paypal">${icon("upload", 18)} PayPal</button>`)}
          ${row("Regole automatiche", `${state.rules.length === 1 ? "1 regola" : `${state.rules.length} regole`} per assegnare la categoria in base alla descrizione.`, html`<button type="button" class="btn" data-action="open-rules">${icon("bolt", 18)} Gestisci</button>`)}
          ${row("Esporta movimenti", "Per Excel o Fogli Google, con separatore punto e virgola.", html`<button type="button" class="btn" data-action="export-csv">${icon("download", 18)} CSV</button>`)}
          ${row("Categorie", "Nomi, icone e budget mensili.", html`<a class="btn" href="#/budget" data-action="open-categories">${icon("tag", 18)} Gestisci</a>`)}
          <p class="card-foot">${counts.map(([l, n]) => `${n} ${l}`).join(" · ")}</p>
        </section>

        <section class="card span-12 danger-zone" aria-labelledby="h-set-danger">
          ${cardHead("Zona pericolosa", "", "h-set-danger")}
          ${row("Elimina tutti i dati", "Cancella conti, movimenti, investimenti, storico e categorie. Esporta prima un backup: l'operazione non si può annullare.", html`<button type="button" class="btn danger" data-action="wipe">${icon("trash", 18)} Elimina tutto</button>`)}
        </section>
      </div>
      <p class="app-version">Finanza Personale ${APP_VERSION} · ${session.mode === "firebase" ? "Firebase" : "modalità locale"}</p>`;
  },
  onInput(name, value, app, el) {
    if (name === "import-file" && el.files && el.files[0]) {
      const file = el.files[0];
      el.value = "";
      app.importFile(file);
    }
  },
};

// Elenco delle regole automatiche, con modifica e creazione.
export function openRulesManager(app) {
  const rules = sortRules(app.state.rules);
  openSheet({
    title: "Regole automatiche",
    wide: true,
    body: html`<p class="sheet-text">Quando la descrizione di un movimento contiene il testo della regola, la categoria viene proposta da sola: nel modulo di inserimento e nell'importazione degli estratti conto.</p>
      ${rules.length
        ? html`<ul class="list">${rules.map((r) => {
            const c = r.category === "Giroconto" ? { emoji: "🔁" } : categoryFor(r.category, app.state.categories);
            return html`<li><button type="button" class="row" data-action="edit" data-coll="rules" data-id="${r.id}"><span class="avatar emoji" aria-hidden="true">${c.emoji || "🏷️"}</span><span class="row-main"><span class="row-title">contiene “${r.pattern}”</span><span class="row-sub">→ ${r.category}${r.kind && r.kind !== "Tutti" ? ` · solo ${r.kind === "Uscita" ? "uscite" : "entrate"}` : ""}</span></span>${icon("chevronRight", 18)}</button></li>`;
          })}</ul>`
        : emptyState("Nessuna regola", "Creane una qui, oppure spunta “Usa sempre questa categoria” quando registri un movimento.")}`,
    footer: html`<span class="spacer"></span><button type="button" class="btn primary" data-action="add" data-coll="rules">${icon("plus", 18)} Nuova regola</button>`,
  });
}
