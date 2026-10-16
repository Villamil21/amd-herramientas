import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, EmptyState, Field, Input, Loader, Modal, PageHeader, SaveBar, useToast } from "../components/ui";
import { SearchBox, SegmentedFilter } from "../modules/bank-analysis/shared/components/tableControls";
import { useAsync } from "../hooks/useAsync";
import { selfWithholdingService } from "../services/selfWithholdingService";
import type { SelfWithholdingRate } from "../types/models";
import { formatInteger } from "../utils/format";
import { normalizeKey } from "../utils/text";
import { isValidCiiuInput, normalizeCiiu } from "../modules/taxes/sales-withholding/services/ciiu";
import { formatRateBp, parseHundredths } from "../modules/taxes/withholding/services/money";

const rateText = (bp: number) => formatRateBp(bp, true).replace(/\s*%$/, "");
const validRate = (bp: number | null): bp is number => bp !== null && bp <= 10_000;

/**
 * Datos → Tabla de Autorretenciones: código CIIU → tarifa de autorretención.
 * Se sembró una sola vez con el art. 1.2.6.8 (Decreto 572 de 2025); desde
 * entonces la tabla local es la fuente del cálculo y las tarifas son editables.
 *
 * `initialSearch`: código a buscar al abrir (desde Retención en la fuente ventas).
 */
