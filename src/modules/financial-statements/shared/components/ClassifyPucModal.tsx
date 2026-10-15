import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Alert, Button, Modal, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import { EERR_SECTIONS, ESF_SECTIONS, SECTION_LABEL, type FsCatalog, type FsLine, type FsPucMapping, type FsSectionKey } from "../../../../types/fs";

/** «ESF › ACTIVO CORRIENTE › Disponible». */
export function lineLabel(line: FsLine): string {
  return `${ESF_SECTIONS.includes(line.section) ? "ESF" : "EERR"} › ${SECTION_LABEL[line.section]} › ${line.name}`;
}

/** Mapeo vigente más cercano de un padre (110505 para 11050501). Solo sugerencia. */
export function parentMapping(code: string, mappings: Map<string, FsPucMapping>): { parent: string; mapping: FsPucMapping } | undefined {
  for (let n = code.length - 1; n >= 1; n--) {
    const m = mappings.get(code.slice(0, n));
    if (m) return { parent: code.slice(0, n), mapping: m };
  }
  return undefined;
}

interface Props {
  open: boolean;
  pucCode: string;
  concept: string;
  catalog: FsCatalog | null;
  mappings: Map<string, FsPucMapping>;
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
}

/**
 * «Este código PUC todavía no está clasificado.» Asignar a una línea del ESF /
 * EERR o marcar «No afecta Estados Financieros». La clasificación de un padre
 * se muestra como sugerencia, nunca se aplica sola.
 */
type Group = "asset" | "liability" | "equity" | "eerr" | "excluded";

/** Nivel 1 → secciones del catálogo que agrupa (nivel 2). Patrimonio va directo a sus líneas. */
const GROUPS: { key: Group; label: string; sections: FsSectionKey[] }[] = [
  { key: "asset", label: "Activo", sections: ["asset_current", "asset_noncurrent"] },
  { key: "liability", label: "Pasivo", sections: ["liability_current", "liability_noncurrent"] },
  { key: "equity", label: "Patrimonio", sections: ["equity"] },
  { key: "eerr", label: "Estado de Resultados", sections: EERR_SECTIONS },
  { key: "excluded", label: "No afecta Estados Financieros", sections: [] },
];

/** Nombre corto de cada sección para el selector (el catálogo usa los títulos del estado). */
const SECTION_SHORT: Record<FsSectionKey, string> = {
  asset_current: "Activo corriente",
  asset_noncurrent: "Activo no corriente",
  liability_current: "Pasivo corriente",
  liability_noncurrent: "Pasivo no corriente",
  equity: "Patrimonio",
  income: "Ingresos",
  costs: "Costos",
  admin_expenses: "Gastos operacionales de administración",
  sales_expenses: "Gastos operacionales de ventas",
  other_income: "Otros ingresos",
  other_expenses: "Otros gastos",
};

const groupOf = (section: FsSectionKey): Group => GROUPS.find((g) => g.sections.includes(section))!.key;

/** Selección de una fila de opciones: botones tipo chip (radio). */
function Choices<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="fs-pick">
      <span className="fs-pick__label">{label}</span>
      <div className="fs-pick__options" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`fs-pick__option${value === o.value ? " is-active" : ""}`} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * «Este código PUC todavía no está clasificado.» Asignar a una línea del ESF /
 * EERR o marcar «No afecta Estados Financieros», en tres pasos: grupo →
 * subgrupo (sección del catálogo) → línea. La clasificación de un padre se
 * muestra como sugerencia, nunca se aplica sola.
 */
