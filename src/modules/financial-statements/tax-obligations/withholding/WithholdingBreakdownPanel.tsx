import { Fragment, useEffect, useMemo, useState } from "react";
import { FileUp, Plus, Save, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Input, Select, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import { parseNumericText } from "../../../../utils/numbers";
import { extractPdfText } from "../../../bank-analysis/shared/pdf/pdfExtractor";
import { statementService } from "../../../bank-analysis/shared/statementService";
import { PucField } from "../../shared/components/PucField";
import { presentationOf } from "../../shared/presentation";
import type { FsData } from "../../shared/useFsData";
import { formatExactCents } from "../../shared/money";
import { parseTaxReturn, TaxReturnError } from "../parser/taxReturnParser";
import { taxService } from "../services/taxService";
import type { TaxReturn } from "../types";
import { adjustmentWarnings, whBreakdownOf, whPucKey, whTargets, type Adjustment129 } from "./detail";

const newId = () => Math.random().toString(36).slice(2, 10);
const centsText = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

interface Props {
  item: TaxReturn;
  data: FsData;
  onChanged: () => Promise<void>;
  /** Clasificar la familia de cuatro dígitos de una cuenta sin ubicación en EEFF. */
  onClassify?: (familyCode: string, concept: string) => void;
}

/**
 * Retefuente discriminada por concepto (Formulario 350): personas jurídicas + naturales en una fila por concepto, un PUC por concepto,
 * un único PUC para las autorretenciones, la casilla 129 como devoluciones negativas distribuibles y la conciliación con el total declarado.
 */
export function WithholdingBreakdownPanel({ item: r, data, onChanged, onClassify }: Props) {
  const toast = useToast();
  const breakdown = whBreakdownOf(r);
  const saved = (r.detail.manual?.adjustments129 ?? []) as Adjustment129[];
  const [rows, setRows] = useState<Adjustment129[]>(saved);
  const [openSelf, setOpenSelf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows((r.detail.manual?.adjustments129 ?? []) as Adjustment129[]);
  }, [r.id, r.detail.manual]);
  const targets = useMemo(() => whTargets(), []);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  async function setPuc(key: string, code: string) {
    try {
      await fsService.savePucSettings([{ key, pucCode: code }]);
      await data.reloadSettings();
      toast("Cuenta PUC guardada: el efecto se recalculó sin tocar declaraciones ni pagos.");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function saveAdjustments() {
    setBusy(true);
    setError(null);
    try {
      await taxService.patchDetail(r.id, { manual: { ...(r.detail.manual ?? {}), adjustments129: rows.filter((a) => a.cents > 0) } }, "Distribución de devoluciones (casilla 129)");
      toast("Distribución guardada.");
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Vuelve a leer el PDF del mismo formulario para guardar las casillas por concepto (declaraciones leídas antes de la discriminación). */
  async function reread() {
    setBusy(true);
    setError(null);
    try {
      const picked = await statementService.pickPdf("Seleccionar la declaración de Retención en la fuente (PDF)");
      if (!picked) return;
      const parsed = parseTaxReturn(await extractPdfText(picked.data));
      if (parsed.taxType !== "withholding") throw new TaxReturnError("El archivo no es un Formulario 350.");
      if (parsed.formNumber !== r.formNumber) throw new TaxReturnError(`El PDF es el formulario ${parsed.formNumber || "sin número"}, no el ${r.formNumber}.`);
      if (!parsed.withholdingCasillas || Object.keys(parsed.withholdingCasillas).length === 0) throw new TaxReturnError("No se pudieron leer las casillas por concepto del PDF.");
      if (parsed.withholdingCasillas["138"] !== r.payableCents) throw new TaxReturnError("El total del PDF no coincide con el total guardado de la declaración.");
      await taxService.patchDetail(r.id, { withholding: { casillas: parsed.withholdingCasillas } }, "Casillas por concepto leídas del PDF");
      toast("Casillas por concepto guardadas.");
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!breakdown)
    return (
      <div className="stack">
        <Alert tone="warning" title="Esta declaración se leyó sin discriminar por concepto">
          Mientras no se discrimine, todo su saldo se envía a EEFF con la cuenta general «Retención en la fuente por pagar». Vuelve a leer el mismo PDF para separar los conceptos (no se pierde ningún dato ni pago).
        </Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <div>
          <Button variant="primary" icon={<FileUp size={14} />} loading={busy} onClick={() => void reread()}>
            Leer el PDF de nuevo
          </Button>
        </div>
      </div>
    );

  const b = breakdown;
  const warnings = adjustmentWarnings(b);
  const sumRows = rows.reduce((n, a) => n + a.cents, 0);
  const undistributed = Math.max(0, b.casilla129Cents - sumRows);

  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Personas jurídicas</th>
              <th className="num">Personas naturales</th>
              <th className="num">Retención</th>
              <th className="num">Casilla 129</th>
              <th className="num">Valor contable</th>
              <th>Cuenta PUC</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row) => {
              const key = whPucKey(row.key);
              const code = data.settingsMap.get(key);
              const pres = code ? presentationOf(code, data.catalog, data.mappingMap) : null;
              return (
                <Fragment key={row.key}>
                  <tr>
                    <td>
                      {row.label}
                      {row.key === "self" && (
                        <>
                          {" "}
                          <button type="button" className="link-button" onClick={() => setOpenSelf((v) => !v)}>
                            {openSelf ? "Ocultar detalle" : "Ver detalle por casilla"}
                          </button>
                        </>
                      )}
                    </td>
                    <td className="num">{formatExactCents(row.pjCents)}</td>
                    <td className="num">{formatExactCents(row.pnCents)}</td>
                    <td className="num">{formatExactCents(row.grossCents)}</td>
                    <td className="num amount--negative">{row.adjustmentCents ? formatExactCents(row.adjustmentCents) : "—"}</td>
                    <td className={row.netCents < 0 ? "num amount--negative" : "num"}>{formatExactCents(row.netCents)}</td>
                    <td>
                      <PucField index={data.index} value={code} onChange={(c) => void setPuc(key, c)} title={`Cuenta PUC — ${row.label}`} mappings={data.mappingMap} compact onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
                      {!code && <div className="table__secondary"><Badge tone="danger">Pendiente de clasificar</Badge> no viaja a EEFF</div>}
                      {pres && (
                        <div className="table__secondary">
                          {pres.family}: {pres.state === "none" ? "sin ubicación en EEFF" : pres.text}
                          {pres.state === "none" && onClassify && (
                            <>
                              {" "}
                              <button type="button" className="link-button" onClick={() => onClassify(pres.family, data.index.concepts.get(pres.family) ?? "")}>
                                Clasificar
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {row.key === "self" && openSelf && (
                    <tr>
                      <td colSpan={7}>
                        <span className="field__hint">Detalle por casilla (auditoría): la base y la retención de cada renglón de autorretención. Se contabilizan con un único PUC.</span>
                        <table className="table table--dense">
                          <tbody>
                            {b.selfDetail.map((s) => (
                              <tr key={s.casilla}>
                                <td className="mono">Casilla {s.casilla}</td>
                                <td>{s.party === "PJ" ? "Personas jurídicas" : "Personas naturales"}</td>
                                <td>{s.kind === "base" ? "Base" : "Retención"}</td>
                                <td className="num">{formatExactCents(s.cents)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {b.sanctionCents > 0 && (
              <tr>
                <td>Sanciones (casilla 137)</td>
                <td className="num" colSpan={3} />
                <td className="num" />
                <td className="num">{formatExactCents(b.sanctionCents)}</td>
                <td className="muted">Gasto y cuenta por pagar: se configuran en «Sanciones».</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="stack stack--sm">
        <div className="row row--between" style={{ flexWrap: "wrap" }}>
          <strong>Devoluciones y ajustes - casilla 129</strong>
          <span className="muted">Formulario: {formatExactCents(-b.casilla129Cents)} (siempre negativo; reduce las retenciones positivas)</span>
        </div>
        {rows.length === 0 && <p className="muted">Sin distribución. Puedes agregar filas aunque el formulario traiga 0: por ejemplo una nota crédito de una factura anterior.</p>}
        {rows.map((a) => (
          <div key={a.id} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Select aria-label="Concepto" value={a.conceptKey} style={{ width: 280 }} onChange={(e) => setRows((list) => list.map((x) => (x.id === a.id ? { ...x, conceptKey: e.target.value } : x)))}>
              {targets.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Input aria-label="Valor de la devolución" className="input--right" inputMode="decimal" style={{ width: 160 }} value={a.cents ? centsText(a.cents) : ""} placeholder="Valor" onChange={(e) => setRows((list) => list.map((x) => (x.id === a.id ? { ...x, cents: Math.max(0, Math.round((parseNumericText(e.target.value) ?? 0) * 100)) } : x)))} />
            <Input aria-label="Observación" value={a.note} maxLength={200} placeholder="Observación (opcional)" style={{ width: 220 }} onChange={(e) => setRows((list) => list.map((x) => (x.id === a.id ? { ...x, note: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={13} />} aria-label="Quitar fila" title="Quitar fila" onClick={() => setRows((list) => list.filter((x) => x.id !== a.id))} />
          </div>
        ))}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setRows((list) => [...list, { id: newId(), conceptKey: targets[0].key, cents: undistributed, note: "" }])}>
            Agregar fila
          </Button>
          <Button size="sm" variant="primary" icon={<Save size={14} />} loading={busy} disabled={!dirty} onClick={() => void saveAdjustments()}>
            Guardar distribución
          </Button>
          {undistributed > 0 ? (
            <Badge tone="danger">Pendiente de distribuir {formatExactCents(undistributed)}: no viaja a EEFF</Badge>
          ) : b.casilla129Cents > 0 ? (
            <Badge tone="success">Casilla 129 distribuida</Badge>
          ) : null}
        </div>
        {warnings.length > 0 && <Alert tone="warning" items={warnings} />}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>

      <div className="table-wrap">
        <table className="table table--dense">
          <tbody>
            <tr>
              <td>Retenciones positivas (renta, IVA, timbre y autorretenciones)</td>
              <td className="num">{formatExactCents(b.positiveCents)}</td>
            </tr>
            <tr>
              <td>(−) Devoluciones y retenciones en exceso — casilla 129</td>
              <td className="num amount--negative">{formatExactCents(-b.casilla129Cents)}</td>
            </tr>
            <tr>
              <td>(+) Sanciones — casilla 137</td>
              <td className="num">{formatExactCents(b.sanctionCents)}</td>
            </tr>
            <tr className="fs-row--subtotal">
              <td>Total calculado</td>
              <td className="num">{formatExactCents(b.computedTotalCents)}</td>
            </tr>
            <tr>
              <td>Total declarado — casilla 138</td>
              <td className="num">{formatExactCents(b.formTotalCents)}</td>
            </tr>
            <tr>
              <td>Diferencia</td>
              <td className="num">{b.differenceCents === 0 ? <Badge tone="success">$0 · concilia</Badge> : <Badge tone="danger">{formatExactCents(b.differenceCents)}</Badge>}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
