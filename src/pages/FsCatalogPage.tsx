import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { GripVertical, Pencil, Plus, Search } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Loader, Modal, PageHeader, Select, useToast } from "../components/ui";
import { ClassifyPucModal, lineLabel } from "../modules/financial-statements/shared/components/ClassifyPucModal";
import { PucField } from "../modules/financial-statements/shared/components/PucField";
import { useFsData } from "../modules/financial-statements/shared/useFsData";
import { fsService } from "../services/fsService";
import { errorMessage } from "../services/tauri";
import { CREATABLE_SECTIONS, EERR_SECTIONS, ESF_SECTIONS, SECTION_LABEL, type FsLine, type FsSectionKey } from "../types/fs";
import { normalizeKey } from "../utils/text";

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
 * llega al webview. Una línea solo se mueve dentro de su sección.
 */
export function FsCatalogPage() {
  const toast = useToast();
  const data = useFsData();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<FsLine | null>(null);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [newPuc, setNewPuc] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  /** Orden provisional de la sección mientras se arrastra (se guarda al soltar). */
  const [drag, setDrag] = useState<{ section: FsSectionKey; id: number; ids: number[] } | null>(null);
  const dragStart = useRef<number[]>([]);

  const catalog = data.catalog;
  const lineById = useMemo(() => new Map((catalog?.lines ?? []).map((l) => [l.id, l])), [catalog]);
  const representative = useMemo(() => new Map((catalog?.sections ?? []).map((s) => [s.section, s.representativeLineId])), [catalog]);
  const mapped = useMemo(() => {
    const q = normalizeKey(search);
    return data.mappings.filter((m) => {
      if (!q) return true;
      const line = m.lineId ? lineById.get(m.lineId) : undefined;
      return m.pucCode.startsWith(q) || normalizeKey(`${data.index.concepts.get(m.pucCode) ?? ""} ${line?.name ?? ""}`).includes(q);
    });
  }, [data.mappings, data.index, lineById, search]);

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

  function onGripDown(key: FsSectionKey, id: number, e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = sectionIds(key);
    setDrag({ section: key, id, ids: dragStart.current });
  }

  function onGripMove(e: PointerEvent<HTMLElement>) {
    if (!drag) return;
    // La línea bajo el puntero, solo si es de la misma sección (nunca se cambia de sección).
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-line-id]");
    if (!over || over.dataset.section !== drag.section) return;
    const target = Number(over.dataset.lineId);
    if (target === drag.id) return;
    const next = drag.ids.filter((x) => x !== drag.id);
    const at = next.indexOf(target) + (drag.ids.indexOf(target) > drag.ids.indexOf(drag.id) ? 1 : 0);
    next.splice(at, 0, drag.id);
    setDrag({ ...drag, ids: next });
  }

  function onGripUp() {
    if (!drag) return;
    saveOrder(drag.section, drag.ids, dragStart.current);
    setDrag(null);
  }

  /** Flechas arriba / abajo sobre el asa: mueve la línea un puesto. */
  function onGripKey(key: FsSectionKey, id: number, e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const ids = sectionIds(key);
    const i = ids.indexOf(id);
    const j = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    saveOrder(key, next, ids);
  }

  const section = (key: FsSectionKey) => {
    const sorted = (catalog?.lines ?? []).filter((l) => l.section === key).sort((a, b) => a.sortOrder - b.sortOrder);
    const lines = drag?.section === key ? drag.ids.map((id) => lineById.get(id)!).filter(Boolean) : sorted;
    return (
      <div key={key} className="fs-catalog__section">
        <div className="row row--between">
          <strong>{SECTION_LABEL[key]}</strong>
          <Select
            aria-label={`Cuenta representativa de ${SECTION_LABEL[key]}`}
            value={representative.get(key) ?? ""}
            onChange={(e) => void run(() => fsService.setRepresentative(key, Number(e.target.value)), "Cuenta representativa actualizada.")}
            style={{ width: "auto", fontSize: "var(--text-sm)" }}
            title="Cuenta representativa cuando la sección esté vacía"
          >
            {lines
              .filter((l) => l.isActive)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  Si está vacía: {l.name}
                </option>
              ))}
          </Select>
        </div>
        <ul className="fs-catalog__lines">
          {lines.map((l) => (
            <li key={l.id} data-line-id={l.id} data-section={key} className={[!l.isActive && "is-inactive", drag?.id === l.id && "is-dragging"].filter(Boolean).join(" ")}>
              <span
                role="button"
                tabIndex={0}
                className="fs-catalog__grip"
                aria-label={`Mover ${l.name} (flechas arriba / abajo)`}
                title="Arrastra para ordenar (o usa las flechas)"
                onPointerDown={(e) => onGripDown(key, l.id, e)}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => onGripKey(key, l.id, e)}
              >
                <GripVertical size={14} aria-hidden />
              </span>
              <span className="fs-catalog__name">{l.name}</span>
              {l.role && <span className="field__hint">{ROLE_LABEL[l.role]}</span>}
              {representative.get(key) === l.id && <Badge>Representativa</Badge>}
              {!l.isActive && <Badge tone="warning">Desactivada</Badge>}
              <span className="fs-catalog__actions">
                <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={13} />} aria-label={`Renombrar ${l.name}`} onClick={() => setRenaming(l)} />
                {!l.role && (
                  <Button size="sm" variant="ghost" onClick={() => void run(() => fsService.updateLine(l.id, l.name, !l.isActive), l.isActive ? "Línea desactivada." : "Línea activada.")}>
                    {l.isActive ? "Desactivar" : "Activar"}
                  </Button>
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
        description="Define en qué línea del ESF o del EERR aparece cada código PUC. Arrastra las líneas para decidir su orden en el PDF."
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
            <Card title="Estado de Situación Financiera">{ESF_SECTIONS.map(section)}</Card>
            <Card title="Estado de Resultados">{EERR_SECTIONS.map(section)}</Card>
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
