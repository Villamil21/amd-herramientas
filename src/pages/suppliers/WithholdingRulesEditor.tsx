import { Plus, Trash2 } from "lucide-react";
import { Button, Select } from "../../components/ui";
import { BASE_MODE_LABEL, RETENTION_TYPE_LABEL, RETENTION_TYPES, type BaseMode, type RetentionType, type Supplier, type WithholdingRate } from "../../types/models";

export interface RuleDraft {
  key: number;
  retentionType: RetentionType | "";
  rateId: number | "";
  baseMode: BaseMode | "";
  isDefault: boolean;
}

let nextKey = 1;
export const emptyRule = (): RuleDraft => ({ key: nextKey++, retentionType: "", rateId: "", baseMode: "", isDefault: false });

/** Reglas guardadas del proveedor → filas editables (al menos una fila vacía). */
export function rulesFromSupplier(supplier: Supplier | null | undefined, rates: WithholdingRate[]): RuleDraft[] {
  const byId = new Map(rates.map((r) => [r.id, r]));
  const saved = (supplier?.withholdingRules ?? []).map((r) => ({
    key: nextKey++,
    retentionType: byId.get(r.rateId)?.retentionType ?? ("" as const),
    rateId: byId.has(r.rateId) ? r.rateId : ("" as const),
    baseMode: r.baseMode,
    isDefault: r.isDefault,
  }));
  return saved.length ? saved : [emptyRule()];
}

/** Filas con algo escrito; error si alguna está incompleta o repite subtipo. */
export function completeRules(rules: RuleDraft[]): { rules: { rateId: number; baseMode: BaseMode; isDefault: boolean }[]; error?: string } {
  const complete = rules.filter((r) => r.retentionType || r.rateId || r.baseMode);
  if (complete.some((r) => !r.retentionType || !r.rateId || !r.baseMode)) return { rules: [], error: "Cada regla debe tener tipo, subtipo y modo de base." };
  if (new Set(complete.map((r) => r.rateId)).size !== complete.length) return { rules: [], error: "Hay un subtipo repetido." };
  return { rules: complete.map((r) => ({ rateId: r.rateId as number, baseMode: r.baseMode as BaseMode, isDefault: complete.length === 1 || r.isDefault })) };
}

/** Tabla de reglas de retención (tipo → subtipo → base), con la predeterminada cuando hay varias. */
export function WithholdingRulesEditor({ rules, onChange, rates }: { rules: RuleDraft[]; onChange: (rules: RuleDraft[]) => void; rates: WithholdingRate[] }) {
  const update = (key: number, patch: Partial<RuleDraft>) => onChange(rules.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setDefault = (key: number) => onChange(rules.map((r) => ({ ...r, isDefault: r.key === key ? !r.isDefault : false })));
  const filled = rules.filter((r) => r.rateId).length;
  return (
    <div className="stack stack--sm">
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Subtipo</th>
              <th>Base de retención</th>
              {filled > 1 && <th>Predet.</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.key}>
                <td style={{ width: 160 }}>
                  <Select aria-label="Tipo de retención" value={r.retentionType} onChange={(e) => update(r.key, { retentionType: e.target.value as RetentionType, rateId: "" })}>
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {RETENTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {RETENTION_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  <Select aria-label="Subtipo" value={r.rateId} disabled={!r.retentionType} onChange={(e) => update(r.key, { rateId: Number(e.target.value) })}>
                    <option value="" disabled>
                      {r.retentionType ? "Selecciona…" : "Elige primero el tipo"}
                    </option>
                    {rates
                      .filter((x) => x.retentionType === r.retentionType)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </Select>
                </td>
                <td style={{ width: 230 }}>
                  <Select aria-label="Modo de base" value={r.baseMode} onChange={(e) => update(r.key, { baseMode: e.target.value as BaseMode })}>
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {(Object.keys(BASE_MODE_LABEL) as BaseMode[]).map((m) => (
                      <option key={m} value={m}>
                        {BASE_MODE_LABEL[m]}
                      </option>
                    ))}
                  </Select>
                </td>
                {filled > 1 && (
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" aria-label="Regla predeterminada" checked={r.isDefault} onChange={() => setDefault(r.key)} />
                  </td>
                )}
                <td className="actions">
                  <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Quitar regla" disabled={rules.length === 1} onClick={() => onChange(rules.filter((x) => x.key !== r.key))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row row--between">
        <span className="field__hint">«Base diferente / manual» pide la base en cada factura.{filled > 1 && " La predeterminada queda marcada de entrada en cada factura."}</span>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => onChange([...rules, emptyRule()])}>
          Agregar regla
        </Button>
      </div>
    </div>
  );
}
