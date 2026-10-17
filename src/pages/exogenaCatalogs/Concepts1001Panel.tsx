import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, History, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, DateInput, EmptyState, Field, Input, Loader, Modal, Select, useToast } from "../../components/ui";
import { purchasesService } from "../../services/purchasesService";
import { errorMessage } from "../../services/tauri";
import type { YearConcept, YearConceptAudit } from "../../types/purchases";
import { formatDateText, formatDateTimeForDisplay } from "../../utils/dates";

const FORMAT = "1001";
const ACTION_LABEL: Record<YearConceptAudit["action"], string> = { add: "Agregó", edit: "Editó", activate: "Activó", deactivate: "Desactivó", delete: "Eliminó", copy: "Copió" };

const yearOptions = () => {
  const y = new Date().getFullYear();
  return Array.from({ length: 7 }, (_, i) => y + 1 - i);
};

/**
 * Conceptos del formato 1001 por año gravable. Cada año tiene su propio catálogo con vigencia: el de 2025 viene de sistema y el
 * de 2026 es una copia editable. Un concepto solo se elimina si ninguna línea de compra lo usa; si no, se desactiva.
 */
export function Concepts1001Panel() {
  const toast = useToast();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [rows, setRows] = useState<YearConcept[] | null>(null);
  const [editing, setEditing] = useState<{ row: YearConcept | null } | null>(null);
  const [deleting, setDeleting] = useState<YearConcept | null>(null);
  const [copying, setCopying] = useState(false);
  const [audit, setAudit] = useState<YearConceptAudit[] | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRows(await purchasesService.yearConcepts(FORMAT, year));
      if (showAudit) setAudit(await purchasesService.yearConceptAudit(FORMAT, year));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [year, showAudit, toast]);
  useEffect(() => {
    setRows(null);
    void reload();
  }, [reload]);

  const toggle = async (r: YearConcept) => {
    try {
      await purchasesService.saveYearConcept({ formatCode: FORMAT, year: r.year, code: r.code, description: r.description, validFrom: r.validFrom, validTo: r.validTo, isActive: !r.isActive });
      await reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const remove = async (r: YearConcept) => {
    try {
      await purchasesService.deleteYearConcept(FORMAT, r.year, r.code);
      toast("Concepto eliminado.");
      await reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
    setDeleting(null);
  };

  return (
    <>
      <Card
        flush
        title="Conceptos del formato 1001"
        description="Catálogo por año con vigencia. Las líneas de compra usan el concepto vigente en la fecha de la factura."
        actions={
          <>
            <Select aria-label="Año gravable" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <Button icon={<History size={15} />} onClick={() => setShowAudit((v) => !v)}>
              {showAudit ? "Ocultar historial" : "Historial"}
            </Button>
            <Button icon={<Copy size={15} />} onClick={() => setCopying(true)}>
              Copiar de otro año
            </Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing({ row: null })}>
              Agregar concepto
            </Button>
          </>
        }
      >
        {rows === null ? (
          <Loader />
        ) : rows.length === 0 ? (
          <EmptyState title={`Sin conceptos para ${year}`} description="Copia el catálogo de otro año y ajústalo, o agrega conceptos uno a uno." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Descripción</th>
                  <th>Vigente desde</th>
                  <th>Hasta</th>
                  <th>Origen</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td className="mono">{r.code}</td>
                    <td className="table__primary">{r.description}</td>
                    <td>{formatDateText(r.validFrom)}</td>
                    <td>{r.validTo ? formatDateText(r.validTo) : "—"}</td>
                    <td>
                      <Badge tone={r.isSystem ? "dark" : "gold"}>{r.isSystem ? "Sistema" : "Propio"}</Badge>
                    </td>
                    <td>{r.isActive ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                    <td className="actions">
                      <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => setEditing({ row: r })} />
                      <Button variant="ghost" size="sm" onClick={() => void toggle(r)}>
                        {r.isActive ? "Desactivar" : "Activar"}
                      </Button>
                      {!r.isSystem && <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setDeleting(r)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showAudit && (
        <Card flush title="Historial de ajustes" description={`Cambios al catálogo 1001 de ${year}.`}>
          {audit === null ? (
            <Loader />
          ) : audit.length === 0 ? (
            <EmptyState icon={<History size={20} />} title="Sin ajustes" description="El catálogo está como se creó." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th>Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td>{formatDateTimeForDisplay(a.changedAt)}</td>
                      <td className="mono">{a.code}</td>
                      <td>
                        {ACTION_LABEL[a.action]}
                        {a.oldValue ? ` «${a.oldValue}»` : ""}
                        {a.newValue ? ` → «${a.newValue}»` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <ConceptModal open={!!editing} year={year} row={editing?.row ?? null} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      <CopyModal open={copying} toYear={year} onClose={() => setCopying(false)} onCopied={async () => { setCopying(false); await reload(); }} />
      <ConfirmDialog open={!!deleting} danger title="Eliminar concepto" confirmLabel="Eliminar" message={<>Se eliminará <strong>{deleting?.code} — {deleting?.description}</strong>. Si alguna línea de compra lo usa, desactívalo en su lugar.</>} onCancel={() => setDeleting(null)} onConfirm={() => deleting && void remove(deleting)} />
    </>
  );
}

function ConceptModal({ open, year, row, onClose, onSaved }: { open: boolean; year: number; row: YearConcept | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCode(row?.code ?? "");
    setDescription(row?.description ?? "");
    setValidFrom(row?.validFrom ?? `${year}-01-01`);
    setValidTo(row?.validTo ?? "");
    setActive(row?.isActive ?? true);
    setError(null);
  }, [open, row, year]);
  const valid = useMemo(() => /^(\d{4}|\d{4} a \d{4})$/.test(code) && (!code.includes(" a ") || code.slice(0, 4) < code.slice(-4)) && description.trim() !== "" && validFrom !== "" && (!validTo || validTo >= validFrom), [code, description, validFrom, validTo]);
  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await purchasesService.saveYearConcept({ formatCode: FORMAT, year, code: code.trim(), description: description.trim(), validFrom, validTo, isActive: active });
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      size="sm"
      title={row ? `Editar concepto ${row.code}` : `Agregar concepto (${year})`}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void submit()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Código" required hint="4 dígitos, ej. 5001, o un solo concepto que abarca un rango, ej. «5029 a 5035». Se guarda como texto.">{(id) => <Input id={id} value={code} readOnly={!!row} onChange={(e) => setCode(e.target.value.replace(/[^\d a]/g, "").slice(0, 11))} />}</Field>
        <Field label="Descripción" required>{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <Field label="Vigente desde" required>{(id) => <DateInput id={id} value={validFrom} onChange={setValidFrom} />}</Field>
        <Field label="Vigente hasta" hint="Vacío = sin fecha final.">{(id) => <DateInput id={id} value={validTo} onChange={setValidTo} />}</Field>
        <label className="checkbox">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activo (se ofrece al elegir)
        </label>
      </div>
    </Modal>
  );
}

function CopyModal({ open, toYear, onClose, onCopied }: { open: boolean; toYear: number; onClose: () => void; onCopied: () => Promise<void> }) {
  const toast = useToast();
  const [from, setFrom] = useState(toYear - 1);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setFrom(toYear - 1);
  }, [open, toYear]);
  const submit = async () => {
    setBusy(true);
    try {
      const n = await purchasesService.copyYearConcepts(FORMAT, from, toYear);
      toast(n === 0 ? "No había conceptos nuevos que copiar." : `${n} ${n === 1 ? "concepto copiado" : "conceptos copiados"} a ${toYear}.`);
      await onCopied();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      size="sm"
      title={`Copiar conceptos a ${toYear}`}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} disabled={from === toYear} onClick={() => void submit()}>
            Copiar
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Copiar desde" hint="Los conceptos copiados quedan como propios y editables. Los que ya existan en el año destino no se tocan.">
          {(id) => (
            <Select id={id} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              {yearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
