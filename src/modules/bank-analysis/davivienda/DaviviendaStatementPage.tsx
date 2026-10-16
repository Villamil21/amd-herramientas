import { PageHeader } from "../../../components/ui";
import { SignedBankAccounting } from "../../financial-statements/bank/BankAccountingPanel";
import type { GroupLabels } from "../shared/components/groupLabels";
import { GroupDetailModal } from "../shared/components/GroupDetailModal";
import { AccountDetails, StatementFileActions, StatementFileCard } from "../shared/components/StatementFileCard";
import { ValidationPanel } from "../shared/components/ValidationPanel";
import { useStatementImport } from "../shared/useStatementImport";
import { analyzeDavivienda, type DaviviendaAnalysis } from "./services/analysis";
import { exportDaviviendaExcel } from "./services/excelExport";

const LABELS: GroupLabels = {
  description: "Clase de Movimiento",
  searchPlaceholder: "Buscar clase de movimiento...",
  tableDescription: "Agrupados por clase de movimiento exacta y signo del valor. Haz clic en un grupo para ver sus movimientos.",
  branch: "Oficina",
  document: "Doc.",
  sortableType: true,
};

const VALIDATED = "Los movimientos coinciden con Más Créditos y Menos Débitos, y Saldo Anterior + neto coincide con el Nuevo Saldo.";

const exportAnalysis = (a: DaviviendaAnalysis, fileName: string) => exportDaviviendaExcel(a.statement, a.groups, fileName);

export default function DaviviendaStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeDavivienda,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de Davivienda en PDF.",
    logTag: "davivienda",
  });

  return (
    <>
      <PageHeader eyebrow="Extractos bancarios" title="Davivienda" description="Importa un extracto bancario en PDF para analizar sus movimientos." />

      <StatementFileCard
        hideWhenDone
        state={state}
        details={state.status === "done" && <AccountDetails {...state.analysis.statement} />}
        picking={picking}
        busy={busy}
        exportedPath={exportedPath}
        onPick={() => void pick()}
      />

      {state.status === "done" && (
        <SignedBankAccounting statement={state.analysis.statement} groups={state.analysis.groups} fileName={state.fileName} onExport={exportExcel} exporting={exporting}
          typeLabels={{ C: "Crédito", D: "Débito" }}
          validated={state.analysis.validation.validated}
          validation={<ValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} validatedMessage={VALIDATED} />}
          fileActions={<StatementFileActions picking={picking} busy={busy} exportedPath={exportedPath} onPick={() => void pick()} />}
          renderDetail={(key, close) => <GroupDetailModal group={state.analysis.groups.find((g) => g.key === key) ?? null} labels={LABELS} onClose={close} />}
        />
      )}
    </>
  );
}
