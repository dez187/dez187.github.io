import { toNum } from "../lib/format.js";

// Obiettivi di risparmio: il progresso viene dal saldo del conto collegato oppure, se non c'è,
// dall'importo messo da parte inserito a mano.
export function goalProgress(goal, totals, today) {
  const target = toNum(goal.target);
  const linked = !!goal.accountId && totals.balances.has(goal.accountId);
  const current = linked ? totals.balances.get(goal.accountId) : toNum(goal.saved);
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.max(0, (current / target) * 100) : 0;
  let monthsLeft = null, perMonth = null;
  if (/^\d{4}-\d{2}$/.test(goal.targetDate || "")) {
    const [ty, tm] = goal.targetDate.split("-").map(Number);
    const [y, m] = today.split("-").map(Number);
    monthsLeft = (ty - y) * 12 + (tm - m);
    if (remaining > 0.004) perMonth = monthsLeft > 0 ? remaining / monthsLeft : remaining;
  }
  const status = target > 0 && remaining <= 0.004 ? "done" : monthsLeft != null && monthsLeft < 0 ? "late" : "open";
  return { current, target, remaining, pct, monthsLeft, perMonth, linked, status };
}

export function sortGoals(goals, totals, today) {
  return [...goals]
    .map((g) => ({ goal: g, p: goalProgress(g, totals, today) }))
    .sort((a, b) => (a.p.status === "done") - (b.p.status === "done") || String(a.goal.targetDate || "9999").localeCompare(String(b.goal.targetDate || "9999")) || String(a.goal.name || "").localeCompare(String(b.goal.name || ""), "it"));
}
