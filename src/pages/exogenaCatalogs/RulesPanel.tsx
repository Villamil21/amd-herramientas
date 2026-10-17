import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Pencil, Search, Trash2 } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, EmptyState, Field, Input, Loader, Modal, Select, useToast } from "../../components/ui";
import { isAssignable } from "../../modules/financial-statements/puc-codes/services/pucCatalog";
import { useFsData } from "../../modules/financial-statements/shared/useFsData";
import { purchasesService } from "../../services/purchasesService";
import { errorMessage } from "../../services/tauri";
import { withholdingService } from "../../services/withholdingService";
import type { WithholdingRate } from "../../types/models";
import type { PurchaseRule, RuleHistory, YearConcept } from "../../types/purchases";
import { formatDateTimeForDisplay } from "../../utils/dates";
import { normalizeKey } from "../../utils/text";

/**
 * Reglas de clasificación de compras: lo aprendido por proveedor y producto (PUC, concepto 1001 y retención). Una regla solo se
 * propone —toda propuesta queda «Por confirmar»—; editarla o eliminarla no cambia las facturas ya confirmadas.
 */
export function RulesPanel() {
  const toast = useToast();
  const fs = useFsData();
  const [rules, setRules] = useState<PurchaseRule[] | null>(null);
  const [rates, setRates] = useState<WithholdingRate[]>([]);
  const [concepts, setConcepts] = useState<YearConcept[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PurchaseRule | null>(null);
  const [deleting, setDeleting] = useState<PurchaseRule | null>(null);
  const [history, setHistory] = useState<{ rule: PurchaseRule; rows: RuleHistory[] | null } | null>(null);

  const reload = useCallback(() => purchasesService.rules().then(setRules, (e) => toast(errorMessage(e), "error")), [toast]);
  useEffect(() => {
    void reload();
    withholdingService.listRates().then(setRates, (e) => toast(errorMessage(e), "error"));
    purchasesService.yearConcepts("1001", new Date().getFullYear()).then(setConcepts, (e) => toast(errorMessage(e), "error"));
  }, [reload, toast]);

  const rateName = (id: number) => rates.find((r) => r.id === id)?.name ?? "concepto eliminado";
  const q = normalizeKey(search);
  const visible = (rules ?? []).filter((r) => !q || normalizeKey(`${r.supplierNit} ${r.productLabel} ${r.pucCode} ${r.concept1001}`).includes(q));

  const openHistory = async (rule: PurchaseRule) => {
    setHistory({ rule, rows: null });
    try {
      setHistory({ rule, rows: await purchasesService.ruleHistory(rule.id) });
    } catch (e) {
      toast(errorMessage(e), "error");
      setHistory(null);
    }
  };
  const remove = async (r: PurchaseRule) => {
    try {
      await purchasesService.deleteRule(r.id);
      toast("Regla eliminada.");
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
        title="Reglas de clasificación de compras"
        description="Se crean al confirmar una línea con «recordar para este producto». Prioridad de la propuesta: regla del producto → sugerencia de la cuenta PUC → sugerencia general."
        actions={
          <div className="search">
            <Search size={14} />
            <Input placeholder="Buscar por NIT, producto, PUC o concepto" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
      >
        {rules === null ? (
          <Loader />
        ) : visible.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title="Sin reglas" description={rules.length ? "Ninguna regla coincide con la búsqueda." : "Aún no se ha guardado ninguna regla de clasificación."} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Proveedor (NIT)</th>
                  <th>Producto</th>
                  <th>PUC</th>
                  <th>Concepto 1001</th>
                  <th>Retención</th>
                  <th className="num">Usos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.supplierNit}</td>
                    <td className="table__primary">{r.productLabel}</td>
                    <td className="mono">{r.pucCode || "—"}</td>
                    <td className="mono">{r.concept1001 || "—"}</td>
                    <td>{r.retention.length ? r.retention.map((p) => rateName(p.rateId)).join(", ") : "—"}</td>
                    <td className="num">{r.uses}</td>
                    <td className="actions">
                      <Button variant="ghost" size="sm" iconOnly icon={<History size={14} />} aria-label="Historial" onClick={() => void openHistory(r)} />
                      <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => setEditing(r)} />
                      <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setDeleting(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RuleModal rule={editing} rates={rates} concepts={concepts} isValidPuc={(c) => isAssignable(fs.index, c)} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      <ConfirmDialog open={!!deleting} danger title="Eliminar regla" confirmLabel="Eliminar" message={<>Se elimina la regla de <strong>{deleting?.productLabel}</strong>. Las líneas ya confirmadas no cambian; las nuevas dejarán de recibir esta propuesta.</>} onCancel={() => setDeleting(null)} onConfirm={() => deleting && void remove(deleting)} />
      <Modal open={!!history} size="lg" title={`Historial de la regla · ${history?.rule.productLabel ?? ""}`} onClose={() => setHistory(null)} footer={<Button onClick={() => setHistory(null)}>Cerrar</Button>}>
        {!history?.rows ? (
          <Loader />
        ) : history.rows.length === 0 ? (
          <p className="muted">Sin cambios registrados.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>PUC</th>
                  <th>Concepto 1001</th>
                  <th>Retención</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDateTimeForDisplay(h.changedAt)}</td>
                    <td className="mono">{h.pucCode || "—"}</td>
                    <td className="mono">{h.concept1001 || "—"}</td>
                    <td>{h.retention.length ? h.retention.map((p) => rateName(p.rateId)).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}

function RuleModal({ rule, rates, concepts, isValidPuc, onClose, onSaved }: { rule: PurchaseRule | null; rates: WithholdingRate[]; concepts: YearConcept[]; isValidPuc: (code: string) => boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [puc, setPuc] = useState("");
  const [concept, setConcept] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!rule) return;
    setPuc(rule.pucCode);
    setConcept(rule.concept1001);
    setPicked(rule.retention.map((p) => p.rateId));
    setError(null);
  }, [rule]);
  const active = useMemo(() => concepts.filter((c) => c.isActive), [concepts]);
  const pucError = puc && !isValidPuc(puc) ? "El código no existe en la Tabla de Códigos PUC o no es una subcuenta asignable." : null;
  const submit = async () => {
    if (!rule) return;
    setSaving(true);
    setError(null);
    try {
      await purchasesService.updateRule(rule.id, puc.trim(), concept, picked.map((rateId) => ({ rateId })));
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={!!rule}
      size="sm"
      title={`Editar regla · ${rule?.productLabel ?? ""}`}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={!!pucError} onClick={() => void submit()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Código PUC" error={pucError ?? undefined}>{(id) => <Input id={id} value={puc} inputMode="numeric" invalid={!!pucError} onChange={(e) => setPuc(e.target.value.replace(/\D/g, ""))} />}</Field>
        <Field label="Concepto 1001" hint={`Catálogo ${new Date().getFullYear()}.`}>
          {(id) => (
            <Select id={id} value={concept} onChange={(e) => setConcept(e.target.value)}>
              <option value="">Sin concepto</option>
              {concept && !active.some((c) => c.code === concept) && <option value={concept}>{concept} (fuera del catálogo)</option>}
              {active.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.description}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="stack stack--sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label">Conceptos de retención</legend>
          {rates.map((r) => (
            <label key={r.id} className="checkbox">
              <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} /> {r.name}
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}
