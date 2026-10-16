import { PageHeader } from "../../../components/ui";
import { SignedBankAccounting } from "../../financial-statements/bank/BankAccountingPanel";
import { DEFAULT_GROUP_LABELS, type GroupLabels } from "../shared/components/groupLabels";
import { GroupDetailModal } from "../shared/components/GroupDetailModal";
import { AccountDetails, StatementFileActions, StatementFileCard } from "../shared/components/StatementFileCard";
import { ValidationPanel } from "../shared/components/ValidationPanel";
import { useStatementImport } from "../shared/useStatementImport";
import { analyzeIrisBank, type IrisBankAnalysis } from "./services/analysis";
import { exportIrisBankExcel } from "./services/excelExport";

const LABELS: GroupLabels = {
  ...DEFAULT_GROUP_LABELS,
  document: "Referencia",
  date: "Día",
  value: "Movimiento",
  sortableType: true,
};

const VALIDATED = "Los movimientos coinciden con Total Abonos y Total Cargos, la secuencia de saldos cuadra y Saldo Mes Anterior + neto coincide con el Saldo Actual.";

const exportAnalysis = (a: IrisBankAnalysis, fileName: string) => exportIrisBankExcel(a.statement, a.groups, fileName);

export default function IrisBankStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeIrisBank,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de Iris Bank en PDF.",
    logTag: "iris-bank",
  });

  return (
    <>
      <PageHeader eyebrow="Extractos bancarios" title="Iris Bank" description="Importa un extracto bancario en PDF para analizar sus movimientos." />

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
          typeLabels={{ C: "Abono", D: "Cargo" }}
          validated={state.analysis.validation.validated}
          validation={<ValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} validatedMessage={VALIDATED} />}
          fileActions={<StatementFileActions picking={picking} busy={busy} exportedPath={exportedPath} onPick={() => void pick()} />}
          renderDetail={(key, close) => <GroupDetailModal group={state.analysis.groups.find((g) => g.key === key) ?? null} labels={LABELS} onClose={close} />}
        />
      )}
    </>
  );
}
