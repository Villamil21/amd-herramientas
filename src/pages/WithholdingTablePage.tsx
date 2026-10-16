import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, Field, Input, Loader, Modal, PageHeader, SaveBar, Select, useToast } from "../components/ui";
import { SearchBox, SegmentedFilter } from "../modules/bank-analysis/shared/components/tableControls";
import { normalizeKey } from "../utils/text";
import { useAsync } from "../hooks/useAsync";
import { withholdingService } from "../services/withholdingService";
import { RETENTION_TYPE_LABEL, RETENTION_TYPES, type RetentionType, type WithholdingRate } from "../types/models";
import { formatInteger } from "../utils/format";
import { formatCop } from "../modules/taxes/invoice-vat/parser/amounts";
import { formatRateBp, formatUvt, minBaseCents, parseHundredths } from "../modules/taxes/withholding/services/money";

const rateText = (bp: number) => formatRateBp(bp).replace(/\s*%$/, "");

/** Pesos enteros escritos con o sin puntos de miles: "52.374" → 52374. */
function parseWholePesos(text: string): number | null {
  const t = text.trim().replace(/^\$\s*/, "");
  if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(t)) return null;
  const n = Number(t.replace(/\./g, ""));
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

/**
 * Datos → Tabla de retenciones: un valor UVT global por año (editable, con
 * histórico) y los conceptos con base UVT y tarifa editables. La base mínima
 * en pesos se calcula (Base UVT × Valor UVT del año) y no se edita.
 */
