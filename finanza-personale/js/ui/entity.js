import { addPeriod } from "../lib/dates.js";
import { fmtEUR, onDate } from "../lib/format.js";
import { categoryId, guessEmoji } from "../domain/categories.js";
import { nameOf } from "../domain/finance.js";
import { dueInstallments, loanAutoPay } from "../domain/loans.js";
import { ruleApplyOps } from "../domain/rules.js";
import { ENTITY_FORMS, deleteButton, fieldHTML, openFormSheet, readFields, refreshAsOfDate } from "./forms.js";
import { confirmDialog } from "./feedback.js";

// Dopo aver salvato una regola, propone di applicarla ai movimenti già registrati.
export async function offerRuleApply(app, rule) {
  const ops = ruleApplyOps(rule, app.state.transactions);
  if (!ops.length) return;
  const ok = await confirmDialog({
    title: "Applicare la regola ai movimenti esistenti?",
    text: `${ops.length === 1 ? "1 movimento già registrato corrisponde" : `${ops.length} movimenti già registrati corrispondono`} a “${rule.pattern}”: passeranno alla categoria ${rule.category}.`,
    confirmLabel: "Applica",
    cancelLabel: "No, solo i prossimi",
  });
  if (ok) app.commitWithUndo(ops, ops.length === 1 ? "Categoria aggiornata" : `${ops.length} movimenti ricategorizzati`);
}

function references(app, coll, doc) {
  const s = app.state;
  if (coll === "accounts") {
    const tx = s.transactions.filter((t) => t.accountId === doc.id || t.fromAccountId === doc.id || t.toAccountId === doc.id).length;
    const other = s.schedules.filter((x) => x.payWith === `account:${doc.id}` || x.fromAccountId === doc.id || x.toAccountId === doc.id).length + s.pac.filter((p) => p.accountId === doc.id).length;
    return tx || other ? `${tx} movimenti e ${other} tra operazioni programmate e piani fanno riferimento a questo conto: resteranno senza conto.` : "";
  }
  if (coll === "creditCards") {
    const tx = s.transactions.filter((t) => t.cardId === doc.id || t.fromCardId === doc.id || t.toCardId === doc.id || t.cardPaymentFor === doc.id).length;
    const sch = s.schedules.filter((x) => x.payWith === `card:${doc.id}`).length;
    return tx || sch ? `${tx} movimenti e ${sch} operazioni programmate usano questa carta: resteranno senza carta.` : "";
  }
  if (["etf", "stocks", "crypto"].includes(coll)) {
    const plans = s.pac.filter((p) => p.asset === `${coll}:${doc.id}`).map((p) => p.name);
    return plans.length ? `I piani di accumulo ${plans.join(", ")} resteranno senza strumento.` : "";
  }
  if (coll === "categories") {
    const n = s.transactions.filter((t) => t.category === doc.name).length;
    return n ? `${n} movimenti usano questa categoria e manterranno il nome.` : "";
  }
  return "";
}

