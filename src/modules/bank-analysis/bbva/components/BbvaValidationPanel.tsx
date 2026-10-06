import { Alert } from "../../../../components/ui";
import { formatMoneyCents } from "../../../../utils/format";
import { RECONCILIATION_WARNING } from "../services/validation";
import type { BbvaStatement, BbvaValidation } from "../types";

const MAX_LISTED = 8;

export function BbvaValidationPanel({ statement, validation }: { statement: BbvaStatement; validation: BbvaValidation }) {
  const { totals, pageCount } = statement;
  const failed = validation.checks.filter((c) => c.status === "failed");
  const unavailable = validation.checks.filter((c) => c.status === "unavailable");
  const pages = `${pageCount} ${pageCount === 1 ? "página" : "páginas"}`;
  const balances = totals.openingBalanceCents !== undefined && totals.closingBalanceCents !== undefined && (
    <>
      {" "}
      Saldo cierre mes anterior {formatMoneyCents(totals.openingBalanceCents)} · saldo final {formatMoneyCents(totals.closingBalanceCents)}.
    </>
  );

  if (validation.validated) {
    const notes = [
      ...validation.checks.filter((c) => c.status === "ok" && c.detail).map((c) => `${c.label}: ${c.detail}`),
      ...unavailable.map((c) => `No fue posible comprobar: ${c.label}. ${c.detail ?? ""}`),
    ];
    return (
      <Alert tone="success" title="Extracto validado" items={notes}>
        Se revisaron {pages}. Los movimientos coinciden con el resumen del extracto y con la secuencia de saldos.{balances}
      </Alert>
    );
  }

  const items = [
    ...failed.filter((c) => c.id !== "issues" && c.id !== "anomalies").map((c) => `${c.label}: ${c.detail ?? "no coincide."}`),
    ...statement.anomalies.slice(0, MAX_LISTED).map(
      (a) => `Página ${a.page}, fila ${a.row}, ${a.operationDate}: «${a.concept}» tiene cargo ${formatMoneyCents(a.chargeCents)} y abono ${formatMoneyCents(a.creditCents)}; no se clasificó ni se sumó.`,
    ),
    ...statement.issues.slice(0, MAX_LISTED).map((i) => `Página ${i.page}: «${i.text}». ${i.reason}`),
    ...unavailable.map((c) => `${c.label}: ${c.detail ?? "no disponible."}`),
  ];
  const hidden = Math.max(0, statement.anomalies.length - MAX_LISTED) + Math.max(0, statement.issues.length - MAX_LISTED);
  if (hidden > 0) items.push(`… y ${hidden} fila(s) más por revisar.`);

  const detail =
    statement.anomalies.length > 0
      ? "Hay filas con valor en Cargos y en Abonos a la vez."
      : statement.issues.length > 0
        ? "Se encontraron filas cuyo contenido no pudo interpretarse."
        : failed.some((c) => ["net", "reconciliation", "counts"].includes(c.id))
          ? RECONCILIATION_WARNING
          : failed.some((c) => c.id === "balances" || c.id === "order")
            ? "Se detectaron inconsistencias en el orden o en la secuencia de saldos de las filas."
            : "No fue posible validar el análisis contra el resumen del extracto.";

  return (
    <Alert tone="warning" title="Requiere revisión" items={items}>
      {detail} Los datos no se modificaron y el análisis no se considera validado. Revisa los grupos y sus movimientos.{balances}
    </Alert>
  );
}
