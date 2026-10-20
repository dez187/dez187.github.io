import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { fmtEUR, fmtSigned, toNum, MINUS } from "../lib/format.js";
import { ACCOUNT_GROUPS, accountGroup, groupAccounts, txRoute, txTone } from "../domain/finance.js";
import { categoryFor } from "../domain/categories.js";

export function amountText(t) {
  const a = Math.abs(toNum(t.amount));
  if (t.kind === "Entrata") return "+" + fmtEUR(a);
  if (t.kind === "Giroconto") return fmtEUR(a);
  return MINUS + fmtEUR(a);
}

export function txAmount(t) {
  return html`<span class="amount ${txTone(t)}">${amountText(t)}</span>`;
}

export function balanceText(v) {
  return html`<span class="amount${toNum(v) < -0.004 ? " neg" : ""}">${fmtEUR(v)}</span>`;
}

export function signedText(v) {
  const n = toNum(v);
  return html`<span class="amount ${n > 0.004 ? "pos" : n < -0.004 ? "neg" : "muted"}">${fmtSigned(n)}</span>`;
}

export function categoryAvatar(name, categories, kind) {
  if (kind === "Giroconto") return html`<span class="avatar tone-neutral" aria-hidden="true">${icon("transfer", 18)}</span>`;
  const c = categoryFor(name, categories);
  return html`<span class="avatar emoji" aria-hidden="true">${c.emoji || "🏷️"}</span>`;
}

const TYPE_TONE = { "Conto corrente": "blue", "Conto deposito": "aqua", "Contanti": "yellow", "Carta prepagata": "violet" };

export function accountAvatar(a) {
  const g = accountGroup(a.type);
  return html`<span class="avatar sq tone-${TYPE_TONE[a.type] || "neutral"}" aria-hidden="true">${icon(g.icon, 18)}</span>`;
}

export function iconAvatar(name, tone = "neutral") {
  return html`<span class="avatar sq tone-${tone}" aria-hidden="true">${icon(name, 18)}</span>`;
}

export function meter(pct, status = "ok", label = "") {
  const width = Math.max(0, Math.min(100, toNum(pct)));
  return html`<span class="meter meter-${status}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(toNum(pct))}"${label ? html` aria-label="${label}"` : ""}><span style="width:${width.toFixed(1)}%"></span></span>`;
}

export function badge(text, variant = "") {
  return html`<span class="badge${variant ? " " + variant : ""}">${text}</span>`;
}

export function emptyState(title, text, action) {
  return html`<div class="empty"><p class="empty-title">${title}</p>${text ? html`<p>${text}</p>` : ""}${action || ""}</div>`;
}

// Riga di un movimento: icona categoria, descrizione, dove, importo.
export function txRow(t, state, { showDate = false, fmtDate } = {}) {
  const route = txRoute(t, state);
  // Persona e viaggio vanno nella seconda riga: nel titolo, su un telefono, coprirebbero la descrizione.
  const person = t.kind === "Uscita" || t.kind === "Entrata" ? String(t.person || "").trim() : "";
  const who = person ? (t.kind === "Entrata" ? `da ${person}` : Number(t.owed) > 0 ? `${person} ti deve ${fmtEUR(Number(t.owed))}` : `con ${person}`) : "";
  const trip = t.kind === "Giroconto" ? "" : String(t.tag || "").trim();
  const sub = [t.kind === "Giroconto" ? "Giroconto" : t.category || "Altro", who, trip, route].filter(Boolean).join(" · ");
  const tags = [];
  if (t.scheduleId) tags.push(badge("ricorrente", "subtle"));
  if (t.pacId) tags.push(badge("PAC", "subtle"));
  if (t.cardPaymentFor) tags.push(badge("addebito carta", "subtle"));
  return html`<button type="button" class="row tx-row" data-action="edit-tx" data-id="${t.id}">
    ${categoryAvatar(t.category, state.categories, t.kind)}
    <span class="row-main"><span class="row-title"><span class="clip">${t.description || "Senza descrizione"}</span>${tags}</span><span class="row-sub">${sub}</span></span>
    ${showDate && fmtDate ? html`<span class="row-end">${txAmount(t)}<span class="row-note">${fmtDate(t.date)}</span></span>` : txAmount(t)}
  </button>`;
}

// Opzioni dei conti raggruppate per tipo (conti correnti, conti deposito, ...), con eventuali carte.
export function accountOptions(state, value, { prefix = "", cards = false, exclude = "" } = {}) {
  const groups = groupAccounts(state.accounts || []).map(
    (g) => html`<optgroup label="${g.label}">${g.rows.filter((a) => a.id !== exclude).map((a) => html`<option value="${prefix + a.id}"${raw(prefix + a.id === value ? " selected" : "")}>${a.name || "senza nome"}</option>`)}</optgroup>`
  );
  if (cards && (state.creditCards || []).length) {
    groups.push(html`<optgroup label="Carte di credito">${state.creditCards.map((c) => html`<option value="card:${c.id}"${raw("card:" + c.id === value ? " selected" : "")}>${c.name || "senza nome"}</option>`)}</optgroup>`);
  }
  return groups;
}

export function assetOptions(state, value) {
  const groups = [["etf", "ETF"], ["stocks", "Azioni"], ["crypto", "Crypto"]];
  return groups.filter(([k]) => (state[k] || []).length).map(
    ([k, label]) => html`<optgroup label="${label}">${state[k].map((h) => html`<option value="${k}:${h.id}"${raw(`${k}:${h.id}` === value ? " selected" : "")}>${h.name || "senza nome"}</option>`)}</optgroup>`
  );
}

export function categoryOptions(categories, kind, value) {
  const list = categories.filter((c) => (kind === "Entrata" ? c.kind === "Entrata" : c.kind !== "Entrata"));
  const known = list.some((c) => c.name === value);
  return html`${list.map((c) => html`<option value="${c.name}"${raw(c.name === value ? " selected" : "")}>${c.emoji ? c.emoji + " " : ""}${c.name}</option>`)}${value && !known ? html`<option value="${value}" selected>${value}</option>` : ""}<option value="__new__">＋ Nuova categoria…</option>`;
}

export const ACCOUNT_GROUP_LABELS = ACCOUNT_GROUPS.map((g) => g.label);
