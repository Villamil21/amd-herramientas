import { saveExcelSheets, type ExportSheet } from "../../../bank-analysis/shared/excelExportService";
import { PERSON_TYPE_LABEL, RETENTION_TYPE_LABEL, TITLE_CATEGORY_LABEL, type WithholdingRate } from "../../../../types/models";
import type { WithholdingReport } from "../types";
import { belowMinimumLines, ignoredGroup, rateText, ruleSubtypeText, ruleTypeText, STATUS_LABEL } from "./labels";
import { formatDate, formatRateBp, formatUvt } from "./money";

const pesos = (cents: number | undefined) => (cents === undefined ? null : cents / 100);

const RULE_STATE_LABEL = { applies: "Aplica", "not-applicable": "No aplica en esta factura", pending: "Pendiente" } as const;

export function buildWithholdingSheets(report: WithholdingReport, rates: WithholdingRate[]): ExportSheet[] {
  const summary: ExportSheet = {
    name: "Resumen declaración",
    columns: [
      { header: "Concepto", kind: "text" },
      { header: "PJ Base", kind: "money" },
      { header: "PJ Retención", kind: "money" },
      { header: "PN Base", kind: "money" },
      { header: "PN Retención", kind: "money" },
    ],
    // Solo bases de Facturas válidas que efectivamente generaron retención.
    rows: report.summary.map((l) => [RETENTION_TYPE_LABEL[l.retentionType], pesos(l.pj.baseCents), pesos(l.pj.retentionCents), pesos(l.pn.baseCents), pesos(l.pn.retentionCents)]),
  };

  const notes: ExportSheet = {
    name: "Notas",
    columns: [
      { header: "Documento", kind: "text" },
      { header: "Proveedor", kind: "text" },
      { header: "NIT", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Subtipo", kind: "text" },
      { header: "Base", kind: "money" },
      { header: "Retención", kind: "money" },
      { header: "Estado", kind: "text" },
    ],
    rows: report.rows
      .filter((r) => r.category === "credit_note")
      .map((r) => [
        r.number ?? r.fileName,
        r.supplierName ?? null,
        r.nit ?? null,
        ruleTypeText(r) ?? null,
        ruleSubtypeText(r) ?? null,
        r.counts ? pesos(r.baseCents) : null,
        r.counts ? pesos(r.retentionCents) : 0,
        r.counts ? `${STATUS_LABEL[r.status]} (suma en Total notas)` : STATUS_LABEL[r.status],
      ]),
  };

  const documents: ExportSheet = {
    name: "Facturas",
    columns: [
      { header: "Archivo", kind: "text" },
      { header: "Categoría", kind: "text" },
      { header: "Título original", kind: "text" },
      { header: "Número", kind: "text" },
      { header: "Fecha", kind: "text" },
      { header: "NIT", kind: "text" },
      { header: "Proveedor", kind: "text" },
      { header: "PJ / PN", kind: "text" },
      { header: "Régimen", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Subtipo", kind: "text" },
      { header: "Subtotal", kind: "money" },
      { header: "Base", kind: "money" },
      { header: "Base mínima", kind: "money" },
      { header: "Tarifa", kind: "text" },
      { header: "Retención calculada", kind: "money" },
      { header: "Rete fuente PDF", kind: "money" },
      { header: "Va a la declaración", kind: "text" },
      { header: "Estado", kind: "text" },
      { header: "Detalle", kind: "text" },
    ],
    rows: report.rows.map((r) => [
      r.fileName,
      r.category ? TITLE_CATEGORY_LABEL[r.category] : null,
      r.title ?? null,
      r.number ?? null,
      r.issueDate ? formatDate(r.issueDate) : null,
      r.nit ?? null,
      r.supplierName ?? null,
      r.personType ?? null,
      r.fiscalCodes.join(";") || null,
      ruleTypeText(r) ?? null,
      ruleSubtypeText(r) ?? null,
      pesos(r.subtotalCents),
      pesos(r.baseCents),
      pesos(r.minBaseCents),
      rateText(r) ?? null,
      pesos(r.calculatedCents),
      pesos(r.informedCents),
      r.counts ? "Sí" : "No",
      STATUS_LABEL[r.status],
      [...r.issues, ...r.notes].join(" ") || null,
    ]),
  };

  const below: ExportSheet = {
    name: "No aplicó por tope",
    columns: [
      { header: "Categoría", kind: "text" },
      { header: "Documento", kind: "text" },
      { header: "Proveedor", kind: "text" },
      { header: "NIT", kind: "text" },
      { header: "PJ / PN", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Subtipo", kind: "text" },
      { header: "Base", kind: "money" },
      { header: "Base mínima", kind: "money" },
      { header: "Tarifa", kind: "text" },
      { header: "Diferencia frente al tope", kind: "money" },
    ],
    rows: belowMinimumLines(report.rows).map(({ row: r, line: l }) => [
      r.category ? TITLE_CATEGORY_LABEL[r.category] : null,
      r.number ?? r.fileName,
      r.supplierName ?? null,
      r.nit ?? null,
      r.personType ?? null,
      RETENTION_TYPE_LABEL[l.rule.retentionType],
      l.rule.subtypeName,
      pesos(l.baseCents),
      pesos(l.minBaseCents),
      formatRateBp(l.rateBp),
      pesos(l.minBaseCents - l.baseCents!),
    ]),
  };

  // Una fila por regla del documento: una misma factura puede aparecer en varios subtipos.
  const byRule: ExportSheet = {
    name: "Retenciones por factura",
    columns: [
      { header: "Categoría", kind: "text" },
      { header: "Factura", kind: "text" },
      { header: "Proveedor", kind: "text" },
      { header: "NIT", kind: "text" },
      { header: "PJ / PN", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Subtipo", kind: "text" },
      { header: "Aplica", kind: "text" },
      { header: "Base", kind: "money" },
      { header: "Base mínima", kind: "money" },
      { header: "Tarifa", kind: "text" },
      { header: "Retención", kind: "money" },
      { header: "Va a la declaración", kind: "text" },
      { header: "Estado del documento", kind: "text" },
    ],
    rows: report.rows.flatMap((r) =>
      r.lines.map((l) => [
        r.category ? TITLE_CATEGORY_LABEL[r.category] : null,
        r.number ?? r.fileName,
        r.supplierName ?? null,
        r.nit ?? null,
        r.personType ?? null,
        RETENTION_TYPE_LABEL[l.rule.retentionType],
        l.rule.subtypeName,
        RULE_STATE_LABEL[l.state],
        pesos(l.baseCents),
        pesos(l.minBaseCents),
        formatRateBp(l.rateBp),
        pesos(l.calculatedCents),
        l.counts ? "Sí" : "No",
        STATUS_LABEL[r.status],
      ]),
    ),
  };

  const ignored: ExportSheet = {
    name: "Ignorados",
    columns: [
      { header: "Categoría", kind: "text" },
      { header: "Archivo", kind: "text" },
      { header: "Documento", kind: "text" },
      { header: "Proveedor", kind: "text" },
      { header: "NIT", kind: "text" },
      { header: "Fecha", kind: "text" },
      { header: "Código fiscal", kind: "text" },
      { header: "Motivo", kind: "text" },
    ],
    rows: report.rows
      .filter((r) => ignoredGroup(r.status))
      .map((r) => [
        ignoredGroup(r.status)!,
        r.fileName,
        r.number ?? null,
        r.supplierName ?? null,
        r.nit ?? null,
        r.issueDate ? formatDate(r.issueDate) : null,
        r.excludedCode ?? (r.fiscalCodes.join(";") || null),
        r.issues[0] ?? STATUS_LABEL[r.status],
      ]),
  };

  const { totals, stats } = report;
  const config: ExportSheet = {
    name: "Configuración",
    columns: [
      { header: "Dato", kind: "text" },
      { header: "Valor", kind: "text" },
      { header: "Pesos", kind: "money" },
    ],
    rows: [
      ["Periodo", report.period.label ?? "Sin definir", null],
      ...report.uvtUsed.flatMap((u) => [
        ["Año UVT", String(u.year), null],
        ["Valor UVT", null, u.valuePesos],
      ]),
      ["Total facturas válidas", null, pesos(totals.invoicesCents)],
      ["Total notas válidas", null, pesos(totals.notesCents)],
      ["Total neto", null, pesos(totals.netCents)],
      ["Total neto redondeado", null, pesos(totals.netRoundedCents)],
      ["Documentos encontrados", String(stats.files), null],
      ["Validados", String(stats.validated), null],
      ["Pendientes (no incluidos)", String(stats.pending), null],
    ],
  };

  // Registro de auditoría: base UVT y tarifa usadas por subtipo.
  const used = new Map<string, (string | number | null)[]>();
  for (const r of report.rows) {
    if (r.uvtYear === undefined) continue;
    for (const l of r.lines) {
      const key = `${l.rule.rateId}|${r.uvtYear}`;
      if (l.state !== "applies" || used.has(key)) continue;
      const configured = rates.find((x) => x.id === l.rule.rateId);
      used.set(key, [
        RETENTION_TYPE_LABEL[l.rule.retentionType],
        l.rule.subtypeName,
        String(r.uvtYear),
        r.uvtPesos!,
        formatUvt(l.baseUvtCenti),
        pesos(l.minBaseCents),
        configured ? formatRateBp(configured.rateBp) : null,
      ]);
    }
  }
  const snapshot: ExportSheet = {
    name: "Tarifas usadas",
    columns: [
      { header: "Tipo", kind: "text" },
      { header: "Subtipo", kind: "text" },
      { header: "Año UVT", kind: "text" },
      { header: "Valor UVT", kind: "pesos" },
      { header: "Base UVT", kind: "text" },
      { header: "Base mínima", kind: "money" },
      { header: "Tarifa configurada", kind: "text" },
    ],
    rows: [...used.values()],
  };

  const detail: ExportSheet = {
    name: "Detalle por subtipo",
    columns: [
      { header: "Categoría", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Subtipo", kind: "text" },
      { header: "PJ / PN", kind: "text" },
      { header: "Base", kind: "money" },
      { header: "Tarifa", kind: "text" },
      { header: "Retención", kind: "money" },
      { header: "Documentos", kind: "integer" },
    ],
    rows: report.detail.map((d) => [
      TITLE_CATEGORY_LABEL[d.category],
      RETENTION_TYPE_LABEL[d.retentionType],
      d.subtypeName,
      PERSON_TYPE_LABEL[d.personType],
      pesos(d.baseCents),
      formatRateBp(d.rateBp),
      pesos(d.retentionCents),
      d.documentCount,
    ]),
  };

  return [summary, notes, documents, byRule, below, ignored, config, detail, snapshot];
}

export function exportWithholdingExcel(report: WithholdingReport, rates: WithholdingRate[], folderName: string) {
  const period = report.period.key ? `_${report.period.key}` : "";
  return saveExcelSheets(buildWithholdingSheets(report, rates), `Retencion_fuente${period}_${folderName}`);
}
