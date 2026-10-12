// Avvio della demo pubblica: nessun accesso, nessun Firebase, dati di fantasia salvati solo nel browser.
import { createLocalBackend } from "./data/backend-local.js";
import { startApp } from "./app.js";
import { buildDemoData } from "./demo-seed.js";
import { todayStr } from "./lib/dates.js";

const KEY = "patrimonio:demo:v2";
const root = document.getElementById("root");

function seed(force) {
  const today = todayStr();
  let have = null;
  try { have = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
  if (!force && have && have.seededOn === today && have.collections) return;
  // Una sola volta al giorno i dati si riallineano alla data di oggi, così la demo resta "viva".
  const data = buildDemoData(today);
  const collections = {};
  for (const [coll, docs] of Object.entries(data)) collections[coll] = docs;
  try { localStorage.setItem(KEY, JSON.stringify({ seededOn: today, collections })); } catch {}
}

function banner() {
  const b = document.createElement("div");
  b.setAttribute("role", "note");
  b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:8px 14px;background:#0b0b0b;color:#ffd60a;font:600 13px/1.3 system-ui,sans-serif;border-top:3px solid #ffd60a";
  b.innerHTML = '<span>Demo con dati di fantasia: nulla di ciò che inserisci lascia questo browser.</span><button type="button" id="demo-reset" style="background:#ffd60a;color:#0b0b0b;border:0;border-radius:8px;padding:5px 10px;font:700 12px system-ui;cursor:pointer">Ripristina i dati</button><a href="../" style="color:#fff">← Progetti</a>';
  document.body.appendChild(b);
  document.getElementById("demo-reset").addEventListener("click", () => { seed(true); location.reload(); });
}

// Demo senza rete: niente aggiornamento dei prezzi reali.
window.fetch = () => Promise.reject(new Error("Demo: nessuna connessione a servizi esterni"));
seed(false);
root.innerHTML = "";
startApp({
  backend: createLocalBackend(KEY),
  session: { mode: "local", name: "Demo", firstName: "Demo", email: "", photo: "" },
  installer: { available: () => false, async prompt() {} },
  onLeaveLocal: () => { seed(true); location.reload(); },
});
banner();
