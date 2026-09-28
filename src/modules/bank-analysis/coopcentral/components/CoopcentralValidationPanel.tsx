import { Alert } from "../../../../components/ui";
import { formatMoneyCents } from "../../../../utils/format";
import { RECONCILIATION_WARNING } from "../services/validation";
import type { CoopcentralStatement, CoopcentralValidation } from "../types";

const MAX_LISTED = 8;

export function CoopcentralValidationPanel({ statement, validation }: { statement: CoopcentralStatement; validation: CoopcentralValidation }) {
  const { openingBalanceCents: opening, closingBalanceCents: closing, pageCount } = statement;
  const failed = validation.checks.filter((c) => c.status === "failed");
  const informativeFailed = failed.filter((c) => c.informative);
  const unavailable = validation.checks.filter((c) => c.status === "unavailable");
  const pages = `${pageCount} ${pageCount === 1 ? "página" : "páginas"}`;
  const balances = opening !== undefined && closing !== undefined && (
    <>
      {" "}
      Saldo inicial {formatMoneyCents(opening)} · saldo final {formatMoneyCents(closing)}.
    </>
  );

  if (validation.validated) {
    const notes = [
      ...informativeFailed.map((c) => `${c.label}: ${c.detail}`),
      ...unavailable.map((c) => `No fue posible comprobar: ${c.label}. ${c.detail ?? ""}`),
    ];
    return (
      <Alert tone="success" title="Extracto validado" items={notes}>
        Se revisaron {pages}. Saldo inicial + créditos − débitos coincide con el saldo final y con la secuencia de saldos.{balances}
      </Alert>
    );
  }

  const reconciliationFailed = failed.some((c) => c.id === "reconciliation" || c.id === "balances");
  const items = [
    ...failed.filter((c) => c.id !== "issues" && c.id !== "anomalies").map((c) => `${c.label}: ${c.detail ?? "no coincide."}`),
    ...statement.anomalies.slice(0, MAX_LISTED).map(
      (a) => `Página ${a.page}: «${a.concept}» tiene crédito ${formatMoneyCents(a.creditCents)} y débito ${formatMoneyCents(a.debitCents)}; no se clasificó ni se sumó.`,
    ),
    ...statement.issues.slice(0, MAX_LISTED).map((i) => `Página ${i.page}: «${i.text}». ${i.reason}`),
    ...unavailable.map((c) => `${c.label}: ${c.detail ?? "no disponible."}`),
  ];
  const hidden = Math.max(0, statement.anomalies.length - MAX_LISTED) + Math.max(0, statement.issues.length - MAX_LISTED);
  if (hidden > 0) items.push(`… y ${hidden} fila(s) más por revisar.`);

  const title =
    statement.anomalies.length > 0
      ? "Hay filas con valor en CREDITOS y DEBITOS a la vez. Revísalas antes de usar el resultado."
      : statement.issues.length > 0
        ? "Se encontraron filas cuyo contenido no pudo interpretarse."
        : reconciliationFailed
          ? RECONCILIATION_WARNING
          : "No fue posible validar el análisis contra los saldos del extracto.";

  return (
    <Alert tone="warning" title={title} items={items}>
      Los datos no se modificaron y el análisis no se considera validado. Revisa los grupos y sus movimientos.{balances}
    </Alert>
  );
}