export function openEntityForm(app, coll, id = null, presets = {}) {
  const spec = ENTITY_FORMS[coll];
  if (!spec) return null;
  const existing = id ? app.store.find(coll, id) : null;
  if (id && !existing) return null;
  const values = existing ? { ...existing } : { ...spec.defaults(app.today, (d) => addPeriod(d, "Mensile")), ...presets };
  return openFormSheet({
    title: spec.titles[existing ? 1 : 0],
    fieldsHTML: spec.fields.map((f) => fieldHTML(f, values[f.key], app.state)),
    extraFooter: existing ? deleteButton() : "",
    onSubmit: async (form) => {
      const res = readFields(form, spec.fields);
      if (res.error) return res;
      let data = res.data;
      const ops = [];
      if (coll === "categories") {
        const clash = app.state.categories.find((c) => c.name.toLowerCase() === data.name.toLowerCase() && (!existing || c.id !== existing.id));
        if (clash) return { error: "Esiste già una categoria con questo nome.", field: "name" };
        if (!data.emoji) data.emoji = guessEmoji(data.name);
        // Rinominando una categoria si aggiornano anche i movimenti e le programmazioni che la usano.
        if (existing && existing.name !== data.name) {
          for (const t of app.state.transactions) if (t.category === existing.name) ops.push({ op: "update", coll: "transactions", id: t.id, data: { category: data.name } });
          for (const x of app.state.schedules) if (x.category === existing.name) ops.push({ op: "update", coll: "schedules", id: x.id, data: { category: data.name } });
        }
      }
      if (coll === "pac" && !data.asset) return { error: "Scegli lo strumento del piano.", field: "asset" };
      if (coll === "rules") {
        if (data.pattern.length < 2) return { error: "Scrivi almeno due caratteri.", field: "pattern" };
        if (!data.category) return { error: "Scegli la categoria.", field: "category" };
        setTimeout(() => offerRuleApply(app, data), 60);
      }
      if (coll === "goals" && !(data.target > 0)) return { error: "L'obiettivo deve essere maggiore di zero.", field: "target" };
      if (coll === "loans") {
        if (data.nextDate && !data.accountId) return { error: "Scegli il conto da cui parte la rata, oppure lascia vuota la prossima rata.", field: "accountId" };
        if (data.nextDate && !(data.monthlyPayment > 0)) return { error: "Indica la rata mensile da addebitare.", field: "monthlyPayment" };
        // Il giorno dell'addebito è quello della data scelta (una rata del 31 resta a fine mese).
        if (data.nextDate !== ((existing && existing.nextDate) || "")) data.payDay = data.nextDate ? Number(data.nextDate.slice(8, 10)) : 0;
        const merged = { ...(existing || {}), ...data };
        const due = loanAutoPay(merged) ? dueInstallments(merged, app.today) : null;
        if (due && due.items.some((it) => it.date < app.today)) {
          const n = due.items.length;
          const ok = await confirmDialog({
            title: "Registrare le rate già scadute?",
            text: `${n === 1 ? `La rata ${onDate("di", due.items[0].date)} verrà registrata subito` : `Verranno registrate subito ${n} rate, ${onDate("da", due.items[0].date)} a oggi,`} su ${nameOf(app.state.accounts, data.accountId)} e il debito residuo scenderà a ${fmtEUR(due.remaining)}.`,
            confirmLabel: "Registra",
          });
          if (!ok) return { error: "Scegli una data della prossima rata da oggi in poi, oppure conferma le rate già scadute.", field: "nextDate" };
        }
      }
      if (existing) {
        data = refreshAsOfDate(coll, existing, data, app.today);
        ops.unshift({ op: "update", coll, id: existing.id, data });
      } else {
        const newId = coll === "categories" ? categoryId(data.name) : app.newId();
        if (coll === "categories" && app.store.find("categories", newId)) return { error: "Esiste già una categoria con questo nome.", field: "name" };
        ops.unshift({ op: "set", coll, id: newId, data: { ...data, ...(coll === "categories" ? { order: 900 } : {}), createdAt: Date.now() } });
      }
      app.commitWithUndo(ops, existing ? "Modifiche salvate" : "Elemento aggiunto");
      return true;
    },
    onReady: (form, dlg) => {
      // Nuova categoria: finché non si sceglie un'icona, si propone quella che si addice al nome.
      const picker = form.querySelector("[data-emoji-field]");
      const nameInput = form.elements.namedItem("name");
      if (coll === "categories" && !existing && picker && picker._picker && nameInput) {
        nameInput.addEventListener("input", () => picker._picker.suggest(guessEmoji(nameInput.value.trim())));
      }
      const del = dlg.querySelector("[data-delete]");
      if (!del) return;
      del.addEventListener("click", async () => {
        const warn = references(app, coll, existing);
        const ok = await confirmDialog({
          title: `Eliminare ${existing.name ? `"${existing.name}"` : "questo elemento"}?`,
          text: warn || "Potrai annullare subito dopo dalla notifica.",
          confirmLabel: "Elimina",
          danger: true,
        });
        if (!ok) return;
        dlg.close();
        app.commitWithUndo([{ op: "delete", coll, id: existing.id }], "Elemento eliminato");
      });
    },
  });
}

