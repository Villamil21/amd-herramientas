import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge, Button, EmptyState, Input, Modal, Select } from "../../../../components/ui";
import { useDebounced } from "../../../../hooks/useDebounced";
import type { PucCode } from "../../../../types/models";
import { formatInteger } from "../../../../utils/format";
import { catalogRows, isSelectableCode, pucClasses, type PucIndex, type PucRow } from "../services/pucCatalog";

/** Filas que se dibujan a la vez; una búsqueda muy amplia se acota en vez de pintar todo el catálogo. */
const MAX_ROWS = 900;

/** Administración de la tabla (Datos → Tabla de Códigos PUC). Sin ella, la tabla es solo de consulta. */
export interface PucCatalogAdmin {
  /** Código → número de referencias (solo los que tienen alguna). */
  usage: Map<string, number>;
  /** Código → «Disponible», «No afecta EEFF»… (solo los clasificados). */
  classification: Map<string, { label: string; excluded: boolean }>;
  onEdit: (code: string) => void;
  onClassify: (code: string) => void;
  onToggleActive: (code: string) => void;
  onDelete: (code: string) => void;
  onReferences: (code: string) => void;
}

type KindFilter = "" | "official" | "custom";
type StatusFilter = "" | "active" | "inactive";
type ClassFilter = "" | "classified" | "unclassified" | "excluded";

/** Subcuenta oficial de 6 dígitos o personalizado: se asigna, clasifica y desactiva. */
const assignable = (row: { code: string; custom?: boolean }) => Boolean(row.custom) || isSelectableCode(row.code);

function CatalogRow({ row, excluded, admin }: { row: PucRow; excluded?: boolean; admin?: PucCatalogAdmin }) {
  const missing = row.concept === undefined;
  const columns = admin ? 5 : 2;
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
  return (
    <tr className={`puc-row puc-row--${row.level}${row.inactive ? " is-inactive" : ""}`}>
      <td className="puc-row__code selectable">{row.code}</td>
      <td className="selectable">
        {missing ? <span className="puc-row__missing">Cuenta sin denominación en el catálogo fuente</span> : row.concept}
        {row.custom && <> <Badge>Personalizado</Badge></>}
        {row.inactive && <> <Badge tone="warning">Inactivo</Badge></>}
        {!admin && excluded && <> <Badge tone="dark">No aplica · Excluido de EEFF</Badge></>}
      </td>
      {admin && (
        <>
          <td className="puc-row__usage">
            {missing ? null : uses > 0 ? (
              <button type="button" className="link-button" onClick={() => admin.onReferences(row.code)} title="Ver referencias">
                {uses === 1 ? "1 referencia" : `${formatInteger(uses)} referencias`}
              </button>
            ) : (
              <span className="muted">No</span>
            )}
          </td>
          <td className="puc-row__fs">{!canAssign ? null : mapping ? mapping.excluded ? <Badge tone="dark">No afecta EEFF</Badge> : mapping.label : <span className="muted">Sin clasificar</span>}</td>
          <td className="actions">
            {!missing && (
              <span className="puc-row__actions">
                <Button size="sm" variant="ghost" onClick={() => admin.onEdit(row.code)}>
                  Editar
                </Button>
                {canAssign && (
                  <Button size="sm" variant="ghost" onClick={() => admin.onClassify(row.code)}>
                    Clasificar en EEFF
                  </Button>
                )}
                {canAssign && (
                  <Button size="sm" variant="ghost" onClick={() => admin.onToggleActive(row.code)}>
                    {row.inactive ? "Reactivar" : "Desactivar"}
                  </Button>
                )}
                {/* Oficial: nunca. Personalizado con uso: explica por qué no y ofrece Desactivar. */}
                {row.custom && !row.inactive && (
                  <Button size="sm" variant="ghost" className={uses > 0 ? "puc-row__delete is-muted" : "puc-row__delete"} title={uses > 0 ? "Tiene movimientos o referencias: no se puede eliminar" : undefined} onClick={() => admin.onDelete(row.code)}>
                    Eliminar
                  </Button>
                )}
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
  const query = useDebounced(search.trim(), 150);
  const filter = useMemo(() => {
    if (!kind && !status && !classified) return undefined;
    return (c: PucCode) => {
      if (kind && (kind === "custom") !== Boolean(c.custom)) return false;
      if (status && (status === "inactive") !== (c.active === false)) return false;
      if (classified) {
        if (!assignable(c)) return false;
        const m = admin?.classification.get(c.code);
        if (classified === "unclassified" ? m : classified === "excluded" ? !m?.excluded : !m || m.excluded) return false;
      }
      return true;
    };
  }, [kind, status, classified, admin]);
  const rows = useMemo(() => catalogRows(index, { classCode, query, filter }), [index, classCode, query, filter]);
  const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows;
  const leaves = rows.filter((r) => r.level === "leaf").length;
  const columns = admin ? 5 : 2;

  return (
    <>
      <div className="toolbar row--between">
        <div className="row">
          <Select aria-label="Clase del catálogo" value={classCode} onChange={(e) => setClassCode(e.target.value)} disabled={Boolean(query)} style={{ width: "auto" }}>
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
                <option value="">Oficiales y personalizados</option>
                <option value="official">Oficiales</option>
                <option value="custom">Personalizados</option>
              </Select>
              <Select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} style={{ width: "auto" }}>
                <option value="">Activos e inactivos</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
              </Select>
              <Select aria-label="Clasificación EEFF" value={classified} onChange={(e) => setClassified(e.target.value as ClassFilter)} style={{ width: "auto" }}>
                <option value="">Cualquier clasificación EEFF</option>
                <option value="classified">Clasificados en EEFF</option>
                <option value="excluded">No afecta EEFF</option>
                <option value="unclassified">Sin clasificar</option>
              </Select>
            </>
          )}
          <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
            {query ? "Buscando en todo el catálogo · " : ""}
            {leaves === 1 ? "1 código asignable" : `${formatInteger(leaves)} códigos asignables`}
          </span>
        </div>
        <div className="search" style={{ width: 320 }}>
          <Search size={14} aria-hidden />
          <Input type="search" placeholder="Buscar por código o concepto..." aria-label="Buscar por código o concepto" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title="Sin resultados" description={query ? `Ningún código ni concepto coincide con «${query}».` : "Ningún código cumple los filtros."} />
      ) : (
        <div className="table-wrap table-wrap--scroll" style={maxHeight ? { maxHeight } : undefined}>
          <table className={`table puc-table${admin ? " puc-table--admin" : ""}`}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Código</th>
                <th>Concepto</th>
                {admin && (
                  <>
                    <th style={{ width: 120 }}>En uso</th>
                    <th style={{ width: 200 }}>Clasificación EEFF</th>
                    <th />
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
