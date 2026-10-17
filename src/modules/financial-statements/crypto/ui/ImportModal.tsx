import { useMemo, useState } from "react";
import { Alert, Badge, Button, Modal } from "../../../../components/ui";
import { cryptoService } from "../../../../services/cryptoService";
import { errorMessage } from "../../../../services/tauri";
import { formatInteger } from "../../../../utils/format";
import { fieldValue } from "../domain/operations";
import type { ParsedCryptoWorkbook } from "../domain/parse";
import { summaryOf, diffVersions } from "../domain/versions";
import type { CryptoState } from "../domain/types";

interface Props {
  parsed: ParsedCryptoWorkbook | null;
  companyId: number;
  companyName: string;
  year: number;
  state: CryptoState;
  onClose: () => void;
  onImported: (message: string) => void;
}

const DIFF_LABEL = { added: "Filas agregadas", modified: "Filas modificadas", unchanged: "Sin cambios", removed: "Filas eliminadas" } as const;

/**
 * Revisión de un archivo antes de guardarlo: qué hojas se leyeron, qué fechas de Compras están fuera del año y, si ya existe
 * una carga con exactamente el mismo nombre, qué cambia (agregadas, modificadas, sin cambios, eliminadas). El reemplazo
 * siempre pide confirmación explícita; nunca se crea una segunda carga con el mismo nombre.
 */
export function ImportModal({ parsed, companyId, companyName, year, state, onClose, onImported }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = parsed ? state.uploads.find((u) => u.fileName === parsed.fileName) : undefined;

  const analysis = useMemo(() => {
    if (!parsed) return null;
    const purchases = parsed.rows.filter((r) => r.kind === "purchase");
    const dates = purchases.map((r) => String(fieldValue("purchase", r.data, "date") ?? ""));
    const outside = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number(d.slice(0, 4)) !== year);
    const unreadable = dates.filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
    const years = [...new Set(outside.map((d) => d.slice(0, 4)))].sort();
    const months = [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number(d.slice(0, 4)) === year).map((d) => d.slice(0, 7)))].sort();
    const diff = existing ? diffVersions(state.rows.filter((r) => r.uploadId === existing.id), parsed.rows) : null;
    return { outside: outside.length, unreadable: unreadable.length, years, months, diff };
  }, [parsed, year, existing, state.rows]);

  async function save() {
    if (!parsed || !analysis) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await cryptoService.save({
        companyId,
        year,
        fileName: parsed.fileName,
        sheets: parsed.sheets,
        rows: parsed.rows,
        summary: analysis.diff ? summaryOf(analysis.diff) : {},
        replace: Boolean(existing),
      });
      onImported(outcome.version > 1 ? `«${parsed.fileName}» reemplazado (versión ${outcome.version}).` : `«${parsed.fileName}» importado: ${formatInteger(parsed.rows.length)} filas.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={parsed !== null}
      size="lg"
      title={existing ? "Ya existe un archivo con este nombre" : "Importar archivo"}
      description={parsed ? `${parsed.fileName} · ${companyName} · ${year}` : undefined}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {existing ? `Reemplazar por la versión ${existing.version + 1}` : "Importar"}
          </Button>
        </>
      }
    >
      {parsed && analysis && (
        <div className="stack stack--sm">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {parsed.sheets.map((s) => (
              <Badge key={s} tone="success">
                Hoja «{s}»
              </Badge>
            ))}
            <span className="muted">
              {formatInteger(parsed.purchases)} compras · {formatInteger(parsed.sales)} ventas
              {parsed.ignoredSheets.length > 0 && ` · hojas ignoradas: ${parsed.ignoredSheets.join(", ")}`}
            </span>
          </div>
          <p className="muted">
            Filas leídas: Compras {formatInteger(parsed.sourceRows.purchase)} = {formatInteger(parsed.purchases)} guardadas + {formatInteger(parsed.blankRows.purchase)} vacías omitidas · Ventas {formatInteger(parsed.sourceRows.sale)} = {formatInteger(parsed.sales)} guardadas + {formatInteger(parsed.blankRows.sale)} vacías omitidas.
          </p>
          {parsed.warnings.map((w) => (
            <Alert key={w} tone="info">
              {w}
            </Alert>
          ))}
          {analysis.months.length > 0 && <p className="muted">Meses que cubre (por la fecha de Compras): {analysis.months.join(", ")}.</p>}
          {(analysis.outside > 0 || analysis.unreadable > 0) && (
            <Alert tone="warning" title="Compras con fecha fuera de este año">
              {analysis.outside > 0 && (
                <p>
                  {formatInteger(analysis.outside)} {analysis.outside === 1 ? "compra tiene" : "compras tienen"} fecha de {analysis.years.join(", ")}, no de {year}.
                </p>
              )}
              {analysis.unreadable > 0 && <p>{formatInteger(analysis.unreadable)} compras tienen una fecha ilegible.</p>}
              <p>Se guardan para auditoría, pero no afectan ningún resultado hasta que las excluyas o corrijas el archivo y lo vuelvas a importar con el mismo nombre.</p>
            </Alert>
          )}
          {existing && analysis.diff && (
            <>
              <Alert tone="warning" title="Se reemplazará la versión vigente">
                «{existing.fileName}» ya está cargado (versión {existing.version}). Al confirmar, las filas que estaban solo en la versión anterior dejan de alimentar Estados Financieros y Exógena; las decisiones sobre filas idénticas se conservan y las de filas cambiadas se vuelven a pedir.
              </Alert>
              <div className="table-wrap">
                <table className="table table--dense">
                  <tbody>
                    {(Object.keys(DIFF_LABEL) as (keyof typeof DIFF_LABEL)[]).map((k) => (
                      <tr key={k}>
                        <td>{DIFF_LABEL[k]}</td>
                        <td className="num">
                          <strong>{formatInteger(analysis.diff![k])}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}
