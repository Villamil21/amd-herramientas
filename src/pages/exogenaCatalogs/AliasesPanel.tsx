import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, EmptyState, Field, Input, Loader, Modal, Select, useToast } from "../../components/ui";
import { placeKey } from "../../modules/exogena/domain/territory";
import { docTypeKey } from "../../modules/exogena/domain/thirdParty";
import { useCatalogs } from "../../modules/exogena/hooks";
import { catalogExtrasService, purchasesService } from "../../services/purchasesService";
import { errorMessage } from "../../services/tauri";
import { ALIAS_KIND_LABEL, type AliasKind, type ExoAlias, type TitleType } from "../../types/purchases";
import { normalizeKey } from "../../utils/text";

const KINDS = Object.keys(ALIAS_KIND_LABEL) as AliasKind[];

/** Clave con la que se compara un alias: los lugares se comparan sin tildes ni puntuación; los encabezados como en Compras. */
export const aliasKeyOf = (kind: AliasKind, alias: string) => (kind === "title_type" ? normalizeKey(alias) : kind === "document_type" ? docTypeKey(alias) : placeKey(alias));

/**
 * Alias persistentes: otro nombre con el que llega un dato (en facturas o archivos) y el valor oficial al que equivale. Quedan
 * guardados y se aplican solos en las próximas cargas; no reemplazan al catálogo oficial ni se aplican si el valor ya no existe.
 */
export function AliasesPanel() {
  const toast = useToast();
  const { catalogs } = useCatalogs();
  const [kind, setKind] = useState<AliasKind>("title_type");
  const [rows, setRows] = useState<ExoAlias[] | null>(null);
  const [titles, setTitles] = useState<TitleType[]>([]);
  const [editing, setEditing] = useState<{ row: ExoAlias | null } | null>(null);
  const [deleting, setDeleting] = useState<ExoAlias | null>(null);

  const reload = useCallback(() => catalogExtrasService.aliases(kind).then(setRows, (e) => toast(errorMessage(e), "error")), [kind, toast]);
  useEffect(() => {
    setRows(null);
    void reload();
  }, [reload]);
  useEffect(() => void purchasesService.titleTypes().then(setTitles, () => undefined), []);

  const targetName = (a: ExoAlias): string => {
    if (a.kind === "title_type") return titles.find((t) => t.titleKey === a.target)?.displayTitle ?? `${a.target} (no existe)`;
    if (!catalogs) return a.target;
    if (a.kind === "document_type") {
      const d = catalogs.documentTypes.find((x) => x.code === a.target);
      return d ? `${d.code} — ${d.description}` : `${a.target} (no existe)`;
    }
    if (a.kind === "country") return catalogs.countries.find((c) => c.code === a.target)?.name ?? `${a.target} (no existe)`;
    if (a.kind === "department") return catalogs.departments.find((d) => d.code === a.target)?.name ?? `${a.target} (no existe)`;
    return catalogs.municipalities.find((m) => m.code === a.target && m.deptCode === a.parent)?.name ?? `${a.target} (no existe)`;
  };
  const deptName = (code: string) => (code ? catalogs?.departments.find((d) => d.code === code)?.name ?? code : "Cualquiera");

  const remove = async (a: ExoAlias) => {
    try {
      await catalogExtrasService.deleteAlias(a.kind, a.aliasKey, a.parent);
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
        title="Alias"
        description="Otros nombres que equivalen a un valor oficial. Se aplican solos al importar facturas."
        actions={
          <>
            <Select aria-label="Tipo de alias" value={kind} onChange={(e) => setKind(e.target.value as AliasKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {ALIAS_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing({ row: null })}>
              Agregar alias
            </Button>
          </>
        }
      >
        {rows === null ? (
          <Loader />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin alias" description={`Aún no hay alias de ${ALIAS_KIND_LABEL[kind].toLowerCase()}.`} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Alias</th>
                  {kind === "municipality" && <th>Departamento</th>}
                  <th>Equivale a</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.aliasKey}|${r.parent}`}>
                    <td className="table__primary">{r.alias}</td>
                    {kind === "municipality" && <td>{deptName(r.parent)}</td>}
                    <td>{targetName(r)}</td>
                    <td className="actions">
                      <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => setEditing({ row: r })} />
                      <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setDeleting(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <AliasModal
          kind={kind}
          row={editing.row}
          titles={titles}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
      <ConfirmDialog open={!!deleting} danger title="Eliminar alias" confirmLabel="Eliminar" message={<>«{deleting?.alias}» dejará de reconocerse en las próximas cargas. Lo ya importado no cambia.</>} onCancel={() => setDeleting(null)} onConfirm={() => deleting && void remove(deleting)} />
    </>
  );
}

function AliasModal({ kind, row, titles, onClose, onSaved }: { kind: AliasKind; row: ExoAlias | null; titles: TitleType[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const { catalogs } = useCatalogs();
  const [alias, setAlias] = useState(row?.alias ?? "");
  const [parent, setParent] = useState(row?.parent ?? "");
  const [target, setTarget] = useState(row?.target ?? "");
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    if (kind === "title_type") return titles.map((t) => ({ code: t.titleKey, label: t.displayTitle }));
    if (!catalogs) return [];
    if (kind === "document_type") return catalogs.documentTypes.filter((d) => d.isActive).map((d) => ({ code: d.code, label: `${d.code} — ${d.description}` }));
    if (kind === "country") return catalogs.countries.filter((c) => c.isActive).map((c) => ({ code: c.code, label: `${c.code} — ${c.name}` }));
    if (kind === "department") return catalogs.departments.filter((d) => d.isActive).map((d) => ({ code: d.code, label: `${d.code} — ${d.name}` }));
    return catalogs.municipalities.filter((m) => m.isActive && m.deptCode === parent).map((m) => ({ code: m.code, label: `${m.code} — ${m.name}` }));
  }, [kind, catalogs, titles, parent]);

  const key = aliasKeyOf(kind, alias);
  const valid = key !== "" && target !== "" && (kind !== "municipality" || parent !== "") && options.some((o) => o.code === target);

  async function save() {
    setSaving(true);
    try {
      // Cambiar la clave de un alias existente equivale a crear otro: el anterior se elimina.
      if (row && (row.aliasKey !== key || row.parent !== parent)) await catalogExtrasService.deleteAlias(kind, row.aliasKey, row.parent);
      await catalogExtrasService.saveAlias(kind, key, kind === "municipality" ? parent : "", alias, target);
      toast("Alias guardado.");
      await onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`${row ? "Editar" : "Agregar"} alias de ${ALIAS_KIND_LABEL[kind].toLowerCase()}`}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Alias" required hint={kind === "title_type" ? "Tal como aparece en el PDF." : kind === "document_type" ? "Como lo escribe la factura: CC, C.C., Cédula de ciudadanía… (no distingue tildes, puntos ni espacios)." : "Como llega escrito en la factura o el archivo."}>
          {(id) => <Input id={id} value={alias} onChange={(e) => setAlias(e.target.value)} autoFocus />}
        </Field>
        {kind === "municipality" && (
          <Field label="Departamento" required>
            {(id) => (
              <Select id={id} value={parent} onChange={(e) => { setParent(e.target.value); setTarget(""); }}>
                <option value="">Elige…</option>
                {(catalogs?.departments ?? []).filter((d) => d.isActive).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Equivale a" required>
          {(id) => (
            <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)} disabled={kind === "municipality" && !parent}>
              <option value="">Elige…</option>
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {key === "" && alias.trim() !== "" && <Alert tone="warning">El alias necesita letras o números.</Alert>}
      </div>
    </Modal>
  );
}