export function ClassifyPucModal({ open, pucCode, concept, catalog, mappings, onClose, onSaved }: Props) {
  const toast = useToast();
  const current = mappings.get(pucCode);
  const [group, setGroup] = useState<Group | null>(null);
  const [section, setSection] = useState<FsSectionKey | null>(null);
  const [lineId, setLineId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestion = useMemo(() => parentMapping(pucCode, mappings), [pucCode, mappings]);

  const active = (catalog?.lines ?? []).filter((l) => l.isActive);
  const lineById = new Map((catalog?.lines ?? []).map((l) => [l.id, l]));
  const suggestedLabel = suggestion ? (suggestion.mapping.excluded ? "No afecta Estados Financieros" : lineById.get(suggestion.mapping.lineId!)?.name) : undefined;

  /** Lleva los tres niveles a una clasificación guardada (o la limpia). */
  function select(mapping: Pick<FsPucMapping, "lineId" | "excluded"> | undefined) {
    const line = mapping?.lineId != null ? lineById.get(mapping.lineId) : undefined;
    setGroup(mapping?.excluded ? "excluded" : line ? groupOf(line.section) : null);
    setSection(line?.section ?? null);
    setLineId(line?.id ?? null);
  }

  useEffect(() => {
    if (!open) return;
    select(current);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pucCode]);

  // Solo se ofrecen secciones con líneas activas.
  const sectionsOf = (g: Group) => GROUPS.find((x) => x.key === g)!.sections.filter((s) => active.some((l) => l.section === s));
  const sections = group ? sectionsOf(group) : [];
  const lines = section ? active.filter((l) => l.section === section).sort((a, b) => a.sortOrder - b.sortOrder) : [];

  function chooseGroup(g: Group) {
    if (g === group) return;
    setGroup(g);
    setLineId(null);
    // Un grupo con una sola sección (Patrimonio) pasa directo a sus líneas.
    const only = sectionsOf(g);
    setSection(only.length === 1 ? only[0] : null);
  }

  function chooseSection(s: FsSectionKey) {
    if (s === section) return;
    setSection(s);
    setLineId(null);
  }

  const excluded = group === "excluded";
  const ready = excluded || lineId !== null;
  const path = excluded
    ? ["No afecta Estados Financieros"]
    : [GROUPS.find((g) => g.key === group)?.label, section && sectionsOf(group!).length > 1 ? SECTION_SHORT[section] : undefined, lineId !== null ? lineById.get(lineId)?.name : undefined].filter((x): x is string => Boolean(x));

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await fsService.setMapping(pucCode, excluded ? null : lineId, excluded);
      toast(`${pucCode} clasificado.`);
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
      title={`${pucCode} — ${concept}`}
      description={current ? "Cambiar la clasificación recalcula los periodos abiertos; los cerrados conservan lo aprobado." : "Este código PUC todavía no está clasificado."}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!ready}>
            Guardar clasificación
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {suggestion && !current && (
          <Alert tone="info" title="Sugerencia">
            Usar la misma clasificación de {suggestion.parent}: <strong>{suggestedLabel}</strong>.{" "}
            <Button size="sm" variant="ghost" onClick={() => select(suggestion.mapping)}>
              Usar esta clasificación
            </Button>
          </Alert>
        )}
        <Choices label="Estado" options={GROUPS.filter((g) => g.key === "excluded" || sectionsOf(g.key).length > 0).map((g) => ({ value: g.key, label: g.label }))} value={group} onChange={chooseGroup} />
        {group && !excluded && sections.length > 1 && <Choices label="Grupo" options={sections.map((s) => ({ value: s, label: SECTION_SHORT[s] }))} value={section} onChange={chooseSection} />}
        {section && <Choices label="Línea" options={lines.map((l) => ({ value: l.id, label: l.name }))} value={lineId} onChange={setLineId} />}
        <div className={`fs-pick__path${ready ? " is-ready" : ""}`} aria-live="polite">
          {path.length === 0 ? (
            <span className="muted">Elige dónde quedará este código PUC.</span>
          ) : (
            path.map((p, i) => (
              <span key={i} className="fs-pick__step">
                {i > 0 && <ChevronRight size={14} aria-hidden />}
                {p}
              </span>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
