import { History, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Loader, Modal, PageHeader, Select, useToast } from "../components/ui";
import { Concepts1001Panel } from "./exogenaCatalogs/Concepts1001Panel";
import { AliasesPanel } from "./exogenaCatalogs/AliasesPanel";
import { RulesPanel } from "./exogenaCatalogs/RulesPanel";
import { TitleTypesPanel } from "./exogenaCatalogs/TitleTypesPanel";
import { useCatalogs } from "../modules/exogena/hooks";
import { exogenaService } from "../services/exogenaService";
import { errorMessage } from "../services/tauri";
import type { CatalogAuditEntry, CatalogEntryInput, CatalogKey } from "../types/exogena";
import { formatDateTimeForDisplay } from "../utils/dates";
import { normalizeKey } from "../utils/text";

const TABS: { key: CatalogKey; label: string; codeHint: string; codeWidth: number }[] = [
  { key: "document_types", label: "Tipos de documento", codeHint: "2 dígitos, ej. 13", codeWidth: 2 },
  { key: "countries", label: "Países", codeHint: "3 dígitos, ej. 169", codeWidth: 3 },
  { key: "departments", label: "Departamentos", codeHint: "2 dígitos, ej. 76", codeWidth: 2 },
  { key: "municipalities", label: "Municipios", codeHint: "3 dígitos dentro del departamento, ej. 001", codeWidth: 3 },
];

/** Pestañas de Compras, costos y exógena: no son catálogos DIAN y tienen su propio panel. */
type ExtraKey = "concepts_1001" | "title_types" | "aliases" | "purchase_rules";
const EXTRA_TABS: { key: ExtraKey; label: string }[] = [
  { key: "concepts_1001", label: "Conceptos 1001" },
  { key: "title_types", label: "Tipos de comprobante" },
  { key: "aliases", label: "Alias" },
  { key: "purchase_rules", label: "Reglas de compras" },
];
const isExtra = (k: string): k is ExtraKey => EXTRA_TABS.some((t) => t.key === k);

interface Row {
  code: string;
  parentCode: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
}

const ACTION_LABEL: Record<CatalogAuditEntry["action"], string> = { add: "Agregó", rename: "Renombró", activate: "Activó", deactivate: "Desactivó", delete: "Eliminó" };

/**
 * Datos → Catálogos Exógena: tipos de documento DIAN, países, departamentos y municipios. Los valores de sistema no se eliminan
 * (se desactivan o se renombran); cada ajuste queda en el historial. Los códigos son texto y conservan sus ceros.
 */