export function SelfWithholdingTablePage({ initialSearch = "" }: { initialSearch?: string }) {
  const toast = useToast();
  const data = useAsync(() => selfWithholdingService.listRates(), []);
  const rates = data.data ?? [];
  const [search, setSearch] = useState(initialSearch);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<SelfWithholdingRate | null>(null);
  const [busy, setBusy] = useState(false);
  const [rateFilter, setRateFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  /** Tarifas distintas del catálogo, para filtrar por tarifa. */
  const rateOptions = useMemo(() => [...new Set(rates.map((r) => r.rateBp))].sort((a, b) => a - b), [rates]);

  const visible = useMemo(() => {
    const q = normalizeKey(search);
    const digits = /^\d+$/.test(q) ? q : "";
    const lo = from.trim() ? normalizeCiiu(from.trim()) : "";
    const hi = to.trim() ? normalizeCiiu(to.trim()) : "";
    return rates.filter(
      (r) =>
        (rateFilter === "all" || String(r.rateBp) === rateFilter) &&
        (!lo || r.normalizedCode >= lo) &&
        (!hi || r.normalizedCode <= hi) &&
        (!q || (digits && (r.normalizedCode.includes(digits) || r.ciiuCode.includes(digits) || normalizeCiiu(digits) === r.normalizedCode)) || normalizeKey(r.economicActivity).includes(q)),
    );
  }, [rates, search, rateFilter, from, to]);

  const parsed = Object.entries(edits).map(([id, text]) => ({ id: Number(id), rateBp: parseHundredths(text) }));
  const invalid = parsed.some((e) => !validRate(e.rateBp));

  function edit(r: SelfWithholdingRate, text: string) {
    setEdits((prev) => {
      const copy = { ...prev };
      if (parseHundredths(text) === r.rateBp) delete copy[r.id];
      else copy[r.id] = text;
      return copy;
    });
  }

  async function save() {
    if (invalid) return toast("Revisa las tarifas: deben ser porcentajes entre 0 y 100 (hasta dos decimales).", "error");
    setSaving(true);
    try {
      await selfWithholdingService.updateRates(parsed.map((e) => ({ id: e.id, rateBp: e.rateBp! })));
      toast(parsed.length === 1 ? "Tarifa guardada." : `${parsed.length} tarifas guardadas.`);
      setEdits({});
      await data.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await selfWithholdingService.removeRate(deleting.id);
      toast("Código eliminado.");
      setEdits(({ [deleting.id]: _, ...rest }) => rest);
      setDeleting(null);
      await data.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Tabla de Autorretenciones"
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>
            Nuevo código
          </Button>
        }
      />
      {data.error && <Alert tone="danger">{data.error}</Alert>}
      {data.loading && !data.data ? (
        <Loader />
      ) : (
        <>
          <Card flush title="Códigos CIIU" description={`Fuente inicial: Decreto 572 de 2025 — Art. 1.2.6.8 · ${formatInteger(visible.length)} de ${formatInteger(rates.length)} códigos`}>
            <div className="table-toolbar">
              <SegmentedFilter
                label="Filtrar por tarifa"
                value={rateFilter}
                onChange={setRateFilter}
                options={[{ id: "all", label: "Todas" }, ...rateOptions.map((bp) => ({ id: String(bp), label: formatRateBp(bp, true) }))]}
              />
              <div className="row" style={{ gap: 8 }}>
                <Input aria-label="Código desde" placeholder="Desde" value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" style={{ width: 84 }} />
                <Input aria-label="Código hasta" placeholder="Hasta" value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" style={{ width: 84 }} />
                <SearchBox placeholder="Código o actividad" value={search} onChange={setSearch} />
              </div>
            </div>
            {visible.length === 0 ? (
              <EmptyState icon={<Search size={20} />} title="Sin resultados" description="Ningún código coincide con los filtros. Si falta un código, agrégalo con «Nuevo código»." />
            ) : (
              <div className="table-wrap table-wrap--scroll">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>CIIU</th>
                      <th>Actividad económica</th>
                      <th className="num" style={{ width: 110 }}>
                        Tarifa (%)
                      </th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const text = edits[r.id];
                      return (
                        <tr key={r.id} className={text !== undefined ? "is-edited" : undefined}>
                          <td className="table__primary selectable mono" title={r.ciiuCode !== r.normalizedCode ? `En la fuente: ${r.ciiuCode}` : undefined}>
                            {r.normalizedCode}
                          </td>
                          <td className="ciiu-activity">
                            {r.economicActivity || <span className="muted">—</span>}
                            {r.source && !r.source.includes("Decreto") && <span className="badge badge--gold" style={{ marginLeft: 6 }}>Personalizado</span>}
                          </td>
                          <td className="num">
                            <Input
                              aria-label={`Tarifa del código ${r.normalizedCode}`}
                              className="input--right input--sm"
                              value={text ?? rateText(r.rateBp)}
                              onChange={(e) => edit(r, e.target.value)}
                              invalid={text !== undefined && !validRate(parseHundredths(text))}
                              inputMode="decimal"
                            />
                          </td>
                          <td className="actions">
                            <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label={`Eliminar el código ${r.normalizedCode}`} title="Eliminar código" onClick={() => setDeleting(r)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <SaveBar count={parsed.length} saving={saving} disabled={invalid} onSave={() => void save()} onDiscard={() => setEdits({})} />
        </>
      )}

      <NewCodeModal
        open={adding}
        initialCode={/^\d+$/.test(search.trim()) ? search.trim() : ""}
        onClose={() => setAdding(false)}
        onSaved={(code) => {
          setAdding(false);
          setSearch(code);
          void data.reload();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Eliminar código"
        confirmLabel="Eliminar"
        loading={busy}
        message={
          <>
            Se eliminará el código <strong>{deleting?.normalizedCode}</strong> ({deleting && formatRateBp(deleting.rateBp, true)}). Las empresas con ese Código CIIU quedarán con un
            pendiente en Retención en la fuente ventas hasta que lo vuelvas a agregar.
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

function NewCodeModal({ open, initialCode, onClose, onSaved }: { open: boolean; initialCode: string; onClose: () => void; onSaved: (code: string) => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [activity, setActivity] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(initialCode);
    setActivity("");
    setRate("");
    setError(null);
    // `initialCode` solo se aplica al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    const rateBp = parseHundredths(rate);
    if (!isValidCiiuInput(code)) return setError("Escribe el Código CIIU con números (ej. 6201 o 0111).");
    if (!validRate(rateBp)) return setError("La tarifa debe ser un porcentaje entre 0 y 100 (hasta dos decimales).");
    setSaving(true);
    try {
      await selfWithholdingService.createRate({ ciiuCode: code.trim(), economicActivity: activity.trim(), rateBp });
      toast("Código agregado.");
      onSaved(normalizeCiiu(code));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Nuevo código CIIU"
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
          <Field label="Código CIIU" required>
            {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6201" inputMode="numeric" autoFocus />}
          </Field>
          <Field label="Tarifa (%)" required>
            {(id) => <Input id={id} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="1,10" inputMode="decimal" />}
          </Field>
        </div>
        <Field label="Actividad económica">
          {(id) => <Input id={id} value={activity} onChange={(e) => setActivity(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}
