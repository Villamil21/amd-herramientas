import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Loader, Modal, Select, useToast } from "../../components/ui";
import { purchasesService } from "../../services/purchasesService";
import { errorMessage } from "../../services/tauri";
import { TITLE_KIND_LABEL, type TitleKind, type TitleType } from "../../types/purchases";
import { normalizeKey } from "../../utils/text";

/**
 * Tipos de comprobante: el encabezado del PDF («FACTURA ELECTRÓNICA DE VENTA», «NOTA CRÉDITO ELECTRÓNICA»…) se homologa a Compra
 * (suma) o Devolución de compra (resta base, IVA y efectos; su IVA va a 1006). Un encabezado nuevo se pregunta una vez en Compras.
 */
export function TitleTypesPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<TitleType[] | null>(null);
  const [editing, setEditing] = useState<{ row: TitleType | null } | null>(null);
  const [deleting, setDeleting] = useState<TitleType | null>(null);
  const reload = useCallback(() => purchasesService.titleTypes().then(setRows, (e) => toast(errorMessage(e), "error")), [toast]);
  useEffect(() => void reload(), [reload]);

  const remove = async (r: TitleType) => {
    try {
      await purchasesService.deleteTitleType(r.titleKey);
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
        title="Tipos de comprobante"
        description="Homologación del encabezado del PDF a Compra o Devolución de compra."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing({ row: null })}>
            Agregar encabezado
          </Button>
        }
      >
        {rows === null ? (
          <Loader />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin encabezados" description="Los encabezados nuevos se clasifican al importar facturas." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Encabezado</th>
                  <th>Efecto</th>
                  <th>Origen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.titleKey}>
                    <td className="table__primary">{r.displayTitle}</td>
                    <td>
                      <Badge tone={r.kind === "return" ? "warning" : "success"}>{TITLE_KIND_LABEL[r.kind]}</Badge>
                    </td>
                    <td>
                      <Badge tone={r.isSystem ? "dark" : "gold"}>{r.isSystem ? "Sistema" : "Propio"}</Badge>
                    </td>
                    <td className="actions">
                      <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => setEditing({ row: r })} />
                      {!r.isSystem && <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setDeleting(r)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <TitleModal open={!!editing} row={editing?.row ?? null} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
      <ConfirmDialog open={!!deleting} danger title="Eliminar encabezado" confirmLabel="Eliminar" message={<>Las facturas con «{deleting?.displayTitle}» quedarán con el encabezado sin clasificar y bloquearán todos sus destinos hasta que lo vuelvas a clasificar.</>} onCancel={() => setDeleting(null)} onConfirm={() => deleting && void remove(deleting)} />
    </>
  );
}

function TitleModal({ open, row, onClose, onSaved }: { open: boolean; row: TitleType | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TitleKind>("purchase");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(row?.displayTitle ?? "");
    setKind(row?.kind ?? "purchase");
    setError(null);
  }, [open, row]);
  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await purchasesService.saveTitleType(row?.titleKey ?? normalizeKey(title), title.trim(), kind);
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      size="sm"
      title={row ? "Editar encabezado" : "Agregar encabezado"}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={() => void submit()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Encabezado del PDF" required hint="Como aparece en el documento.">{(id) => <Input id={id} value={title} readOnly={!!row} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Efecto" required>
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as TitleKind)}>
              <option value="purchase">{TITLE_KIND_LABEL.purchase} (suma)</option>
              <option value="return">{TITLE_KIND_LABEL.return} (resta; IVA a 1006)</option>
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
