// Dati di fantasia per la demo pubblica di Patrimonio. Nessun dato reale.
import { addDays, addMonths, todayStr } from "./lib/dates.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (n) => Math.round(n * 100) / 100;

export function buildDemoData(today = todayStr()) {
  const rnd = rng(20271);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => r2(a + rnd() * (b - a));
  const start = addDays(today, -150);

  const accounts = {
    a1: { name: "Conto principale", bank: "Banca Esempio", type: "Conto corrente", balance: 2850, balanceDate: start, iban: "IT60X0542811101000000123456" },
    a2: { name: "Conto risparmio", bank: "Banca Esempio", type: "Conto deposito", balance: 7600, balanceDate: start },
    a3: { name: "Contanti", type: "Contanti", balance: 90, balanceDate: start },
  };
  const creditCards = {
    c1: { name: "Carta di credito", bank: "Banca Esempio", limit: 1500, spent: 0, spentDate: start, accountId: "a1" },
  };
  const loans = {
    l1: { name: "Finanziamento auto", remaining: 7400, monthlyPayment: 235, tan: 5.4, accountId: "a1", nextDate: addMonths(today.slice(0, 8) + "10", today.slice(8) > "10" ? 1 : 0), payDay: 10 },
  };
  const categories = {};
  const cat = (id, name, kind, budget, emoji) => { categories[id] = { name, kind, ...(budget ? { budget } : {}), emoji }; };
  cat("cat-stipendio", "Stipendio", "Entrata", 0, "💼");
  cat("cat-altre-entrate", "Altre entrate", "Entrata", 0, "💶");
  cat("cat-casa", "Casa", "Uscita", 700, "🏠");
  cat("cat-spesa", "Spesa", "Uscita", 380, "🛒");
  cat("cat-trasporti", "Trasporti", "Uscita", 130, "⛽");
  cat("cat-ristoranti", "Ristoranti", "Uscita", 140, "🍝");
  cat("cat-svago", "Svago", "Uscita", 90, "🎬");
  cat("cat-abbonamenti", "Abbonamenti", "Uscita", 60, "📺");
  cat("cat-salute", "Salute", "Uscita", 70, "💊");
  cat("cat-shopping", "Shopping", "Uscita", 110, "🛍️");
  cat("cat-viaggi", "Viaggi", "Uscita", 120, "✈️");
  cat("cat-finanziamenti", "Finanziamenti", "Uscita", 0, "🚗");

  const transactions = {};
  let n = 0;
  const add = (date, kind, category, amount, description, extra = {}) => {
    if (date > today || date < start) return;
    transactions[`demo-${++n}`] = { date, kind, category, amount: r2(Math.abs(amount)), description, source: "manuale", createdAt: n, ...extra };
  };
  const month0 = addMonths(today.slice(0, 7) + "-01", -5);
  for (let m = 0; m <= 5; m++) {
    const first = addMonths(month0, m);
    const ym = first.slice(0, 7);
    const day = (d) => `${ym}-${String(d).padStart(2, "0")}`;
    add(day(27), "Entrata", "Stipendio", 2150, "Stipendio", { accountId: "a1" });
    add(day(5), "Uscita", "Casa", 620, "Affitto", { accountId: "a1" });
    add(day(8), "Uscita", "Casa", between(60, 115), "Bollette luce e gas", { accountId: "a1" });
    add(day(10), "Uscita", "Finanziamenti", 235, "Rata auto", { accountId: "a1", loanId: "l1" });
    add(day(12), "Giroconto", "Giroconto", 250, "Versamento risparmio", { fromAccountId: "a1", toAccountId: "a2" });
    add(day(3), "Uscita", "Abbonamenti", 12.99, "Streaming video", { cardId: "c1" });
    add(day(15), "Uscita", "Abbonamenti", 10.99, "Musica in streaming", { cardId: "c1" });
    add(day(20), "Uscita", "Abbonamenti", 29.9, "Palestra", { cardId: "c1" });
    for (let w = 0; w < 5; w++) add(day(2 + w * 6), "Uscita", "Spesa", between(32, 96), pick(["Supermercato", "Alimentari", "Mercato", "Supermercato"]), { accountId: "a1" });
    for (let k = 0; k < 2; k++) add(day(6 + k * 13), "Uscita", "Trasporti", between(38, 62), "Carburante", { cardId: "c1" });
    for (let k = 0; k < 3; k++) add(day(4 + k * 9 + Math.floor(rnd() * 3)), "Uscita", "Ristoranti", between(18, 58), pick(["Pizzeria", "Ristorante", "Pranzo fuori", "Aperitivo"]), { cardId: "c1" });
    if (rnd() > 0.35) add(day(14 + Math.floor(rnd() * 10)), "Uscita", "Svago", between(15, 55), pick(["Cinema", "Concerto", "Libri"]), { cardId: "c1" });
    if (rnd() > 0.5) add(day(10 + Math.floor(rnd() * 15)), "Uscita", "Salute", between(20, 80), "Farmacia", { accountId: "a1" });
    if (rnd() > 0.45) add(day(8 + Math.floor(rnd() * 18)), "Uscita", "Shopping", between(30, 140), pick(["Abbigliamento", "Casa e arredo", "Elettronica"]), { cardId: "c1" });
    if (m === 2) add(day(21), "Uscita", "Viaggi", 310, "Weekend fuori porta", { cardId: "c1" });
    if (m === 4) add(day(12), "Entrata", "Altre entrate", 180, "Vendita usato", { accountId: "a1" });
  }

  // La carta viene saldata ogni mese dal conto principale con l'importo speso nel mese precedente.
  const cardByMonth = {};
  for (const t of Object.values(transactions)) {
    if (t.cardId === "c1" && t.kind === "Uscita") cardByMonth[t.date.slice(0, 7)] = (cardByMonth[t.date.slice(0, 7)] || 0) + t.amount;
  }
  for (const [ym, tot] of Object.entries(cardByMonth)) {
    const pay = addMonths(ym + "-01", 1).slice(0, 7) + "-02";
    add(pay, "Giroconto", "Giroconto", tot, "Saldo carta di credito", { fromAccountId: "a1", toCardId: "c1" });
  }

  const nextOf = (dayOfMonth) => {
    const d = `${today.slice(0, 7)}-${String(dayOfMonth).padStart(2, "0")}`;
    return d > today ? d : addMonths(d, 1);
  };
  const schedules = {
    s1: { type: "income", amount: 2150, category: "Stipendio", description: "Stipendio", payWith: "account:a1", frequency: "Mensile", startDate: nextOf(27), done: 0, status: "Attivo", endMode: "Nessuna fine" },
    s2: { type: "expense", amount: 620, category: "Casa", description: "Affitto", payWith: "account:a1", frequency: "Mensile", startDate: nextOf(5), done: 0, status: "Attivo", endMode: "Nessuna fine" },
    s3: { type: "expense", amount: 12.99, category: "Abbonamenti", description: "Streaming video", payWith: "card:c1", frequency: "Mensile", startDate: nextOf(3), done: 0, status: "Attivo", endMode: "Nessuna fine" },
    s4: { type: "transfer", amount: 250, category: "Giroconto", description: "Versamento risparmio", fromAccountId: "a1", toAccountId: "a2", frequency: "Mensile", startDate: nextOf(12), done: 0, status: "Attivo", endMode: "Nessuna fine" },
  };

  const etf = {
    e1: { name: "ETF azionario mondiale", isin: "IE00B4L5Y983", ticker: "SWDA", quantity: 38, avgPrice: 79.4, currentPrice: 97.1 },
    e2: { name: "ETF mercati emergenti", isin: "IE00BKM4GZ66", ticker: "EIMI", quantity: 55, avgPrice: 29.8, currentPrice: 33.6 },
  };
  const stocks = { s1: { name: "Azienda tecnologica", ticker: "TECH", isin: "US0000000001", quantity: 6, avgPrice: 142, currentPrice: 211 } };
  const crypto = { b1: { name: "Bitcoin", ticker: "BTC", quantity: 0.04, avgPrice: 41000, currentPrice: 66800 } };
  const goals = {
    g1: { name: "Viaggio in Giappone", target: 3000, saved: 1450, targetDate: addMonths(today.slice(0, 7) + "-01", 4).slice(0, 7), emoji: "🗾" },
    g2: { name: "Fondo di emergenza", target: 9000, accountId: "a2", targetDate: addMonths(today.slice(0, 7) + "-01", 12).slice(0, 7), emoji: "🛟" },
  };

  // Storico del patrimonio: un'istantanea a settimana, con valori coerenti con quelli attuali.
  const history = {};
  const weeks = 21;
  for (let i = weeks; i >= 0; i--) {
    const date = addDays(today, -i * 7);
    history[date] = {
      date,
      liquidity: r2(13350 - i * 193 + Math.sin(i) * 90),
      etfValue: r2(5540 * (1 - i * 0.004) + Math.cos(i) * 110),
      stocksValue: r2(1266 * (1 - i * 0.005) + Math.sin(i * 1.3) * 40),
      cryptoValue: r2(2672 * (1 - i * 0.008) + Math.cos(i * 0.8) * 120),
      cardsDebt: r2(160 + Math.abs(Math.sin(i)) * 140),
      loansDebt: r2(7400 + i * 235 / 4.3),
    };
  }

  return { accounts, creditCards, loans, transactions, schedules, etf, stocks, crypto, pac: {}, history, categories, rules: {}, goals, annual: {}, settings: { prefs: {} } };
}
