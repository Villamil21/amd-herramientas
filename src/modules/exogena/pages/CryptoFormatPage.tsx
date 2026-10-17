import { Bitcoin, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../../../app/router";
import { Alert, Badge, Button, Card, EmptyState, Loader, PageHeader, useToast } from "../../../components/ui";
import { errorMessage } from "../../../services/tauri";
import { syncCryptoFormat, type CryptoExoFormat } from "../../financial-statements/crypto/exogenaSync";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { ProblemsPanel } from "../components/ProblemsPanel";
import { StatusPanel } from "../components/StatusPanel";
import { findFormat } from "../domain/formats";
import { CRYPTO_PATH, shouldReopen } from "../domain/cryptoFormat";
import { useExogenaSelection } from "../state";
import { useCryptoFormat } from "../useCryptoFormat";


/**
 * Pantalla de 1007 / 1647. Los registros salen de Estados Financieros → Transacciones Cripto (solo lectura); los pendientes se
 * resuelven allá y aquí se actualiza el formato. Nunca queda «listo» con pendientes o desactualizado.
 */
export default function CryptoFormatPage({ code }: { code: CryptoExoFormat }) {
  const toast = useToast();
  const [selection] = useExogenaSelection();
  const m = useCryptoFormat(selection.companyId, selection.year, code);
  const def = findFormat(code)!;
  const [syncing, setSyncing] = useState(false);
  const { format, computed, model } = m;

  // Un formato «listo» deja de estarlo si cambió su origen: se reabre, nunca se reescribe en silencio.
  useEffect(() => {
    if (computed && shouldReopen(format.status.status, computed.problems)) void format.setStatus("requiere_actualizacion");
  }, [format, computed]);

  async function sync(overwrite: string[] = []) {
    if (!m.company || !model) return;
    setSyncing(true);
    try {
      const outcome = await syncCryptoFormat({ companyId: m.company.id, year: selection.year, model, format: code, overwriteManual: overwrite });
      await format.reload();
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
        title={`${code} · ${def.name}`}
        description={code === "1007" ? "Ingresos recibidos (concepto 4001) por cliente, desde las Ventas de Transacciones Cripto." : "Ingresos recibidos para terceros (concepto 4070), con cada tercero de Compras asignado completo a un pagador de Ventas."}
        actions={
          <>
            <Button icon={<Bitcoin size={15} />} onClick={() => navigate(CRYPTO_PATH)}>
              Abrir Transacciones Cripto
            </Button>
            <Button variant="primary" icon={<RefreshCcw size={15} />} loading={syncing} disabled={!m.ready} onClick={() => void sync()}>
              Actualizar desde Transacciones Cripto
            </Button>
          </>
        }
      />
      <ExogenaContextBar companies={m.companies} />
      {!selection.companyId || (m.companies && !m.company) ? (
        <Card>
          <EmptyState icon={<Bitcoin size={20} />} title="Selecciona una empresa" description={`Elige la empresa y el año a informar para preparar el formato ${code}.`} />
        </Card>
      ) : !m.ready || !computed || !records ? (
        <Loader />
      ) : (
        <>
          <StatusPanel row={format.status} problems={computed.problems} onSetStatus={format.setStatus} />
          {computed.changes.length > 0 && (
            <Alert tone="warning" title="Hay cambios sin sincronizar">
              Transacciones Cripto cambió desde la última sincronización. Usa «Actualizar desde Transacciones Cripto».
            </Alert>
          )}
          <ProblemsPanel problems={computed.problems} okText={`Sin pendientes: el ${code} se puede marcar como listo.`} />
          <Card flush title={`Registros (${records.length})`}>
            {records.length === 0 ? (
              <EmptyState icon={<Bitcoin size={20} />} title="Aún no hay registros" description="Actualiza desde Transacciones Cripto, o marca el formato «No aplica» con su justificación." />
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
        </>
      )}
    </>
  );
}
