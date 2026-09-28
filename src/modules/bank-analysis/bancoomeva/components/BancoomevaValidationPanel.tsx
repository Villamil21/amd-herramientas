import { Alert } from "../../../../components/ui";
import { formatMoneyCents } from "../../../../utils/format";
import { RECONCILIATION_WARNING } from "../services/validation";
import type { BancoomevaStatement, BancoomevaValidation } from "../types";

const MAX_LISTED = 8;

export function BancoomevaValidationPanel({ statement, validation }: { statement: BancoomevaStatement; validation: BancoomevaValidation }) {
  const { totals, pageCount } = statement;
  const failed = validation.checks.filter((c) => c.status === "failed");
  const unavailable = validation.checks.filter((c) => c.status === "unavailable");
  const pages = `${pageCount} ${pageCount === 1 ? "página" : "páginas"}`;
  const balances = totals.openingBalanceCents !== undefined && totals.closingBalanceCents !== undefined && (
    <>
      {" "}
      Saldo inicial {formatMoneyCents(totals.openingBalanceCents)} · saldo final {formatMoneyCents(totals.closingBalanceCents)}.
    </>
  );

  if (validation.validated) {
    const notes = unavailable.map((c) => `No fue posible comprobar: ${c.label}. ${c.detail ?? ""}`);
    return (
      <Alert tone="success" title="Extracto validado" items={notes}>
        Se revisaron {pages}. Los débitos y créditos coinciden con TOTAL DEBITO y TOTAL CREDITO, la secuencia de saldos cuadra y saldo inicial + créditos − débitos
        coincide con el saldo final.{balances}
      </Alert>
    );
  }

  const items = [
    ...failed.filter((c) => c.id !== "issues" && c.id !== "anomalies").map((c) => `${c.label}: ${c.detail ?? "no coincide."}`),
    ...statement.anomalies.slice(0, MAX_LISTED).map(
      (a) => `Página ${a.page}, ${a.date}: «${a.description}» tiene débito ${formatMoneyCents(a.debitCents)} y crédito ${formatMoneyCents(a.creditCents)}; no se clasificó ni se sumó.`,
    ),
    ...statement.issues.slice(0, MAX_LISTED).map((i) => `Página ${i.page}: «${i.text}». ${i.reason}`),
    ...unavailable.map((c) => `${c.label}: ${c.detail ?? "no disponible."}`),
  ];
  const hidden = Math.max(0, statement.anomalies.length - MAX_LISTED) + Math.max(0, statement.issues.length - MAX_LISTED);
  if (hidden > 0) items.push(`… y ${hidden} fila(s) más por revisar.`);

  const title =
    statement.anomalies.length > 0
      ? "Hay filas con valor en VALOR DEBITO y VALOR CREDITO a la vez. Revísalas antes de usar el resultado."
      : statement.issues.length > 0
        ? "Se encontraron filas cuyo contenido no pudo interpretarse."
        : failed.some((c) => ["debits", "credits", "reconciliation", "balances"].includes(c.id))
          ? RECONCILIATION_WARNING
          : "No fue posible validar el análisis contra los totales del extracto.";

  return (
    <Alert tone="warning" title={title} items={items}>
      Los datos no se modificaron y el análisis no se considera validado. Revisa los grupos y sus movimientos.{balances}
    </Alert>
  );
}
