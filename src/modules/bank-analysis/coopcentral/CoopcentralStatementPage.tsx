import { PageHeader } from "../../../components/ui";
import { TypedBankAccounting } from "../../financial-statements/bank/BankAccountingPanel";
import { CoopcentralGroupDetailModal } from "./components/CoopcentralGroupDetailModal";
import { AccountDetails, StatementFileActions, StatementFileCard } from "../shared/components/StatementFileCard";
import { useStatementImport } from "../shared/useStatementImport";
import { CoopcentralValidationPanel } from "./components/CoopcentralValidationPanel";
import { analyzeCoopcentral, type CoopcentralAnalysis } from "./services/analysis";
import { exportCoopcentralExcel } from "./services/excelExport";

const exportAnalysis = (a: CoopcentralAnalysis, fileName: string) => exportCoopcentralExcel(a.statement, a.groups, fileName);

export default function CoopcentralStatementPage() {
  const { state, picking, busy, exporting, exportedPath, pick, exportExcel } = useStatementImport({
    analyze: analyzeCoopcentral,
    exportExcel: exportAnalysis,
    fallbackError: "No fue posible analizar el extracto. Verifica que sea un extracto de Coopcentral en PDF.",
    logTag: "coopcentral",
  });

  return (
    <>
      <PageHeader eyebrow="Extractos bancarios" title="Coopcentral" description="Importa un extracto bancario en PDF para analizar sus movimientos." />

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
        <TypedBankAccounting
          statement={state.analysis.statement}
          closingBalanceCents={state.analysis.statement.closingBalanceCents}
          openingBalanceCents={state.analysis.statement.openingBalanceCents}
          groups={state.analysis.groups}
          fileName={state.fileName}
          onExport={exportExcel}
          exporting={exporting}
          validated={state.analysis.validation.validated}
          validation={<CoopcentralValidationPanel statement={state.analysis.statement} validation={state.analysis.validation} />}
          fileActions={<StatementFileActions picking={picking} busy={busy} exportedPath={exportedPath} onPick={() => void pick()} />}
          renderDetail={(key, close) => <CoopcentralGroupDetailModal group={state.analysis.groups.find((g) => g.key === key) ?? null} onClose={close} />}
        />
      )}
    </>
  );
}
