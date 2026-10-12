import { esc, html } from "../lib/html.js";
import { icon } from "../lib/icons.js";

// ---------- notifiche brevi (con eventuale "Annulla") ----------
export function toast(message, { action, onAction, type = "info", timeout = 5000 } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return () => {};
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  el.appendChild(text);
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("out");
    setTimeout(() => el.remove(), 180);
  };
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = action;
    b.addEventListener("click", () => {
      close();
      if (onAction) onAction();
    });
    el.appendChild(b);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "toast-close";
  x.setAttribute("aria-label", "Chiudi notifica");
  x.innerHTML = String(icon("x", 16));
  x.addEventListener("click", close);
  el.appendChild(x);
  host.appendChild(el);
  if (timeout) timer = setTimeout(close, timeout);
  return close;
}

// ---------- finestre modali (dialog nativo: focus intrappolato, Esc per chiudere) ----------
let seq = 0;
export function openSheet({ title, body, footer, wide = false, closeOnBackdrop = true, onClose }) {
  const dlg = document.createElement("dialog");
  const titleId = `sheet-title-${++seq}`;
  dlg.className = "sheet" + (wide ? " wide" : "");
  dlg.setAttribute("aria-labelledby", titleId);
  dlg.innerHTML = String(html`
    <div class="sheet-head">
      <h2 id="${titleId}">${title}</h2>
      <button type="button" class="icon-btn" data-sheet-close aria-label="Chiudi">${icon("x")}</button>
    </div>
    <div class="sheet-body">${body || ""}</div>
    ${footer ? html`<div class="sheet-foot">${footer}</div>` : ""}`);
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => {
    dlg.remove();
    if (onClose) onClose();
  });
  dlg.addEventListener("click", (e) => {
    if (e.target.closest("[data-sheet-close]")) dlg.close();
    else if (closeOnBackdrop && e.target === dlg) dlg.close();
  });
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, text, confirmLabel = "Conferma", cancelLabel = "Annulla", danger = false, requireText = "" }) {
  return new Promise((resolve) => {
    let answered = false;
    const dlg = openSheet({
      title,
      body: html`<p class="sheet-text">${text}</p>${requireText ? html`<label class="field"><span>Per confermare scrivi <strong>${requireText}</strong></span><input class="input" data-require autocomplete="off" spellcheck="false"></label>` : ""}`,
      footer: html`<button type="button" class="btn" data-sheet-close>${cancelLabel}</button><button type="button" class="btn ${danger ? "danger" : "primary"}" data-ok${requireText ? " disabled" : ""}>${confirmLabel}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    const ok = dlg.querySelector("[data-ok]");
    const req = dlg.querySelector("[data-require]");
    if (req) {
      req.addEventListener("input", () => { ok.disabled = req.value.trim() !== requireText; });
      req.focus();
    } else {
      ok.focus();
    }
    ok.addEventListener("click", () => {
      answered = true;
      resolve(true);
      dlg.close();
    });
  });
}

export function alertDialog(title, text) {
  return new Promise((resolve) => {
    const dlg = openSheet({
      title,
      body: html`<p class="sheet-text">${text}</p>`,
      footer: html`<button type="button" class="btn primary" data-sheet-close>Ok</button>`,
      onClose: () => resolve(),
    });
    dlg.querySelector(".sheet-foot .btn").focus();
  });
}

export const escText = esc;
