import { Fragment, useEffect, useRef, useState } from "react";
import { Check, Minus } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Loader, Modal, Select, Textarea, useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import type { Adjustment, AdjustmentType, BatchSummary, FsPucMapping } from "../../../types/fs";
import { formatInteger } from "../../../utils/format";
import { parseNumericText } from "../../../utils/numbers";
import type { PucIndex } from "../puc-codes/services/pucCatalog";
import { PucField } from "../shared/components/PucField";
import { formatExactCents, formatIsoDate, formatStatementPesos, periodLabel } from "../shared/money";
import type { CoverageRow } from "./checks";
import type { LineValue, StatementRow } from "./engine";

/** Estado en la app: valores al millar (como en el PDF) y, al abrir una línea, el exacto y su origen por PUC. */
export function StatementView({ title, rows, lines }: { title: string; rows: StatementRow[]; lines: Map<number, LineValue> }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="fs-statement">
      <div className="fs-statement__title">{title}</div>
      <table className="table fs-statement__table">
        <thead>
          <tr>
            <th />
            <th style={{ width: 70, textAlign: "center" }}>NOTA</th>
            <th style={{ width: 160, textAlign: "right" }}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.kind === "gap") return <tr key={i} className="fs-row--gap"><td colSpan={3} /></tr>;
            const detail = r.lineId !== undefined ? lines.get(r.lineId) : undefined;
            return (
              <Fragment key={i}>
                <tr className={`fs-row--${r.kind}${detail ? " is-clickable" : ""}`} onClick={detail ? () => setOpen(open === r.lineId ? null : r.lineId!) : undefined} title={r.cents !== undefined ? `Exacto: ${formatExactCents(r.cents)}` : undefined}>
                  <td>{r.label}</td>
                  <td />
                  <td style={{ textAlign: "right" }} className={r.pesos !== undefined && r.pesos < 0 ? "amount--negative" : undefined}>
                    {r.pesos !== undefined ? formatStatementPesos(r.pesos) : ""}
                  </td>
                </tr>
                {detail && open === r.lineId && (
                  <tr className="fs-row--detail">
                    <td colSpan={3}>
                      <div className="stack stack--sm">
                        <span className="muted">Exacto: {formatExactCents(detail.cents)}{detail.automatic ? ` · Automático: ${detail.automatic}` : ""}</span>
                        {detail.contributions.map((c) => (
                          <span key={c.pucCode} className="muted">
                            <span className="mono">{c.pucCode}</span> {c.concept} · {formatInteger(c.count)} mov. · {formatExactCents(c.cents)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Fuentes del periodo y cobertura mensual: ✓ cargado / — falta. Clic en un mes: sus importaciones. */
export function CoverageTable({ months, rows }: { months: string[]; rows: CoverageRow[] }) {
  const [cell, setCell] = useState<{ row: CoverageRow; month: string } | null>(null);
  const detail = cell ? cell.row.cells[cell.month] : null;
  return (
    <>
      <div className="table-wrap">
        <table className="table fs-coverage">
          <thead>
            <tr>
              <th>Fuente</th>
              {months.map((m) => (
                <th key={m} style={{ textAlign: "center" }}>
                  {periodLabel(m).slice(0, 3)} {m.slice(2, 4)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source}>
                <td>
                  {r.label}
                  {!r.empty && r.missing.length > 0 && <div className="table__secondary">Faltan: {r.missing.map((m) => periodLabel(m).split(" ")[0]).join(", ")}</div>}
                </td>
                {months.map((m) => {
                  const c = r.cells[m];
                  return (
                    <td key={m} style={{ textAlign: "center" }}>
                      <button type="button" className={`fs-coverage__cell ${c.loaded ? "is-loaded" : ""}`} onClick={() => setCell({ row: r, month: m })} aria-label={`${r.label} ${periodLabel(m)}: ${c.loaded ? "cargado" : "falta"}`}>
                        {c.loaded ? <Check size={14} /> : <Minus size={14} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={cell !== null} title={cell ? `${cell.row.label} · ${periodLabel(cell.month)}` : ""} onClose={() => setCell(null)} size="lg">
        {detail && (detail.batches.length === 0 ? <p className="muted">No hay información de este mes.</p> : <BatchTable batches={detail.batches} />)}
      </Modal>
    </>
  );
}

export function BatchTable({ batches }: { batches: BatchSummary[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Importación</th>
            <th>Archivo / lote</th>
            <th>Fecha de importación</th>
            <th style={{ textAlign: "right" }}>Registros</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td>#{b.id}</td>
              <td>{[b.fileName, b.periodLabel].filter(Boolean).join(" · ") || "—"}</td>
              <td>{b.createdAt.slice(0, 10)}</td>
              <td style={{ textAlign: "right" }}>{formatInteger(b.recordCount)}</td>
              <td>{b.status === "active" ? <Badge tone="success">Activo</Badge> : b.status === "replaced" ? <Badge tone="warning">Reemplazado{b.replacedBy ? ` por #${b.replacedBy}` : ""}</Badge> : <Badge>Anulado</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dibuja todas las páginas del PDF real con pdf.js (lo que se ve es exactamente lo que se exporta). */
export function PdfPages({ bytes, width = 560 }: { bytes: Uint8Array | null; width?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  useEffect(() => {
    if (!bytes || !holder.current) return;
    let current = true;
    const target = holder.current;
    target.innerHTML = "";
    (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      }
      const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, useWorkerFetch: false, verbosity: 0 });
      try {
        const pdf = await task.promise;
        if (current) setPages(pdf.numPages);
        for (let n = 1; n <= pdf.numPages && current; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const ratio = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          canvas.className = "fs-preview__page";
          canvas.style.width = `${width}px`;
          canvas.setAttribute("aria-label", n === 1 ? "Página 1: Estado de Situación Financiera" : "Página 2: Estado de Resultados");
          await page.render({ canvas, viewport }).promise;
          if (current) target.appendChild(canvas);
        }
      } finally {
        await task.destroy();
      }
    })().catch((e) => current && setError((e as Error).message || "No se pudo mostrar la vista previa."));
    return () => {
      current = false;
    };
  }, [bytes, width]);
  return (
    <div className="stack stack--sm" style={{ alignItems: "center" }}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!bytes && <Loader />}
      {pages > 2 && <Alert tone="danger">El PDF tiene {pages} páginas: no se puede generar.</Alert>}
      <div ref={holder} className="fs-preview" />
    </div>
  );
}

interface AdjustmentProps {
  open: boolean;
  companyId: number;
  editing: Adjustment | null;
  defaultDate: string;
  index: PucIndex;
  mappings: Map<string, FsPucMapping>;
  /** Valor exacto actual de un PUC (para «Valor anterior»). */
  balanceOf: (pucCode: string) => number;
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
  onCodesChanged: () => Promise<unknown>;
}

/** Ajuste manual con trazabilidad: nunca se edita un total directamente. */
export function AdjustmentModal({ open, companyId, editing, defaultDate, index, mappings, balanceOf, onClose, onSaved, onCodesChanged }: AdjustmentProps) {
  const toast = useToast();
  const [puc, setPuc] = useState<string | undefined>();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [type, setType] = useState<AdjustmentType>("replace");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPuc(editing?.pucCode);
    setDate(editing?.accountingDate ?? defaultDate);
    setReason(editing?.reason ?? "");
    setType(editing?.adjustmentType ?? "replace");
    setValue(editing ? (editing.inputCents / 100).toFixed(2).replace(".", ",") : "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // Valor anterior: el saldo actual sin el efecto de este mismo ajuste.
  const previous = puc ? balanceOf(puc) - (editing && editing.pucCode === puc ? editing.finalCents - editing.previousCents : 0) : 0;
  const input = parseNumericText(value);
  const inputCents = input === null ? null : Math.round(input * 100);
  const finalCents = inputCents === null ? null : type === "replace" ? inputCents : previous + inputCents;
  const ready = puc && /^\d{4}-\d{2}-\d{2}$/.test(date) && reason.trim() && inputCents !== null;

  async function save() {
    if (!ready || !puc || inputCents === null) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { companyId, accountingDate: date, pucCode: puc, reason, previousCents: previous, adjustmentType: type, inputCents };
      if (editing) await fsService.updateAdjustment(editing.id, payload);
      else await fsService.createAdjustment(payload);
      toast(editing ? "Ajuste actualizado (se guardó el valor anterior en su historial)." : "Ajuste creado.");
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={editing ? "Editar ajuste" : "Nuevo ajuste"}
      description="El ajuste queda registrado con su motivo, el valor anterior y el valor final."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!ready}>
            {editing ? "Guardar cambios" : "Crear ajuste"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Código PUC" required className="span-2">
            {() => <PucField index={index} value={puc} onChange={setPuc} mappings={mappings} onCodesChanged={onCodesChanged} />}
          </Field>
          <Field label="Fecha contable" required>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Tipo de ajuste" required>
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as AdjustmentType)}>
                <option value="replace">Reemplazar valor</option>
                <option value="delta">Sumar / restar diferencia</option>
              </Select>
            )}
          </Field>
          <Field label="Valor anterior" hint="Saldo exacto actual de la cuenta en el periodo.">{(id) => <Input id={id} value={formatExactCents(previous)} disabled />}</Field>
          <Field label={type === "replace" ? "Debe quedar en" : "Diferencia (+ / −)"} required>
            {(id) => <Input id={id} className="input--right" value={value} onChange={(e) => setValue(e.target.value)} invalid={value.trim() !== "" && inputCents === null} placeholder={type === "replace" ? "10.000.000" : "+6.000.000"} />}
          </Field>
          <Field label="Valor final">{(id) => <Input id={id} value={finalCents === null ? "—" : formatExactCents(finalCents)} disabled />}</Field>
          <Field label="Motivo" required className="span-2">{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
        {editing && editing.history.length > 0 && (
          <div className="field__hint">
            Historial: {editing.history.map((h) => `${formatIsoDate(h.editedAt.slice(0, 10))}: final ${formatExactCents(Number(h.previous.finalCents ?? 0))}`).join(" · ")}
          </div>
        )}
      </div>
    </Modal>
  );
}