export function ExogenaCatalogsPage() {
  const toast = useToast();
  const { catalogs, reload } = useCatalogs();
  const [selectedTab, setTab] = useState<CatalogKey | ExtraKey>("document_types");
  const extra = isExtra(selectedTab) ? selectedTab : null;
  const tab: CatalogKey = isExtra(selectedTab) ? "document_types" : selectedTab;
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [audit, setAudit] = useState<CatalogAuditEntry[] | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    if (showAudit) void exogenaService.catalogAudit().then(setAudit, (e) => toast(errorMessage(e), "error"));
  }, [showAudit, catalogs, toast]);

  const rows = useMemo<Row[]>(() => {
    if (!catalogs) return [];
    switch (tab) {
      case "document_types":
        return catalogs.documentTypes.map((d) => ({ code: d.code, parentCode: "", name: d.description, isSystem: d.isSystem, isActive: d.isActive }));
      case "countries":
        return catalogs.countries.map((c) => ({ code: c.code, parentCode: "", name: c.name, isSystem: c.isSystem, isActive: c.isActive }));
      case "departments":
        return catalogs.departments.map((d) => ({ code: d.code, parentCode: "", name: d.name, isSystem: d.isSystem, isActive: d.isActive }));
      default:
        return catalogs.municipalities.map((m) => ({ code: m.code, parentCode: m.deptCode, name: m.name, isSystem: m.isSystem, isActive: m.isActive }));
    }
  }, [catalogs, tab]);

  const q = normalizeKey(search);
  const visible = rows.filter((r) => (tab !== "municipalities" || !deptFilter || r.parentCode === deptFilter) && (!q || normalizeKey(`${r.parentCode}${r.code} ${r.name}`).includes(q)));
  const departmentName = (code: string) => catalogs?.departments.find((d) => d.code === code)?.name ?? "";
  const current = TABS.find((t) => t.key === tab)!;
  const LIMIT = 300;

  async function save(input: CatalogEntryInput) {
    try {
      await exogenaService.saveCatalogEntry(input);
      toast("Catálogo actualizado.");
      setEditing(null);
      await reload();
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  async function remove(row: Row) {
    try {
      await exogenaService.deleteCatalogEntry(tab, row.code, row.parentCode || undefined);
      toast("Entrada eliminada.");
      setDeleting(null);
      await reload();
    } catch (e) {
      toast(errorMessage(e), "error");
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Catálogos Exógena"
        description={`Tipos de documento, países, departamentos y municipios que usan los terceros, los socios y los formatos de Información Exógena.${catalogs ? ` Versión ${catalogs.version} · ${catalogs.source}.` : ""}`}
        actions={
          extra ? undefined : (
            <>
              <Button icon={<History size={15} />} onClick={() => setShowAudit((v) => !v)}>
                {showAudit ? "Ocultar historial" : "Historial de ajustes"}
              </Button>
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing({ row: null })}>
                Agregar entrada
              </Button>
            </>
          )
        }
      />
      <div className="segmented" role="tablist" aria-label="Catálogo" style={{ marginBottom: 12 }}>
        {[...TABS, ...EXTRA_TABS].map((t) => (
          <button key={t.key} role="tab" aria-selected={selectedTab === t.key} className={selectedTab === t.key ? "is-active" : ""} onClick={() => { setTab(t.key); setSearch(""); setDeptFilter(""); }}>
            {t.label}
          </button>
        ))}
      </div>
      {extra === "concepts_1001" ? (
        <Concepts1001Panel />
      ) : extra === "title_types" ? (
        <TitleTypesPanel />
      ) : extra === "aliases" ? (
        <AliasesPanel />
      ) : extra === "purchase_rules" ? (
        <RulesPanel />
      ) : !catalogs ? (
        <Loader />
      ) : (
        <>
          <Card
            flush
            title={current.label}
            actions={
              <>
                {tab === "municipalities" && (
                  <Select aria-label="Departamento" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                    <option value="">Todos los departamentos</option>
                    {catalogs.departments.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.code} — {d.name}
                      </option>
                    ))}
                  </Select>
                )}
                <div className="search">
                  <Search size={14} />
                  <Input placeholder="Buscar por código o nombre" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </>
            }
          >
            {visible.length === 0 ? (
              <EmptyState icon={<Search size={20} />} title="Sin resultados" description="Ninguna entrada coincide con la búsqueda." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>{tab === "document_types" ? "Descripción" : "Nombre"}</th>
                      {tab === "municipalities" && <th>Departamento</th>}
                      <th>Origen</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.slice(0, LIMIT).map((r) => (
                      <tr key={`${r.parentCode}${r.code}`}>
                        <td className="mono selectable">{tab === "municipalities" ? `${r.parentCode}${r.code}` : r.code}</td>
                        <td className="table__primary">{r.name}</td>
                        {tab === "municipalities" && <td>{departmentName(r.parentCode)}</td>}
                        <td>
                          <Badge tone={r.isSystem ? "dark" : "gold"}>{r.isSystem ? "Sistema" : "Propio"}</Badge>
                        </td>
                        <td>{r.isActive ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                        <td className="actions">
                          <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => setEditing({ row: r })} />
                          {!r.isSystem && <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setDeleting(r)} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visible.length > LIMIT && <p className="muted" style={{ padding: 12 }}>Se muestran las primeras {LIMIT} de {visible.length}: usa la búsqueda o el filtro de departamento.</p>}
              </div>
            )}
          </Card>
          {showAudit && (
            <Card flush title="Historial de ajustes" description="Todo cambio a un catálogo queda registrado.">
              {audit === null ? (
                <Loader />
              ) : audit.length === 0 ? (
                <EmptyState icon={<History size={20} />} title="Sin ajustes" description="Los catálogos están como los entrega la aplicación." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Catálogo</th>
                        <th>Código</th>
                        <th>Cambio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((a) => (
                        <tr key={a.id}>
                          <td>{formatDateTimeForDisplay(a.changedAt)}</td>
                          <td>{TABS.find((t) => t.key === a.catalog)?.label}</td>
                          <td className="mono">{a.code}</td>
                          <td>
                            {ACTION_LABEL[a.action]}
                            {a.oldValue ? ` «${a.oldValue}»` : ""}
                            {a.newValue ? ` → «${a.newValue}»` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      <EntryModal
        open={!!editing}
        tab={tab}
        codeHint={current.codeHint}
        row={editing?.row ?? null}
        departments={catalogs?.departments ?? []}
        defaultDepartment={deptFilter}
        onClose={() => setEditing(null)}
        onSave={save}
      />
      <ConfirmDialog open={!!deleting} danger title="Eliminar entrada" confirmLabel="Eliminar" message={<>Se eliminará <strong>{deleting?.name}</strong>. Solo se pueden eliminar entradas propias que ningún tercero ni socio use.</>} onCancel={() => setDeleting(null)} onConfirm={() => deleting && void remove(deleting)} />
    </>
  );
}

interface EntryProps {
  open: boolean;
  tab: CatalogKey;
  codeHint: string;
  row: Row | null;
  departments: { code: string; name: string }[];
  defaultDepartment: string;
  onClose: () => void;
  onSave: (input: CatalogEntryInput) => Promise<void>;
}

function EntryModal({ open, tab, codeHint, row, departments, defaultDepartment, onClose, onSave }: EntryProps) {
  const [code, setCode] = useState("");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(row?.code ?? "");
    setParent(row?.parentCode ?? defaultDepartment);
    setName(row?.name ?? "");
    setActive(row?.isActive ?? true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onSave({ catalog: tab, code: code.trim(), parentCode: tab === "municipalities" ? parent : undefined, name: name.trim(), isActive: active });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      size="sm"
      title={row ? (row.isSystem ? "Ajustar entrada de sistema" : "Editar entrada") : "Agregar entrada"}
      description={row?.isSystem ? "Los valores del sistema no se eliminan: puedes renombrarlos o desactivarlos." : undefined}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {tab === "municipalities" && (
          <Field label="Departamento" required>
            {(id) => (
              <Select id={id} value={parent} disabled={!!row} onChange={(e) => setParent(e.target.value)}>
                <option value="">Seleccionar…</option>
                {departments.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Código" required hint={`${codeHint}. Se guarda como texto, con sus ceros.`}>
          {(id) => <Input id={id} value={code} readOnly={!!row} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} inputMode="numeric" autoFocus={!row} />}
        </Field>
        <Field label={tab === "document_types" ? "Descripción" : "Nombre"} required>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!row} />}
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activo (se ofrece al elegir)
        </label>
      </div>
    </Modal>
  );
}
