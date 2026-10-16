import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Eye, EyeOff, GripVertical, Pencil, Plus, Search } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Loader, Modal, PageHeader, Select, useToast } from "../components/ui";
import { ClassifyPucModal, lineLabel } from "../modules/financial-statements/shared/components/ClassifyPucModal";
import { PucField } from "../modules/financial-statements/shared/components/PucField";
import { SegmentedFilter } from "../modules/bank-analysis/shared/components/tableControls";
import { useFsData } from "../modules/financial-statements/shared/useFsData";
import { fsService } from "../services/fsService";
import { errorMessage } from "../services/tauri";
import { CREATABLE_SECTIONS, EERR_SECTIONS, ESF_SECTIONS, SECTION_LABEL, type FsLine, type FsSectionKey } from "../types/fs";
import { normalizeKey } from "../utils/text";

type MappedFilter = "all" | "esf" | "eerr" | "excluded";

const MAPPED_FILTERS: { id: MappedFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "esf", label: "ESF" },
  { id: "eerr", label: "EERR" },
  { id: "excluded", label: "No afecta EEFF" },
];

/** Movimientos accesibles equivalentes al arrastre (siempre dentro de la misma sección). */
type Move = "up" | "down" | "first" | "last";

/** Nuevo orden de la sección tras mover `id` (null si no cambia). Función pura. */
export function moveWithin(ids: number[], id: number, move: Move): number[] | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  const j = move === "up" ? i - 1 : move === "down" ? i + 1 : move === "first" ? 0 : ids.length - 1;
  if (j < 0 || j >= ids.length || j === i) return null;
  const next = ids.filter((x) => x !== id);
  next.splice(j, 0, id);
  return next;
}

const ROLE_LABEL: Record<NonNullable<FsLine["role"]>, string> = {
  share_capital: "Automático: capital suscrito (Empresas)",
  period_result: "Automático: resultado antes de impuestos",
  sales: "Recibe el resultado propio cripto",
  third_party_income: "Presentación Banco (cripto)",
  cost_of_sales: "Recibe el valor de terceros en OTC",
  third_party_cost: "Presentación Banco (cripto)",
};

/**
 * Datos → Catálogo de cuentas de Estados Financieros. Única fuente de verdad
 * de dónde aparece cada código PUC. Las líneas internas se crean, renombran,
 * ordenan (arrastrando) y desactivan; los encabezados y subtotales son fijos.
 *
 * El arrastre usa eventos de puntero, no el drag & drop HTML5: en macOS Tauri
 * intercepta el arrastre de la ventana (para soltar archivos) y `drop` nunca
 * llega al webview. El movimiento se escucha en la ventana (no con captura de
 * puntero: al reordenar, React mueve el nodo y WebKit soltaría la captura) y el
 * destino se calcula por la mitad de cada fila. Una línea solo se mueve dentro
 * de su sección.
 */
