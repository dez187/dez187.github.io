import { round } from "../lib/format.js";

// Aggiornamento prezzi dal browser, con fonti pubbliche che consentono richieste da altri siti (CORS):
// - ETF e azioni: onvista (ricerca per ISIN, quotazione in euro sulla borsa preferita)
// - crypto: Coinbase (prezzo spot in euro), CoinGecko come riserva

const ONVISTA = "https://api.onvista.de/api/v1";
const PREF_DEFAULT = ["_GER", "_GAT", "_LSX", "_TRO", "_STU", "_FRA", "_MUN", "_MIL", "_AMS", "_QUO"];
const PREF_ITALY = ["_LST", "_MIL", "_GER", "_GAT", "_LSX", "_TRO", "_STU", "_FRA"];
const FRESH_WINDOW_MS = 4 * 86400000;

async function getJson(fetchImpl, url, timeoutMs = 12000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { signal: ctrl?.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Sceglie la quotazione in euro più adatta: borse preferite prima, scartando quelle vecchie di giorni.
export function pickEurQuote(snapshot, isin) {
  const list = ((snapshot && snapshot.quoteList && snapshot.quoteList.list) || []).filter((q) => q && q.isoCurrency === "EUR" && Number(q.last) > 0);
  const main = snapshot && snapshot.quote;
  if (main && main.isoCurrency === "EUR" && Number(main.last) > 0) list.push(main);
  if (!list.length) return null;
  const time = (q) => Date.parse(q.datetimeLast || "") || 0;
  const newest = Math.max(...list.map(time));
  const fresh = list.filter((q) => newest - time(q) <= FRESH_WINDOW_MS);
  const pref = String(isin || "").toUpperCase().startsWith("IT") ? PREF_ITALY : PREF_DEFAULT;
  const rank = (q) => {
    const i = pref.indexOf(q.market && q.market.codeMarket);
    return i === -1 ? pref.length : i;
  };
  fresh.sort((a, b) => rank(a) - rank(b) || time(b) - time(a));
  const q = fresh[0];
  return {
    price: Number(q.last),
    venue: (q.market && (q.market.name || q.market.codeMarket)) || "",
    date: (q.datetimeLast || "").slice(0, 10),
  };
}

export async function fetchSecurityPrice(h, fetchImpl) {
  const isin = String(h.isin || "").trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) throw new Error("ISIN mancante o non valido");
  const cached = h.onvistaRef && h.onvistaIsin === isin;
  let ref = cached ? h.onvistaRef : null;
  let foundIsin = cached ? h.onvistaFoundIsin || isin : isin;
  if (!ref) {
    const res = await getJson(fetchImpl, `${ONVISTA}/instruments/query?searchValue=${encodeURIComponent(isin)}`);
    const list = (res.list || []).filter((x) => x && x.entityType && x.entityValue);
    // Un solo risultato con ISIN diverso: di solito il titolo ha cambiato ISIN (operazione societaria).
    const it = list.find((x) => x.isin === isin) || (list.length === 1 ? list[0] : null);
    if (!it) throw new Error("Strumento non trovato");
    ref = `${it.entityType}/${it.entityValue}`;
    foundIsin = it.isin || isin;
  }
  const snap = await getJson(fetchImpl, `${ONVISTA}/instruments/${ref}/snapshot`);
  const q = pickEurQuote(snap, isin);
  if (!q) throw new Error("Nessuna quotazione in euro");
  return { ...q, source: "onvista", ref, isin, foundIsin };
}

export function cryptoSymbol(h) {
  if (h.symbol) return String(h.symbol).trim().toUpperCase() || null;
  const parts = String(h.name || "").split("/").map((s) => s.trim()).filter(Boolean);
  const cand = parts.length ? parts[parts.length - 1] : "";
  return /^[A-Za-z0-9]{2,12}$/.test(cand) ? cand.toUpperCase() : null;
}

export async function fetchCryptoPrice(h, fetchImpl, today) {
  const symbol = cryptoSymbol(h);
  if (!symbol) throw new Error("Simbolo mancante (es. BTC)");
  try {
    const j = await getJson(fetchImpl, `https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol)}-EUR/spot`);
    const p = Number(j && j.data && j.data.amount);
    if (p > 0) return { price: p, venue: "Coinbase", date: today, source: "coinbase", symbol };
  } catch (e) {
    // si prova la fonte di riserva
  }
  const s = await getJson(fetchImpl, `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`);
  const coin = (s.coins || []).find((c) => String(c.symbol).toUpperCase() === symbol);
  if (!coin) throw new Error("Crypto non trovata");
  const p = await getJson(fetchImpl, `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin.id)}&vs_currencies=eur`);
  const price = Number(p && p[coin.id] && p[coin.id].eur);
  if (!(price > 0)) throw new Error("Prezzo non disponibile");
  return { price, venue: "CoinGecko", date: today, source: "coingecko", symbol };
}

export const roundPrice = (p) => (p >= 1 ? round(p, 4) : round(p, 8));

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return out;
}

// Restituisce le scritture da applicare e l'esito per ogni posizione (le variazioni oltre il 40% vengono segnalate).
export async function refreshPrices(state, { fetchImpl, today, onProgress, concurrency = 4 } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const jobs = [];
  for (const coll of ["etf", "stocks"]) for (const h of state[coll] || []) jobs.push({ coll, h });
  for (const h of state.crypto || []) jobs.push({ coll: "crypto", h });
  let done = 0;
  const results = await pool(jobs, concurrency, async ({ coll, h }) => {
    const base = { coll, id: h.id, name: h.name || "senza nome", oldPrice: Number(h.currentPrice) || 0 };
    try {
      const q = coll === "crypto" ? await fetchCryptoPrice(h, f, today) : await fetchSecurityPrice(h, f);
      const price = roundPrice(q.price);
      const change = base.oldPrice > 0 ? (price - base.oldPrice) / base.oldPrice : null;
      const data = { currentPrice: price, priceDate: q.date || today, priceSource: q.venue ? `${q.source} · ${q.venue}` : q.source };
      if (q.ref) Object.assign(data, { onvistaRef: q.ref, onvistaIsin: q.isin, onvistaFoundIsin: q.foundIsin });
      const note = q.foundIsin && q.foundIsin !== q.isin ? `ISIN su onvista: ${q.foundIsin}` : "";
      return { ...base, ok: true, price, venue: q.venue, change, bigMove: change != null && Math.abs(change) > 0.4, note, data };
    } catch (e) {
      return { ...base, ok: false, error: e && e.name === "AbortError" ? "Tempo scaduto" : (e && e.message) || "Errore" };
    } finally {
      done++;
      if (onProgress) onProgress(done, jobs.length);
    }
  });
  const ops = results.filter((r) => r.ok).map((r) => ({ op: "update", coll: r.coll, id: r.id, data: r.data }));
  return { ops, results };
}
