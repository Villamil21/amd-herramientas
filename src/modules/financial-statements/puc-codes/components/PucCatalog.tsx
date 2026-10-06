import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { EmptyState, Input, Modal, Select } from "../../../../components/ui";
import { useDebounced } from "../../../../hooks/useDebounced";
import { formatInteger } from "../../../../utils/format";
import { catalogRows, pucClasses, type PucIndex, type PucRow } from "../services/pucCatalog";

/** Filas que se dibujan a la vez; una búsqueda muy amplia se acota en vez de pintar todo el catálogo. */
const MAX_ROWS = 900;

function CatalogRow({ row }: { row: PucRow }) {
  const missing = row.concept === undefined;
  if (row.level === "class" || row.level === "group") {
    // Clase y grupo son títulos: organizan la tabla y no se pueden asignar. El código queda en el tooltip.
    return (
      <tr className={`puc-row puc-row--${row.level}`}>
        <td colSpan={2} title={`${row.level === "class" ? "Clase" : "Grupo"} ${row.code}`}>
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
  return (
    <tr className={`puc-row puc-row--${row.level}`}>
      <td className="puc-row__code selectable">{row.code}</td>
      <td className="selectable">{missing ? <span className="puc-row__missing">Cuenta sin denominación en el catálogo fuente</span> : row.concept}</td>
    </tr>
  );
}

/**
 * Tabla de Códigos PUC con su jerarquía: grupo (título) → cuenta de 4 dígitos
 * (subtítulo) → subcuentas de 6 dígitos (las únicas que se pueden asignar).
 * Solo consulta: no crea, edita ni elimina códigos.
 */
export function PucCatalog({ index, maxHeight }: { index: PucIndex; maxHeight?: string }) {
  const classes = useMemo(() => pucClasses(index), [index]);
  const [classCode, setClassCode] = useState("1");
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), 150);
  const rows = useMemo(() => catalogRows(index, { classCode, query }), [index, classCode, query]);
  const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows;
  const leaves = rows.filter((r) => r.level === "leaf").length;

  return (
    <>
      <div className="toolbar row--between">
        <div className="row">
          <Select aria-label="Clase del catálogo" value={classCode} onChange={(e) => setClassCode(e.target.value)} disabled={Boolean(query)} style={{ width: "auto" }}>
            {classes.map((c) => (
              <option key={c.code} value={c.code}>
                Clase {c.code} — {c.concept}
              </option>
            ))}
          </Select>
          <span className="muted" style={{ fontSize: "var(--text-sm)" }}>
            {query ? "Buscando en todo el catálogo · " : ""}
            {leaves === 1 ? "1 código de 6 dígitos" : `${formatInteger(leaves)} códigos de 6 dígitos`}
          </span>
        </div>
        <div className="search" style={{ width: 320 }}>
          <Search size={14} aria-hidden />
          <Input type="search" placeholder="Buscar por código o concepto..." aria-label="Buscar por código o concepto" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title="Sin resultados" description={`Ningún código ni concepto coincide con «${query}».`} />
      ) : (
        <div className="table-wrap table-wrap--scroll" style={maxHeight ? { maxHeight } : undefined}>
          <table className="table puc-table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Código</th>
                <th>Concepto</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <CatalogRow key={r.code} row={r} />
              ))}
              {shown.length < rows.length && (
                <tr>
                  <td colSpan={2} className="muted" style={{ textAlign: "center" }}>
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