export function WithholdingTablePage() {
  const toast = useToast();
  const data = useAsync(() => Promise.all([withholdingService.listRates(), withholdingService.listUvt()]), []);
  const [rates, uvts] = data.data ?? [[], []];
  const [year, setYear] = useState<number | null>(null);
  const [uvtText, setUvtText] = useState("");
  const [newYear, setNewYear] = useState("");
  const [newValue, setNewValue] = useState("");
  const [savingUvt, setSavingUvt] = useState(false);
  const [edits, setEdits] = useState<Record<number, { base: string; rate: string }>>({});
  const [savingRates, setSavingRates] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<{ rate: WithholdingRate; usage: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState<RetentionType | "all">("all");
  const [query, setQuery] = useState("");

  // Año por defecto: el actual si existe, si no el más reciente.
  useEffect(() => {
    if (!data.data || (year !== null && uvts.some((u) => u.year === year))) return;
    const current = new Date().getFullYear();
    setYear(uvts.find((u) => u.year === current)?.year ?? uvts[uvts.length - 1]?.year ?? current);
  }, [data.data, uvts, year]);

  const uvt = uvts.find((u) => u.year === year);
  useEffect(() => setUvtText(uvt ? formatInteger(uvt.valuePesos) : ""), [uvt]);

  const parsedEdits = useMemo(
    () =>
      Object.entries(edits).map(([id, e]) => ({
        id: Number(id),
        baseUvtCenti: parseHundredths(e.base),
        rateBp: parseHundredths(e.rate),
      })),
    [edits],
  );
  const invalid = parsedEdits.some((e) => e.baseUvtCenti === null || e.rateBp === null || e.rateBp > 10_000);

  function edit(r: WithholdingRate, patch: Partial<{ base: string; rate: string }>) {
    setEdits((prev) => {
      const next = { ...(prev[r.id] ?? { base: formatUvt(r.baseUvtCenti), rate: rateText(r.rateBp) }), ...patch };
      const copy = { ...prev };
      if (parseHundredths(next.base) === r.baseUvtCenti && parseHundredths(next.rate) === r.rateBp) delete copy[r.id];
      else copy[r.id] = next;
      return copy;
    });
  }

  async function saveUvt(targetYear: number, text: string) {
    const value = parseWholePesos(text);
    if (value === null) return toast("Escribe el valor UVT en pesos (ej. 52.374).", "error");
    setSavingUvt(true);
    try {
      await withholdingService.saveUvt(targetYear, value);
      toast(`Valor UVT ${targetYear} guardado. Las bases mínimas se recalcularon.`);
      setYear(targetYear);
      setNewYear("");
      setNewValue("");
      await data.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingUvt(false);
    }
  }

  async function saveRates() {
    if (invalid) return toast("Revisa los valores: base UVT y tarifa deben ser números (hasta dos decimales).", "error");
    setSavingRates(true);
    try {
      await withholdingService.updateRates(parsedEdits.map((e) => ({ id: e.id, baseUvtCenti: e.baseUvtCenti!, rateBp: e.rateBp! })));
      toast("Tabla de retenciones guardada.");
      setEdits({});
      await data.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingRates(false);
    }
  }

  async function askDelete(rate: WithholdingRate) {
    try {
      setDeleting({ rate, usage: await withholdingService.countRateUsage(rate.id) });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await withholdingService.removeRate(deleting.rate.id);
      toast("Concepto eliminado.");
      setDeleting(null);
      await data.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...rates].sort((a, b) => RETENTION_TYPES.indexOf(a.retentionType) - RETENTION_TYPES.indexOf(b.retentionType) || a.sortOrder - b.sortOrder);
  const q = normalizeKey(query);
  const visible = sorted.filter((r) => (typeFilter === "all" || r.retentionType === typeFilter) && (!q || normalizeKey(r.name).includes(q)));
  const groups = RETENTION_TYPES.map((t) => ({ type: t, rows: visible.filter((r) => r.retentionType === t) })).filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Tabla de retenciones"
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>
            Nuevo concepto
          </Button>
        }
      />
      {data.error && <Alert tone="danger">{data.error}</Alert>}
      {data.loading && !data.data ? (
        <Loader />
      ) : (
        <>
          <Card>
            <div className="param-bar">
              <div className="param-bar__group">
                <Field label="UVT del año">
                  {(id) => (
                    <Select id={id} value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }}>
                      {uvts.map((u) => (
                        <option key={u.year} value={u.year}>
                          {u.year}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Valor">
                  {(id) => <Input id={id} value={uvtText} onChange={(e) => setUvtText(e.target.value)} placeholder="52.374" inputMode="numeric" style={{ width: 130 }} disabled={!uvt} />}
                </Field>
                <Button icon={<Save size={14} />} onClick={() => year !== null && void saveUvt(year, uvtText)} loading={savingUvt} disabled={!uvt || parseWholePesos(uvtText) === uvt?.valuePesos}>
                  Guardar
                </Button>
              </div>
              <span className="param-bar__sep" aria-hidden />
              <div className="param-bar__group">
                <Field label="Agregar año">
                  {(id) => <Input id={id} value={newYear} onChange={(e) => setNewYear(e.target.value)} placeholder={String((uvts[uvts.length - 1]?.year ?? 2026) + 1)} inputMode="numeric" style={{ width: 90 }} />}
                </Field>
                <Field label="Valor UVT">
                  {(id) => <Input id={id} value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Pesos" inputMode="numeric" style={{ width: 120 }} />}
                </Field>
                <Button
                  icon={<Plus size={14} />}
                  disabled={!/^\d{4}$/.test(newYear) || uvts.some((u) => u.year === Number(newYear)) || parseWholePesos(newValue) === null || savingUvt}
                  title={uvts.some((u) => u.year === Number(newYear)) ? "Ese año ya existe: edítalo a la izquierda." : undefined}
                  onClick={() => void saveUvt(Number(newYear), newValue)}
                >
                  Agregar
                </Button>
              </div>
              {uvts.length > 1 && <span className="muted" style={{ fontSize: "var(--text-sm)", alignSelf: "center" }}>Histórico: {uvts.map((u) => `${u.year} → ${formatCop(u.valuePesos * 100)}`).join(" · ")}</span>}
            </div>
          </Card>

          <Card flush title="Conceptos de retención" description={uvt ? `Base mínima = Base UVT × UVT ${uvt.year} (${formatCop(uvt.valuePesos * 100)}).` : "Registra el valor UVT para calcular las bases mínimas."}>
            <div className="table-toolbar">
              <SegmentedFilter
                label="Filtrar por tipo"
                value={typeFilter}
                onChange={setTypeFilter}
                options={[{ id: "all" as const, label: "Todos" }, ...RETENTION_TYPES.map((t) => ({ id: t, label: RETENTION_TYPE_LABEL[t] }))]}
              />
              <SearchBox placeholder="Buscar concepto" value={query} onChange={setQuery} />
            </div>
            <div className="table-wrap table-wrap--scroll">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Concepto / subtipo</th>
                    <th className="num">Base UVT</th>
                    <th className="num">Base mínima pesos</th>
                    <th className="num">Tarifa (%)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {groups.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                        Ningún concepto coincide con el filtro.
                      </td>
                    </tr>
                  )}
                  {groups.map((g) => (
                    <Fragment key={g.type}>
                      <tr className="table-group">
                        <td colSpan={5}>
                          {RETENTION_TYPE_LABEL[g.type]} · {g.rows.length}
                        </td>
                      </tr>
                      {g.rows.map((r) => {
                        const e = edits[r.id];
                        const base = e ? parseHundredths(e.base) : r.baseUvtCenti;
                        return (
                          <tr key={r.id} className={e ? "is-edited" : undefined}>
                            <td className="table__primary">{r.name}</td>
                            <td className="num" style={{ width: 110 }}>
                              <Input aria-label={`Base UVT de ${r.name}`} className="input--right" value={e?.base ?? formatUvt(r.baseUvtCenti)} onChange={(ev) => edit(r, { base: ev.target.value })} invalid={e !== undefined && base === null} inputMode="decimal" />
                            </td>
                            <td className="num" style={{ whiteSpace: "nowrap", width: 160 }}>{uvt && base !== null ? formatCop(minBaseCents(base, uvt.valuePesos)) : "—"}</td>
                            <td className="num" style={{ width: 110 }}>
                              <Input aria-label={`Tarifa de ${r.name}`} className="input--right" value={e?.rate ?? rateText(r.rateBp)} onChange={(ev) => edit(r, { rate: ev.target.value })} invalid={e !== undefined && (parseHundredths(e.rate) === null || parseHundredths(e.rate)! > 10_000)} inputMode="decimal" />
                            </td>
                            <td className="actions">
                              <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" title="Eliminar concepto" onClick={() => void askDelete(r)} />
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <SaveBar count={Object.keys(edits).length} saving={savingRates} disabled={invalid} onSave={() => void saveRates()} onDiscard={() => setEdits({})} />
        </>
      )}

      <NewRateModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          void data.reload();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Eliminar concepto"
        confirmLabel="Eliminar"
        loading={busy}
        message={
          <>
            Se eliminará <strong>{deleting?.rate.name}</strong>.
            {deleting && deleting.usage > 0
              ? ` ${deleting.usage === 1 ? "1 regla de proveedor lo usa" : `${deleting.usage} reglas de proveedores lo usan`}: esos documentos quedarán con error de configuración hasta que cambies la regla del proveedor.`
              : " Ningún proveedor lo usa."}
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

function NewRateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<RetentionType | "">("");
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType("");
    setName("");
    setBase("");
    setRate("");
    setError(null);
  }, [open]);

  async function save() {
    const baseUvtCenti = parseHundredths(base);
    const rateBp = parseHundredths(rate);
    if (!type || !name.trim()) return setError("Selecciona el tipo y escribe el concepto.");
    if (baseUvtCenti === null || rateBp === null || rateBp > 10_000) return setError("Base UVT y tarifa deben ser números (hasta dos decimales).");
    setSaving(true);
    try {
      await withholdingService.createRate({ retentionType: type, name: name.trim(), baseUvtCenti, rateBp });
      toast("Concepto agregado.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Nuevo concepto de retención"
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Agregar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-grid">
          <Field label="Tipo" required>
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as RetentionType)}>
                <option value="" disabled>
                  Selecciona…
                </option>
                {RETENTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RETENTION_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Base UVT" required>
            {(id) => <Input id={id} value={base} onChange={(e) => setBase(e.target.value)} placeholder="2" inputMode="decimal" />}
          </Field>
        </div>
        <Field label="Concepto" required>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Tarifa (%)" required>
          {(id) => <Input id={id} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="4" inputMode="decimal" style={{ width: 140 }} />}
        </Field>
      </div>
    </Modal>
  );
}