export function FsCatalogPage() {
  const toast = useToast();
  const data = useFsData();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<FsLine | null>(null);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [newPuc, setNewPuc] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [mappedFilter, setMappedFilter] = useState<MappedFilter>("all");
  /** Orden provisional de la sección mientras se arrastra (se guarda al soltar). */
  const [drag, setDrag] = useState<{ section: FsSectionKey; id: number; ids: number[] } | null>(null);
  const dragStart = useRef<number[]>([]);

  const catalog = data.catalog;
  const lineById = useMemo(() => new Map((catalog?.lines ?? []).map((l) => [l.id, l])), [catalog]);
  const representative = useMemo(() => new Map((catalog?.sections ?? []).map((s) => [s.section, s.representativeLineId])), [catalog]);
  const mapped = useMemo(() => {
    const q = normalizeKey(search);
    return data.mappings.filter((m) => {
      const line = m.lineId ? lineById.get(m.lineId) : undefined;
      if (mappedFilter === "excluded" && !m.excluded) return false;
      if (mappedFilter === "esf" && !(line && ESF_SECTIONS.includes(line.section))) return false;
      if (mappedFilter === "eerr" && !(line && EERR_SECTIONS.includes(line.section))) return false;
      if (!q) return true;
      return m.pucCode.startsWith(q) || normalizeKey(`${data.index.concepts.get(m.pucCode) ?? ""} ${line?.name ?? ""}`).includes(q);
    });
  }, [data.mappings, data.index, lineById, search, mappedFilter]);

  async function run(action: () => Promise<unknown>, message?: string) {
    try {
      await action();
      if (message) toast(message);
      await Promise.all([data.reloadCatalog(), data.reloadMappings()]);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const sectionIds = (key: FsSectionKey) => (catalog?.lines ?? []).filter((l) => l.section === key).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.id);

  function saveOrder(key: FsSectionKey, ids: number[], before: number[]) {
    if (ids.join() === before.join()) return;
    void run(() => fsService.reorderLines(key, ids), "Orden guardado.");
  }

  const dragRef = useRef(drag);
  dragRef.current = drag;

  function onGripDown(key: FsSectionKey, id: number, e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart.current = sectionIds(key);
    setDrag({ section: key, id, ids: dragStart.current });
  }

  // Mientras se arrastra: posición del puntero → puesto dentro de la sección; al soltar, se guarda.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const rows = [...document.querySelectorAll<HTMLElement>(`[data-section="${d.section}"][data-line-id]`)];
      const others = rows.filter((r) => Number(r.dataset.lineId) !== d.id);
      // Puesto = cuántas filas (sin la arrastrada) tienen su mitad por encima del puntero.
      const at = others.filter((r) => {
        const box = r.getBoundingClientRect();
        return box.top + box.height / 2 < e.clientY;
      }).length;
      const next = others.map((r) => Number(r.dataset.lineId));
      next.splice(at, 0, d.id);
      if (next.join() !== d.ids.join()) setDrag({ ...d, ids: next });
      // Desplazamiento automático dentro de la columna con scroll propio.
      const scroller = rows[0]?.closest<HTMLElement>(".fs-catalog__scroll");
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (e.clientY < box.top + 40) scroller.scrollTop -= 12;
        else if (e.clientY > box.bottom - 40) scroller.scrollTop += 12;
      }
    };
    const up = () => {
      const d = dragRef.current;
      if (d) saveOrder(d.section, d.ids, dragStart.current);
      setDrag(null);
    };
    const cancel = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setDrag(null);
    };
    document.body.classList.add("is-reordering");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", cancel);
    return () => {
      document.body.classList.remove("is-reordering");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  function move(key: FsSectionKey, id: number, how: Move) {
    const ids = sectionIds(key);
    const next = moveWithin(ids, id, how);
    if (next) saveOrder(key, next, ids);
  }

  /** Sobre el asa: flechas arriba / abajo mueven un puesto; Inicio / Fin, al inicio o al final. */
  function onGripKey(key: FsSectionKey, id: number, e: KeyboardEvent<HTMLElement>) {
    const how: Move | undefined = ({ ArrowUp: "up", ArrowDown: "down", Home: "first", End: "last" } as const)[e.key as "ArrowUp"];
    if (!how) return;
    e.preventDefault();
    move(key, id, how);
  }

  const section = (key: FsSectionKey) => {
    const sorted = (catalog?.lines ?? []).filter((l) => l.section === key).sort((a, b) => a.sortOrder - b.sortOrder);
    const lines = drag?.section === key ? drag.ids.map((id) => lineById.get(id)!).filter(Boolean) : sorted;
    return (
      <div key={key} className="fs-catalog__section">
        <div className="fs-catalog__head">
          <strong>{SECTION_LABEL[key]}</strong>
          <label className="fs-catalog__rep" title="Línea que se muestra en $0 cuando la sección no tiene valores">
            <span>Si está vacía</span>
            <Select
              aria-label={`Cuenta representativa de ${SECTION_LABEL[key]}`}
              value={representative.get(key) ?? ""}
              onChange={(e) => void run(() => fsService.setRepresentative(key, Number(e.target.value)), "Cuenta representativa actualizada.")}
            >
              {lines
                .filter((l) => l.isActive)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </Select>
          </label>
        </div>
        <ul className={`fs-catalog__lines${drag?.section === key ? " is-target" : ""}`}>
          {lines.map((l, i) => (
            <li key={l.id} data-line-id={l.id} data-section={key} className={[!l.isActive && "is-inactive", drag?.id === l.id && "is-dragging"].filter(Boolean).join(" ")}>
              <span
                role="button"
                tabIndex={0}
                className="fs-catalog__grip"
                aria-label={`Mover ${l.name} (flechas arriba / abajo, Inicio / Fin)`}
                title="Arrastra para ordenar (o usa las flechas, Inicio y Fin)"
                onPointerDown={(e) => onGripDown(key, l.id, e)}
                onKeyDown={(e) => onGripKey(key, l.id, e)}
              >
                <GripVertical size={15} aria-hidden />
              </span>
              <span className="fs-catalog__pos" aria-hidden>
                {i + 1}
              </span>
              <span className="fs-catalog__name" title={l.role ? ROLE_LABEL[l.role] : undefined}>
                {l.name}
              </span>
              {l.role && <span className="fs-catalog__role">Automática</span>}
              {representative.get(key) === l.id && <Badge>Representativa</Badge>}
              {!l.isActive && <Badge tone="warning">Desactivada</Badge>}
              <span className="fs-catalog__actions">
                <span className="fs-catalog__move" role="group" aria-label={`Ordenar ${l.name}`}>
                  <Button size="sm" variant="ghost" iconOnly icon={<ArrowUpToLine size={13} />} aria-label={`Mover ${l.name} al inicio`} title="Mover al inicio" disabled={i === 0 || drag !== null} onClick={() => move(key, l.id, "first")} />
                  <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp size={13} />} aria-label={`Mover ${l.name} arriba`} title="Mover arriba" disabled={i === 0 || drag !== null} onClick={() => move(key, l.id, "up")} />
                  <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown size={13} />} aria-label={`Mover ${l.name} abajo`} title="Mover abajo" disabled={i === lines.length - 1 || drag !== null} onClick={() => move(key, l.id, "down")} />
                  <Button size="sm" variant="ghost" iconOnly icon={<ArrowDownToLine size={13} />} aria-label={`Mover ${l.name} al final`} title="Mover al final" disabled={i === lines.length - 1 || drag !== null} onClick={() => move(key, l.id, "last")} />
                </span>
                <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={13} />} aria-label={`Renombrar ${l.name}`} title="Renombrar" onClick={() => setRenaming(l)} />
                {!l.role && (
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={l.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                    aria-label={`${l.isActive ? "Desactivar" : "Activar"} ${l.name}`}
                    title={l.isActive ? "Desactivar" : "Activar"}
                    onClick={() => void run(() => fsService.updateLine(l.id, l.name, !l.isActive), l.isActive ? "Línea desactivada." : "Línea activada.")}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Catálogo de cuentas de Estados Financieros"
        description="Define en qué línea del ESF o del EERR aparece cada código PUC. Arrastra el asa ⠿ (o usa los botones Mover arriba / abajo / al inicio / al final) para ordenar las líneas dentro de su sección: el orden se guarda al soltar y se usa en el Generador, la vista previa y el PDF."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            Nueva línea
          </Button>
        }
      />
      {!catalog ? (
        <Loader />
      ) : (
        <>
          <div className="fs-grid">
            <Card title="Estado de Situación Financiera" className="fs-catalog__col">
              <div className="fs-catalog__scroll">{ESF_SECTIONS.map(section)}</div>
            </Card>
            <Card title="Estado de Resultados" className="fs-catalog__col">
              <div className="fs-catalog__scroll">{EERR_SECTIONS.map(section)}</div>
            </Card>
          </div>
          <Card
            flush
            title="Códigos PUC clasificados"
            description="PUC → línea, o «No afecta Estados Financieros». Cambiar una clasificación recalcula los periodos abiertos; los cerrados conservan lo aprobado."
            actions={
              <div className="row">
                <PucField index={data.index} value={newPuc} onChange={(code) => { setNewPuc(undefined); setClassifying(code); }} placeholder="Clasificar otro PUC" mappings={data.mappingMap} onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])} />
                <div className="search" style={{ width: 240 }}>
                  <Search size={14} aria-hidden />
                  <Input type="search" placeholder="Buscar PUC o línea…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
            }
          >
            <div className="toolbar row--between">
              <SegmentedFilter label="Filtrar códigos clasificados" options={MAPPED_FILTERS} value={mappedFilter} onChange={setMappedFilter} />
              <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
                {mapped.length === 1 ? "1 código" : `${mapped.length} códigos`}
              </span>
            </div>
            <div className="table-wrap table-wrap--scroll" style={{ maxHeight: "50vh" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Código PUC</th>
                    <th>Concepto</th>
                    <th>Ubicación</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {mapped.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "var(--space-5)" }}>
                        Ningún código coincide con el filtro.
                      </td>
                    </tr>
                  )}
                  {mapped.map((m) => {
                    const line = m.lineId ? lineById.get(m.lineId) : undefined;
                    return (
                      <tr key={m.pucCode}>
                        <td className="mono">{m.pucCode}</td>
                        <td>
                          {data.index.concepts.get(m.pucCode) ?? "—"} {data.index.custom.has(m.pucCode) && <Badge>Personalizado</Badge>}
                        </td>
                        <td>{m.excluded ? <Badge tone="dark">No aplica · Excluido de EEFF</Badge> : line ? lineLabel(line) : "—"}</td>
                        <td className="actions">
                          <Button size="sm" variant="ghost" onClick={() => setClassifying(m.pucCode)}>
                            Cambiar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <CreateLineModal open={creating} onClose={() => setCreating(false)} onSaved={() => run(async () => undefined, "Línea creada.")} />
      <RenameLineModal line={renaming} onClose={() => setRenaming(null)} onSaved={() => run(async () => undefined, "Línea renombrada.")} />
      <ClassifyPucModal open={classifying !== null} pucCode={classifying ?? ""} concept={data.index.concepts.get(classifying ?? "") ?? ""} catalog={catalog} mappings={data.mappingMap} onClose={() => setClassifying(null)} onSaved={data.reloadMappings} />
    </>
  );
}

/**
 * Nueva línea: ESF → Activo / Pasivo (Corriente o No corriente) / Patrimonio;
 * EERR → Gastos operacionales de administración o de ventas.
 */
function CreateLineModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [statement, setStatement] = useState<"ESF" | "EERR" | "">("");
  const [group, setGroup] = useState("");
  const [term, setTerm] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const section: FsSectionKey | undefined =
    statement === "ESF"
      ? group === "equity"
        ? "equity"
        : group && term
          ? (`${group}_${term}` as FsSectionKey)
          : undefined
      : statement === "EERR" && group
        ? (group as FsSectionKey)
        : undefined;

  function reset() {
    setStatement("");
    setGroup("");
    setTerm("");
    setName("");
    setError(null);
  }

  async function save() {
    if (!section || !CREATABLE_SECTIONS.includes(section) || !name.trim()) return;
    setSaving(true);
    try {
      await fsService.createLine(section, name);
      await onSaved();
      reset();
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
      title="Nueva línea"
      description="La línea se agrega al final de su sección; luego puedes arrastrarla a su lugar."
      onClose={() => { reset(); onClose(); }}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!section || !name.trim()}>
            Crear línea
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Estado financiero" required>
          {(id) => (
            <Select id={id} value={statement} onChange={(e) => { setStatement(e.target.value as "ESF" | "EERR" | ""); setGroup(""); setTerm(""); }}>
              <option value="">Seleccionar…</option>
              <option value="ESF">ESF — Estado de Situación Financiera</option>
              <option value="EERR">EERR — Estado de Resultados</option>
            </Select>
          )}
        </Field>
        {statement === "ESF" && (
          <Field label="Grupo" required>
            {(id) => (
              <Select id={id} value={group} onChange={(e) => { setGroup(e.target.value); setTerm(""); }}>
                <option value="">Seleccionar…</option>
                <option value="asset">Activo</option>
                <option value="liability">Pasivo</option>
                <option value="equity">Patrimonio</option>
              </Select>
            )}
          </Field>
        )}
        {statement === "ESF" && (group === "asset" || group === "liability") && (
          <Field label="Plazo" required>
            {(id) => (
              <Select id={id} value={term} onChange={(e) => setTerm(e.target.value)}>
                <option value="">Seleccionar…</option>
                <option value="current">Corriente</option>
                <option value="noncurrent">No corriente</option>
              </Select>
            )}
          </Field>
        )}
        {statement === "EERR" && (
          <Field label="Ubicación" required hint="Por ahora, solo en los gastos operacionales.">
            {(id) => (
              <Select id={id} value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">Seleccionar…</option>
                <option value="admin_expenses">GASTOS OPERACIONALES DE ADMINISTRACIÓN</option>
                <option value="sales_expenses">GASTOS OPERACIONALES DE VENTAS</option>
              </Select>
            )}
          </Field>
        )}
        <Field label="Nombre de la línea" required>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Inventarios" />}
        </Field>
      </div>
    </Modal>
  );
}

function RenameLineModal({ line, onClose, onSaved }: { line: FsLine | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  if (line && current !== line.id) {
    setCurrent(line.id);
    setName(line.name);
    setError(null);
  }
  async function save() {
    if (!line || !name.trim()) return;
    setSaving(true);
    try {
      await fsService.updateLine(line.id, name, line.isActive);
      await onSaved();
      setCurrent(null);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={line !== null}
      title="Renombrar línea"
      onClose={() => { setCurrent(null); onClose(); }}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={() => { setCurrent(null); onClose(); }} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!name.trim()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nombre">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
      </div>
    </Modal>
  );
}
