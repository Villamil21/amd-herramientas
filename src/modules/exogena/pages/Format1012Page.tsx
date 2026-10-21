import { Landmark, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../../../app/router";
import { Alert, Button, Card, EmptyState, Loader, PageHeader, Badge, useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import { reopenReadyBankFormats } from "../../financial-statements/bank/exogena/load";
import { bankExoPath } from "../../financial-statements/bank/exogena/paths";
import { BankExoStatusCard } from "../../financial-statements/bank/exogena/ui/BankExoAlerts";
import { Audit1012 } from "../../financial-statements/bank/exogena/ui/BankExoAudit";
import { BANK_EXO_SOURCE } from "../../financial-statements/bank/exogena/model";
import { shouldReopenPurchases } from "../domain/purchasesFormat";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { StatusPanel } from "../components/StatusPanel";
import { findFormat } from "../domain/formats";
import { BANK_EXO_SYNC_SOURCE } from "../domain/bankFormat";
import { useExogenaSelection } from "../state";
import { useBankFormat } from "../useBankFormat";

/**
 * 1012 · saldos de cuentas bancarias al 31 de diciembre (concepto 1110). Los registros salen de Estados Financieros → Extractos
 * bancarios (solo lectura): el saldo es el final del extracto de DICIEMBRE de cada banco; los pendientes se resuelven allá y aquí
 * se actualiza el formato. Nunca queda «listo» con pendientes o desactualizado.
 */
export default function Format1012Page() {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const m = useBankFormat(selection.companyId, selection.year, "1012");
  const def = findFormat("1012")!;
  const [syncing, setSyncing] = useState(false);
  const { format, state, bank } = m;
  const result = bank.contribution?.result ?? null;

  // Un formato «listo» deja de estarlo si cambió su origen: se reabre, nunca se reescribe en silencio.
  useEffect(() => {
    if (state && shouldReopenPurchases(format.status.status, state.problems)) void format.setStatus("requiere_actualizacion");
  }, [format, state]);

  async function sync() {
    if (!m.company || !state || !result) return;
    setSyncing(true);
    try {
      const outcome = await exogenaService.applySync({
        companyId: m.company.id,
        year: selection.year,
        formatCode: "1012",
        source: BANK_EXO_SYNC_SOURCE,
        proposals: state.proposals,
        removeMissing: true,
        summary: { sources: [BANK_EXO_SOURCE], banks: result.banks.length, accounts: result.banks.reduce((n, b) => n + b.accounts.length, 0), decemberStatements: result.audit.f1012.reduce((n, r) => n + r.accounts.length, 0) },
      });
      await Promise.all([format.reload(), bank.reload()]);
      toast(`${outcome.created} nuevos · ${outcome.updated} actualizados · ${outcome.unchanged} sin cambios · ${outcome.removed} retirados.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(false);
    }
  }

  const records = format.records;
  return (
    <>
      <PageHeader
        eyebrow={`Información Exógena · ${selection.year}`}
        title={`1012 · ${def.name}`}
        description="Saldo a 31 de diciembre de las cuentas corrientes y de ahorro en el país (concepto 1110), por banco, desde el extracto de diciembre de cada cuenta. Una cuenta cerrada antes de diciembre no genera valor."
        actions={
          <>
            <Button icon={<Landmark size={15} />} onClick={() => navigate(bankExoPath())}>
              Abrir cobertura de extractos
            </Button>
            <Button variant="primary" icon={<RefreshCcw size={15} />} loading={syncing} disabled={!m.ready} onClick={() => void sync()}>
              Actualizar desde Extractos bancarios
            </Button>
          </>
        }
      />
      <ExogenaContextBar companies={m.companies} />
      {!selection.companyId || (m.companies && !m.company) ? (
        <Card>
          <EmptyState icon={<Landmark size={20} />} title="Selecciona una empresa" description="Elige la empresa y el año a informar para preparar el formato 1012." />
        </Card>
      ) : !m.ready || !state || !records || !result || !m.company ? (
        <Loader />
      ) : (
        <>
          <StatusPanel row={format.status} problems={state.problems} onSetStatus={format.setStatus} />
          {state.changes.length > 0 && (
            <Alert tone="warning" title="Hay cambios sin sincronizar">
              Los extractos bancarios cambiaron desde la última sincronización. Usa «Actualizar desde Extractos bancarios».
            </Alert>
          )}
          <ProblemsPanel problems={state.problems} okText="Sin pendientes: el 1012 se puede marcar como listo." />
          <BankExoStatusCard result={result} companyId={m.company.id} formats={["1012"]} title="Estado del 1012" onChanged={async () => { await bank.reload(); void reopenReadyBankFormats(m.company!.id, [selection.year]).catch(() => undefined); }} />
          <Card flush title={`Registros (${records.length})`}>
            {records.length === 0 ? (
              <EmptyState icon={<Landmark size={20} />} title="Aún no hay registros" description="Actualiza desde Extractos bancarios cuando estén los extractos de diciembre, o marca el formato «No aplica» con su justificación." />
            ) : (
              <div className="table-wrap">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      {def.columns!.map((c) => (
                        <th key={c.key} className={c.kind === "integer" ? "num" : undefined}>
                          {c.header}
                        </th>
                      ))}
                      <th>Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id}>
                        {def.columns!.map((c) => (
                          <td key={c.key} className={c.kind === "integer" ? "num" : undefined}>
                            {String(r.data[c.key] ?? "")}
                          </td>
                        ))}
                        <td className="muted">
                          {r.originRef}
                          {r.manualFields.length > 0 && <Badge tone="warning">Corregido</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Audit1012 rows={result.audit.f1012} year={selection.year} />
        </>
      )}
    </>
  );
}
