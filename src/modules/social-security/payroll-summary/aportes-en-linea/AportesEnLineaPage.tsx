import { FileSpreadsheet } from "lucide-react";
import { Button, PageHeader } from "../../../../components/ui";
import { StatementFileCard } from "../../../bank-analysis/shared/components/StatementFileCard";
import { useStatementImport } from "../../../bank-analysis/shared/useStatementImport";
import { EmployeesTable } from "../shared/components/EmployeesTable";
import { PayrollSummaryCards } from "../shared/components/PayrollSummaryCards";
import { PayrollValidationPanel } from "../shared/components/PayrollValidationPanel";
import { exportPayrollExcel } from "../shared/export/excelExport";
import type { PayrollAnalysis } from "../shared/types";
import { analyzeAportesEnLinea } from "./services/analysis";

const LABELS = { pick: "Seleccionar planilla PDF", pickAnother: "Seleccionar otra planilla", analyzing: "Analizando planilla…" };

const exportAnalysis = (a: PayrollAnalysis) => exportPayrollExcel(a.summary);

export default function AportesEnLineaPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeAportesEnLinea,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar la planilla. Verifica que sea una planilla de Aportes en Línea en PDF.",
    logTag: "aportes-en-linea",
    pickTitle: "Seleccionar planilla PDF",
  });

  return (
    <>
      <PageHeader
        eyebrow="Resumen de planilla"
        title="Aportes en Línea"
        description="Importa una planilla de seguridad social en PDF para generar un resumen."
        actions={
          state.status === "done" && (
            <Button variant="primary" icon={<FileSpreadsheet size={15} />} onClick={() => void exportExcel()} loading={exporting}>
              Exportar Excel
            </Button>
          )
        }
      />

      <StatementFileCard
        state={state}
        details={state.status === "done" && <span>· Periodo {state.analysis.summary.period}</span>}
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
        labels={LABELS}
      />

      {state.status === "done" && (
        <>
          <PayrollValidationPanel summary={state.analysis.summary} validation={state.analysis.validation} />
          <PayrollSummaryCards summary={state.analysis.summary} />
          <EmployeesTable summary={state.analysis.summary} />
        </>
      )}
    </>
  );
}
