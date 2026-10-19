import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Alert, Button, Modal, useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import { EERR_SECTIONS, ESF_SECTIONS, SECTION_LABEL, type FsCatalog, type FsLine, type FsPucMapping, type FsSectionKey } from "../../../../types/fs";
import { familyOf, resolverOf } from "../pucGroups";

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
  /** Clasificación masiva: varios grupos a la misma línea (pucCode / concept se ignoran). */
  bulk?: { code: string; concept: string }[];
}

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
export function ClassifyPucModal({ open, pucCode, concept, catalog, mappings, onClose, onSaved, bulk }: Props) {
  const toast = useToast();
  const resolver = useMemo(() => resolverOf(mappings), [mappings]);
  // La clasificación se decide por los primeros cuatro dígitos: cualquier código de seis dígitos clasifica a su grupo completo.
  const groupOf4 = (code: string) => (code.length >= 4 ? familyOf(code) : code);
  const many = useMemo(() => {
    if (!bulk || bulk.length === 0) return null;
    const unique = new Map<string, { code: string; concept: string }>();
    for (const c of bulk) if (!unique.has(groupOf4(c.code))) unique.set(groupOf4(c.code), { code: groupOf4(c.code), concept: c.concept });
    return [...unique.values()];
  }, [bulk]);
  const target = groupOf4(pucCode);
  const isGroup = !many && target.length === 4;
  const info = isGroup ? resolver.info(target) : undefined;
  const current = many ? undefined : resolver.resolve(target)?.mapping;
  const [group, setGroup] = useState<Group | null>(null);
  const [section, setSection] = useState<FsSectionKey | null>(null);
  const [lineId, setLineId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestion = useMemo(() => (many ? undefined : parentMapping(target, mappings)), [many, target, mappings]);

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

  /** Clasificaciones ya guardadas (del grupo o de sus subcuentas) distintas de la elegida: se reemplazan y quedan en el historial. */
  const differs = (m: FsPucMapping) => m.excluded !== excluded || (!excluded && m.lineId !== lineId);
  const replaced = ready
    ? (many ?? (target.length === 4 ? [{ code: target, concept }] : [])).flatMap((c) => {
        const i = resolver.info(c.code);
        return [...(i.own ? [i.own] : []), ...i.children].filter(differs);
      })
    : [];
  const conflicts = replaced;
  const describe = (m: FsPucMapping | undefined) => (!m ? "Sin clasificar" : m.excluded ? "No afecta Estados Financieros" : (lineById.get(m.lineId!)?.name ?? "—"));

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const apply = (code: string) => (code.length === 4 ? fsService.setGroupMapping(code, excluded ? null : lineId, excluded) : fsService.setMapping(code, excluded ? null : lineId, excluded));
      if (many) {
        // Cada grupo queda con su trazabilidad (historial de clasificación y origen) en Rust.
        for (const c of many) await apply(c.code);
        toast(many.length === 1 ? `${many[0].code} clasificado.` : `${many.length} grupos clasificados.`);
        await onSaved();
        onClose();
        return;
      }
      await apply(target);
      toast(`${target} clasificado${target.length === 4 ? " (todas sus cuentas)" : ""}.`);
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
      title={many ? `Clasificar ${many.length === 1 ? "1 grupo PUC" : `${many.length} grupos PUC`}` : isGroup ? `${target} — ${concept}` : `${pucCode} — ${concept}`}
      description={
        many
          ? "Todos los grupos seleccionados quedan en la misma ubicación y cubren todas sus cuentas. Recalcula los periodos abiertos; los cerrados conservan lo aprobado."
          : isGroup
            ? `Se clasifica el grupo completo: aplica a todas las cuentas que empiezan por ${target}${pucCode.length > 4 ? ` (no solo a ${pucCode})` : ""}, también a movimientos futuros. Recalcula los periodos abiertos; los cerrados conservan lo aprobado.`
            : current
              ? "Cambiar la clasificación recalcula los periodos abiertos; los cerrados conservan lo aprobado."
              : "Este código PUC todavía no está clasificado."
      }
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!ready}>
            {conflicts.length ? `Guardar (reemplaza ${conflicts.length})` : "Guardar clasificación"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {many && (
          <div className="puc-bulk-list" aria-label="Cuentas seleccionadas">
            {many.map((c) => (
              <span key={c.code} className="puc-bulk-list__item" title={`${c.concept} · ${describe(resolver.resolve(c.code)?.mapping)}`}>
                <span className="mono">{c.code}</span> {c.concept}
              </span>
            ))}
          </div>
        )}
        {info?.conflict && (
          <Alert tone="danger" title="Clasificaciones contradictorias en este grupo">
            <div className="stack stack--sm">
              <span>Estas cuentas tienen clasificaciones antiguas distintas. No se eligió ninguna por ti: elige la que corresponde al grupo completo.</span>
              {info.options.map((o) => (
                <div key={o.key} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <span>
                    <strong>{describe(o.mapping)}</strong> · <span className="mono">{o.codes.join(", ")}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => select(o.mapping)}>
                    Usar esta clasificación
                  </Button>
                </div>
              ))}
            </div>
          </Alert>
        )}
        {conflicts.length > 0 && (
          <Alert tone="warning" title={conflicts.length === 1 ? "1 clasificación anterior será reemplazada" : `${conflicts.length} clasificaciones anteriores serán reemplazadas`}>
            Se reemplazará: {conflicts.map((c) => `${c.pucCode} (${describe(c)})`).join(", ")}. Cada una queda en el historial con su valor anterior.
          </Alert>
        )}
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
