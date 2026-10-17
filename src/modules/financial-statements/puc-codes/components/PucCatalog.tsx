import { useMemo, useState } from "react";
import { Eye, EyeOff, ListTree, Pencil, Search, Trash2, TriangleAlert } from "lucide-react";
import { Badge, Button, EmptyState, Input, Modal, Select } from "../../../../components/ui";
import { useDebounced } from "../../../../hooks/useDebounced";
import type { PucCode } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";
import { SegmentedFilter } from "../../../bank-analysis/shared/components/tableControls";
import { catalogRows, isSelectableCode, pucClasses, type PucIndex, type PucRow } from "../services/pucCatalog";

/** Filas que se dibujan a la vez; una búsqueda muy amplia se acota en vez de pintar todo el catálogo. */
const MAX_ROWS = 900;

/** Administración de la tabla (Datos → Tabla de Códigos PUC). Sin ella, la tabla es solo de consulta. */
export interface PucCatalogAdmin {
  /** Código → número de referencias (solo los que tienen alguna). */
  usage: Map<string, number>;
  /** Código → «Disponible», «No afecta EEFF»… (solo los clasificados). */
  classification: Map<string, { label: string; excluded: boolean }>;
  /** Código PUC → concepto 1001 sugerido (Compras, costos y exógena). Sin esto no se muestra la columna. */
  concept1001?: Map<string, string>;
  onEdit: (code: string) => void;
  onClassify: (code: string) => void;
  onToggleActive: (code: string) => void;
  onDelete: (code: string) => void;
  onReferences: (code: string) => void;
  /** Ficha de la cuenta (código, tipo, estado, clasificación, referencias y acciones). */
  onOpen: (code: string) => void;
  /** Selección para clasificación masiva (solo cuentas asignables). */
  selected: Set<string>;
  onSelect: (codes: string[], checked: boolean) => void;
}

/** Accesos rápidos de la tabla administrable. */
type Quick = "" | "custom" | "unclassified" | "inuse" | "inactive";
const QUICK: { id: Quick; label: string }[] = [
  { id: "", label: "Todas" },
  { id: "custom", label: "Personalizadas" },
  { id: "unclassified", label: "Sin clasificar" },
  { id: "inuse", label: "En uso" },
  { id: "inactive", label: "Inactivas" },
];

type KindFilter = "" | "official" | "custom";
type StatusFilter = "" | "active" | "inactive";
type ClassFilter = "" | "classified" | "unclassified" | "excluded";

/** Subcuenta oficial de 6 dígitos o personalizado: se asigna, clasifica y desactiva. */
const assignable = (row: { code: string; custom?: boolean }) => Boolean(row.custom) || isSelectableCode(row.code);

function CatalogRow({ row, excluded, admin }: { row: PucRow; excluded?: boolean; admin?: PucCatalogAdmin }) {
  const missing = row.concept === undefined;
  const columns = admin ? (admin.concept1001 ? 7 : 6) : 2;
  if (row.level === "class" || row.level === "group") {
    // Clase y grupo son títulos: organizan la tabla y no se pueden asignar. El código queda en el tooltip.
    return (
      <tr className={`puc-row puc-row--${row.level}`}>
        <td colSpan={columns} title={`${row.level === "class" ? "Clase" : "Grupo"} ${row.code}`}>
          {missing ? (
            <>
              {row.level === "class" ? "Clase" : "Grupo"} {row.code} <span className="puc-row__missing">sin denominación en el catálogo fuente</span>
            </>
          ) : (
            row.concept
          )}
        </td>
      </tr>
    );
  }
  const uses = admin?.usage.get(row.code) ?? 0;
  const mapping = admin?.classification.get(row.code);
  const canAssign = !missing && assignable(row);
  // Sangría real por nivel: cuenta (4) → subcuenta (6) → personalizado más largo.
  const depth = row.level === "account" ? 0 : row.code.length > 6 ? 2 : 1;
  const icon = (label: string, Icon: typeof Pencil, onClick: () => void, extra?: string) => (
    <Button size="sm" variant="ghost" iconOnly icon={<Icon size={14} />} aria-label={`${label} ${row.code}`} title={label} className={extra} onClick={onClick} />
  );
  const isSelected = admin?.selected.has(row.code) ?? false;
  return (
    <tr
      className={`puc-row puc-row--${row.level}${row.inactive ? " is-inactive" : ""}${admin && !missing ? " is-clickable" : ""}${isSelected ? " is-selected" : ""}`}
      onClick={admin && !missing ? () => admin.onOpen(row.code) : undefined}
    >
      {admin && (
        <td onClick={(e) => e.stopPropagation()} style={{ width: 36 }}>
          {canAssign && <input type="checkbox" aria-label={`Seleccionar ${row.code}`} checked={isSelected} onChange={(e) => admin.onSelect([row.code], e.target.checked)} />}
        </td>
      )}
      <td className="puc-row__code selectable" style={{ paddingLeft: 16 + depth * 16 }}>
        {row.code}
      </td>
      <td className="selectable puc-row__concept" style={{ paddingLeft: 12 + depth * 16 }}>
        {missing ? <span className="puc-row__missing">Cuenta sin denominación en el catálogo fuente</span> : row.concept}
        {row.custom && <> <Badge>Personalizado</Badge></>}
        {row.inactive && <> <Badge tone="warning">Inactivo</Badge></>}
        {!admin && excluded && <> <Badge tone="dark">No aplica · Excluido de EEFF</Badge></>}
      </td>
      {admin && (
        <>
          <td className="puc-row__fs" title={mapping && !mapping.excluded ? mapping.label : undefined}>
            {!canAssign ? null : mapping ? (
              mapping.excluded ? <Badge tone="dark">No afecta EEFF</Badge> : <span className="puc-row__line">{mapping.label}</span>
            ) : uses > 0 ? (
              <span className="puc-row__unclassified-used" title="Tiene movimientos o referencias y no aparecerá en los Estados Financieros hasta clasificarla">
                <TriangleAlert size={13} aria-hidden /> Sin clasificar · en uso
              </span>
            ) : (
              <span className="muted">Sin clasificar · sin uso</span>
            )}
          </td>
          {admin.concept1001 && <td className="puc-row__concept1001">{canAssign ? admin.concept1001.get(row.code) ?? <span className="muted">—</span> : null}</td>}
          <td className="puc-row__usage">
            {missing ? null : uses > 0 ? (
              <button type="button" className="link-button" onClick={() => admin.onReferences(row.code)} title="Ver referencias">
                {formatInteger(uses)}
              </button>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
          <td className="actions" onClick={(e) => e.stopPropagation()}>
            {!missing && (
              <span className="puc-row__actions">
                {icon("Editar", Pencil, () => admin.onEdit(row.code))}
                {canAssign && icon("Clasificar en EEFF", ListTree, () => admin.onClassify(row.code))}
                {canAssign && icon(row.inactive ? "Reactivar" : "Desactivar", row.inactive ? Eye : EyeOff, () => admin.onToggleActive(row.code))}
                {/* Solo un personalizado sin uso se elimina; el motivo de los demás está en la ficha. */}
                {row.custom && !row.inactive && uses === 0 && icon("Eliminar", Trash2, () => admin.onDelete(row.code), "puc-row__delete")}
              </span>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

/**
 * Tabla de Códigos PUC con su jerarquía: grupo (título) → cuenta de 4 dígitos
 * (subtítulo) → subcuentas de 6 dígitos (las únicas que se pueden asignar).
 * Sin `admin` es solo de consulta; con él muestra uso, clasificación en EEFF,
 * filtros y las acciones de cada fila.
 */
export function PucCatalog({ index, maxHeight, excluded, admin }: { index: PucIndex; maxHeight?: string; /** Códigos marcados «No afecta Estados Financieros». */ excluded?: Set<string>; admin?: PucCatalogAdmin }) {
  const classes = useMemo(() => pucClasses(index), [index]);
  const [classCode, setClassCode] = useState("1");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [classified, setClassified] = useState<ClassFilter>("");
  const [inUse, setInUse] = useState(false);
  const query = useDebounced(search.trim(), 150);
  const quick: Quick | null = inUse ? (!kind && !status && !classified ? "inuse" : null) : kind === "custom" && !status && !classified ? "custom" : !kind && !status && classified === "unclassified" ? "unclassified" : !kind && status === "inactive" && !classified ? "inactive" : !kind && !status && !classified ? "" : null;
  function chooseQuick(q: Quick) {
    setKind(q === "custom" ? "custom" : "");
    setStatus(q === "inactive" ? "inactive" : "");
    setClassified(q === "unclassified" ? "unclassified" : "");
    setInUse(q === "inuse");
  }
  const filter = useMemo(() => {
    if (!kind && !status && !classified && !inUse) return undefined;
    return (c: PucCode) => {
      if (inUse && !(admin?.usage.get(c.code) ?? 0)) return false;
      if (kind && (kind === "custom") !== Boolean(c.custom)) return false;
      if (status && (status === "inactive") !== (c.active === false)) return false;
      if (classified) {
        if (!assignable(c)) return false;
        const m = admin?.classification.get(c.code);
        if (classified === "unclassified" ? m : classified === "excluded" ? !m?.excluded : !m || m.excluded) return false;
      }
      return true;
    };
  }, [kind, status, classified, inUse, admin]);
  const rows = useMemo(() => catalogRows(index, { classCode, query, filter }), [index, classCode, query, filter]);
  const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows;
  const leaves = rows.filter((r) => r.level === "leaf").length;
  const columns = admin ? 6 : 2;
  const selectable = admin ? shown.filter((r) => r.level !== "class" && r.level !== "group" && r.concept !== undefined && assignable(r)).map((r) => r.code) : [];
  const allSelected = selectable.length > 0 && selectable.every((c) => admin!.selected.has(c));

  return (
    <>
      {admin && (
        <div className="toolbar puc-quick">
          <SegmentedFilter label="Accesos rápidos" options={QUICK} value={quick ?? ("none" as Quick)} onChange={chooseQuick} />
        </div>
      )}
      <div className="toolbar row--between puc-toolbar">
        <div className="search puc-toolbar__search">
          <Search size={14} aria-hidden />
          <Input type="search" placeholder="Buscar por código o concepto…" aria-label="Buscar por código o concepto" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="row puc-toolbar__filters">
          <Select aria-label="Clase del catálogo" value={classCode} onChange={(e) => setClassCode(e.target.value)} disabled={Boolean(query)} style={{ width: "auto", maxWidth: 210 }}>
            {admin && <option value="">Todas las clases</option>}
            {classes.map((c) => (
              <option key={c.code} value={c.code}>
                Clase {c.code} — {c.concept}
              </option>
            ))}
          </Select>
          {admin && (
            <>
              <Select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} style={{ width: "auto" }}>
                <option value="">Todos los tipos</option>
                <option value="official">Oficiales</option>
                <option value="custom">Personalizados</option>
              </Select>
              <Select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} style={{ width: "auto" }}>
                <option value="">Todos los estados</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
              </Select>
              <Select aria-label="Clasificación EEFF" value={classified} onChange={(e) => setClassified(e.target.value as ClassFilter)} style={{ width: "auto" }}>
                <option value="">Toda clasificación</option>
                <option value="classified">Clasificados en EEFF</option>
                <option value="excluded">No afecta EEFF</option>
                <option value="unclassified">Sin clasificar</option>
              </Select>
            </>
          )}
        </div>
        <span className="muted puc-toolbar__count">
          {query ? "Buscando en todo el catálogo · " : ""}
          {leaves === 1 ? "1 código asignable" : `${formatInteger(leaves)} códigos asignables`}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title="Sin resultados" description={query ? `Ningún código ni concepto coincide con «${query}».` : "Ningún código cumple los filtros."} />
      ) : (
        <div className="table-wrap table-wrap--scroll" style={maxHeight ? { maxHeight } : undefined}>
          <table className={`table table--dense puc-table${admin ? " puc-table--admin" : ""}`}>
            <thead>
              <tr>
                {admin && (
                  <th style={{ width: 36 }}>
                    <input type="checkbox" aria-label="Seleccionar las cuentas visibles" checked={allSelected} disabled={selectable.length === 0} onChange={(e) => admin.onSelect(selectable, e.target.checked)} />
                  </th>
                )}
                <th style={{ width: 128 }}>Código</th>
                <th>Concepto</th>
                {admin && (
                  <>
                    <th style={{ width: "24%" }}>Clasificación EEFF</th>
                    {admin.concept1001 && <th style={{ width: 90 }} title="Concepto sugerido del formato 1001">Concepto 1001</th>}
                    <th className="num" style={{ width: 64 }} title="Movimientos y referencias">
                      Uso
                    </th>
                    <th style={{ width: 138 }} />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <CatalogRow key={r.code} row={r} excluded={excluded?.has(r.code)} admin={admin} />
              ))}
              {shown.length < rows.length && (
                <tr>
                  <td colSpan={columns} className="muted" style={{ textAlign: "center" }}>
                    Se muestran las primeras {formatInteger(shown.length)} filas de {formatInteger(rows.length)}. Escribe más para acotar la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** «Ver tabla PUC» desde el submódulo: la misma tabla en una ventana, sin salir del análisis. */
export function PucCatalogModal({ open, index, onClose }: { open: boolean; index: PucIndex; onClose: () => void }) {
  return (
    <Modal open={open} size="xl" title="Tabla de Códigos PUC" description="Catálogo de cuentas de consulta. Solo los códigos de 6 dígitos se pueden asignar a una factura o producto." onClose={onClose}>
      <div className="puc-catalog-modal">
        <PucCatalog index={index} maxHeight="56vh" />
      </div>
    </Modal>
  );
}
