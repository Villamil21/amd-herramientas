import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, ListTree, Pencil, Plus, Trash2, X } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Loader, Modal, PageHeader, Select, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { pucService } from "../services/pucService";
import { purchasesService } from "../services/purchasesService";
import { errorMessage } from "../services/tauri";
import type { PucCode, PucUsage } from "../types/models";
import { formatInteger } from "../utils/format";
import { PucCatalog, type PucCatalogAdmin } from "../modules/financial-statements/puc-codes/components/PucCatalog";
import { configItems, usageLabel } from "../modules/financial-statements/puc-codes/services/pucUsage";
import { ClassifyPucModal, lineLabel } from "../modules/financial-statements/shared/components/ClassifyPucModal";
import { CreatePucCodeModal } from "../modules/financial-statements/shared/components/CreatePucCodeModal";
import { EditPucCodeModal } from "../modules/financial-statements/shared/components/EditPucCodeModal";
import { useFsData } from "../modules/financial-statements/shared/useFsData";

const IN_USE_DELETE = "Este código PUC ya tiene movimientos o referencias asociadas y no puede eliminarse. Puedes desactivarlo para que no aparezca en nuevas selecciones.";

/** Ventana abierta sobre una fila. */
type Dialog = { kind: "sheet" | "edit" | "classify" | "delete" | "deactivate" | "references"; code: string } | null;

/**
 * Datos → Tabla de Códigos PUC: catálogo global (oficial + personalizados)
 * administrable. Editar el concepto, cambiar el número de un personalizado sin
 * uso, eliminar personalizados sin uso, desactivar / reactivar y clasificar en
 * EEFF. Las cuentas oficiales nunca se eliminan; nada de esto toca los
 * movimientos ya enviados.
 */
export function PucTablePage() {
  const toast = useToast();
  const data = useFsData();
  const usage = useAsync(() => pucService.listUsage(), []);
  const concepts1001 = useAsync(() => purchasesService.pucConcepts1001(), []);
  const conceptMap = useMemo(() => new Map((concepts1001.data ?? []).map((c) => [c.pucCode, c.conceptCode])), [concepts1001.data]);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  /** Selección para la clasificación masiva. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const byCode = useMemo(() => new Map(data.codes.map((c) => [c.code, c])), [data.codes]);
  const usageMap = useMemo(() => new Map((usage.data ?? []).map((u) => [u.code, u.total])), [usage.data]);
  const lineById = useMemo(() => new Map((data.catalog?.lines ?? []).map((l) => [l.id, l])), [data.catalog]);
  const classification = useMemo(
    () =>
      new Map(
        data.mappings.map((m) => {
          const line = m.lineId != null ? lineById.get(m.lineId) : undefined;
          return [m.pucCode, { excluded: m.excluded, label: line ? lineLabel(line) : "—" }];
        }),
      ),
    [data.mappings, lineById],
  );
  const current = dialog ? byCode.get(dialog.code) : undefined;
  const selected_ = (code: string) => byCode.get(code) ?? null;
  const uses = (code: string) => usageMap.get(code) ?? 0;

  async function reload() {
    await Promise.all([data.reloadCodes(), data.reloadMappings(), usage.reload(), concepts1001.reload()]);
  }

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      toast(message);
      setDialog(null);
      await reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const admin: PucCatalogAdmin = {
    usage: usageMap,
    classification,
    concept1001: conceptMap,
    onEdit: (code) => setDialog({ kind: "edit", code }),
    onClassify: (code) => setDialog({ kind: "classify", code }),
    onDelete: (code) => setDialog({ kind: uses(code) > 0 ? "references" : "delete", code }),
    onReferences: (code) => setDialog({ kind: "references", code }),
    onOpen: (code) => setDialog({ kind: "sheet", code }),
    selected,
    onSelect: (codes, checked) =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const c of codes) {
          if (checked) next.add(c);
          else next.delete(c);
        }
        return next;
      }),
    onToggleActive: (code) => {
      if (byCode.get(code)?.active === false) void run(() => pucService.setActive(code, true), `Cuenta ${code} reactivada.`);
      else setDialog({ kind: "deactivate", code });
    },
  };

  const customCount = data.index.custom.size;
  const inactiveCount = data.index.inactive.size;

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Tabla de Códigos PUC"
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            Nueva cuenta PUC
          </Button>
        }
      />
      {usage.error && <Alert tone="danger">{usage.error}</Alert>}
      {data.codes.length === 0 ? (
        <Loader />
      ) : (
        <Card
          flush
          title="Catálogo de cuentas"
          description={`${formatInteger(data.index.all.length)} códigos · ${formatInteger(customCount)} personalizados${inactiveCount ? ` · ${inactiveCount === 1 ? "1 inactivo" : `${formatInteger(inactiveCount)} inactivos`}` : ""} · Global para todas las empresas. Las cuentas oficiales no se eliminan; un código con movimientos o referencias solo se desactiva.`}
        >
          {selected.size > 0 && (
            <div className="bulk-bar" role="region" aria-label="Selección">
              <span>
                <strong>{selected.size === 1 ? "1 cuenta seleccionada" : `${formatInteger(selected.size)} cuentas seleccionadas`}</strong>
              </span>
              <Button size="sm" variant="primary" icon={<ListTree size={14} />} onClick={() => setBulkOpen(true)}>
                Clasificar en EEFF
              </Button>
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setSelected(new Set())}>
                Quitar selección
              </Button>
            </div>
          )}
          <PucCatalog index={data.index} admin={admin} maxHeight="calc(100vh - 380px)" />
        </Card>
      )}

      <CreatePucCodeModal
        open={creating}
        index={data.index}
        mappings={data.mappingMap}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          await reload();
          setCreating(false);
        }}
      />
      <EditPucCodeModal code={dialog?.kind === "edit" ? (current ?? null) : null} inUse={dialog ? uses(dialog.code) > 0 : false} index={data.index} onClose={() => setDialog(null)} onSaved={reload} />
      <ClassifyPucModal
        open={dialog?.kind === "classify"}
        pucCode={dialog?.code ?? ""}
        concept={current?.concept ?? ""}
        catalog={data.catalog}
        mappings={data.mappingMap}
        onClose={() => setDialog(null)}
        onSaved={data.reloadMappings}
      />
      <ClassifyPucModal
        open={bulkOpen}
        pucCode=""
        concept=""
        bulk={[...selected].sort().map((code) => ({ code, concept: byCode.get(code)?.concept ?? "" }))}
        catalog={data.catalog}
        mappings={data.mappingMap}
        onClose={() => setBulkOpen(false)}
        onSaved={async () => {
          setSelected(new Set());
          await data.reloadMappings();
        }}
      />
      <AccountSheet
        code={dialog?.kind === "sheet" ? selected_(dialog.code) : null}
        classification={dialog ? classification.get(dialog.code) : undefined}
        concept1001={dialog ? conceptMap.get(dialog.code) ?? "" : ""}
        onConcept1001Saved={concepts1001.reload}
        onClose={() => setDialog(null)}
        onAction={(kind) => dialog && (kind === "reactivate" ? void run(() => pucService.setActive(dialog.code, true), `Cuenta ${dialog.code} reactivada.`) : setDialog({ kind, code: dialog.code }))}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        title={`¿Eliminar el código PUC ${dialog?.code ?? ""} — ${current?.concept ?? ""}?`}
        message="Esta acción eliminará el código del catálogo. No tiene movimientos ni referencias; si estaba clasificado en EEFF, su clasificación también se elimina."
        confirmLabel="Eliminar"
        danger
        loading={busy}
        onConfirm={() => dialog && void run(() => pucService.deleteCode(dialog.code), `Código ${dialog.code} eliminado.`)}
        onCancel={() => setDialog(null)}
      />
      <DeactivateDialog
        code={dialog?.kind === "deactivate" ? (current ?? null) : null}
        busy={busy}
        onConfirm={(code) => void run(() => pucService.setActive(code, false), `Cuenta ${code} desactivada.`)}
        onCancel={() => setDialog(null)}
      />
      <ReferencesModal
        code={dialog?.kind === "references" ? (current ?? null) : null}
        busy={busy}
        onDeactivate={(code) => void run(() => pucService.setActive(code, false), `Cuenta ${code} desactivada.`)}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

type SheetAction = "edit" | "classify" | "deactivate" | "reactivate" | "delete";

/**
 * Ficha de una cuenta: código y concepto, tipo, estado, clasificación EEFF,
 * referencias y las acciones disponibles. «Eliminar» solo aparece si la cuenta
 * se puede eliminar; si no, se explica el motivo y se ofrece Desactivar.
 */
function AccountSheet({ code, classification, concept1001, onConcept1001Saved, onClose, onAction }: { code: PucCode | null; classification?: { label: string; excluded: boolean }; concept1001: string; onConcept1001Saved: () => unknown; onClose: () => void; onAction: (kind: SheetAction) => void }) {
  const { usage, error } = useCodeUsage(code);
  const used = (usage?.total ?? 0) > 0;
  const inactive = code?.active === false;
  const assignable = Boolean(code && (code.custom || /^\d{6}$/.test(code.code)));
  const deleteReason = !code ? "" : !code.custom ? "Las cuentas oficiales no se eliminan." : used ? IN_USE_DELETE : inactive ? "Reactívala para poder eliminarla." : "";
  return (
    <Modal
      open={code !== null}
      size="lg"
      title={`${code?.code ?? ""} — ${code?.concept ?? ""}`}
      onClose={onClose}
      footer={
        <>
          {code?.custom && !deleteReason && (
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => onAction("delete")} style={{ marginRight: "auto" }}>
              Eliminar
            </Button>
          )}
          <Button icon={<Pencil size={14} />} onClick={() => onAction("edit")}>
            Editar
          </Button>
          {assignable && (
            <Button icon={inactive ? <Eye size={14} /> : <EyeOff size={14} />} onClick={() => onAction(inactive ? "reactivate" : "deactivate")}>
              {inactive ? "Reactivar" : "Desactivar"}
            </Button>
          )}
          {assignable && (
            <Button variant="primary" icon={<ListTree size={14} />} onClick={() => onAction("classify")}>
              {classification ? "Cambiar clasificación" : "Clasificar en EEFF"}
            </Button>
          )}
        </>
      }
    >
      {code && (
        <div className="stack">
          <dl className="summary-grid" style={{ margin: 0 }}>
            <div className="summary-item">
              <span className="summary-item__label">Tipo</span>
              <span className="summary-item__value">{code.custom ? "Personalizada" : "Oficial"}</span>
            </div>
            <div className="summary-item">
              <span className="summary-item__label">Estado</span>
              <span className="summary-item__value">{inactive ? <Badge tone="warning">Inactiva</Badge> : <Badge tone="success">Activa</Badge>}</span>
            </div>
            <div className="summary-item" style={{ gridColumn: "span 2" }}>
              <span className="summary-item__label">Clasificación EEFF</span>
              <span className="summary-item__value">
                {!assignable ? "No aplica (solo se clasifican subcuentas de 6 dígitos o personalizadas)" : classification ? (classification.excluded ? "No afecta Estados Financieros" : classification.label) : used ? "⚠ Sin clasificar · en uso" : "Sin clasificar · sin uso"}
              </span>
            </div>
          </dl>
          {assignable && <Concept1001Editor code={code.code} value={concept1001} onSaved={onConcept1001Saved} />}
          <div className="stack stack--sm">
            <strong>Referencias</strong>
            {error && <Alert tone="danger">{error}</Alert>}
            {!usage && !error ? <Loader /> : usage && used ? <UsageList usage={usage} /> : usage ? <p className="muted" style={{ margin: 0 }}>Sin movimientos ni referencias.</p> : null}
          </div>
          {code.custom && deleteReason && (
            <Alert tone="info" title="No se puede eliminar">
              {deleteReason}
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Referencias de un código, leídas al abrir. */
function useCodeUsage(code: PucCode | null) {
  const [usage, setUsage] = useState<PucUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUsage(null);
    setError(null);
    if (!code) return;
    let alive = true;
    pucService.usage(code.code).then(
      (u) => alive && setUsage(u),
      (e) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [code]);
  return { usage, error };
}

function UsageList({ usage }: { usage: PucUsage }) {
  return (
    <ul className="stack stack--sm" style={{ margin: 0, paddingLeft: "1.2em" }}>
      {usage.items.map((i) => (
        <li key={i.kind}>{usageLabel(i.kind, i.count)}</li>
      ))}
    </ul>
  );
}

/**
 * «Ver referencias» y el intento de eliminar un código usado: explica por qué
 * no se puede eliminar y ofrece Desactivar.
 */
function ReferencesModal({ code, busy, onDeactivate, onClose }: { code: PucCode | null; busy: boolean; onDeactivate: (code: string) => void; onClose: () => void }) {
  const { usage, error } = useCodeUsage(code);
  const used = (usage?.total ?? 0) > 0;
  return (
    <Modal
      open={code !== null}
      title={`Referencias de ${code?.code ?? ""} — ${code?.concept ?? ""}`}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cerrar
          </Button>
          {code && code.active !== false && used && (
            <Button variant="primary" onClick={() => onDeactivate(code.code)} loading={busy}>
              Desactivar
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {!usage && !error ? (
          <Loader />
        ) : usage && used ? (
          <>
            {code?.custom && <Alert tone="warning">{IN_USE_DELETE}</Alert>}
            <UsageList usage={usage} />
          </>
        ) : usage ? (
          <p className="muted">Este código no tiene movimientos ni referencias.</p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Confirmar Desactivar: avisa si hay configuraciones que lo seguirán usando. */
function DeactivateDialog({ code, busy, onConfirm, onCancel }: { code: PucCode | null; busy: boolean; onConfirm: (code: string) => void; onCancel: () => void }) {
  const { usage } = useCodeUsage(code);
  const configs = configItems(usage ?? undefined);
  return (
    <ConfirmDialog
      open={code !== null}
      title={`¿Desactivar ${code?.code ?? ""} — ${code?.concept ?? ""}?`}
      message={
        <div className="stack stack--sm">
          <span>Dejará de aparecer en nuevas selecciones. Se conservan el código, sus movimientos, su clasificación en EEFF y el historial; puedes reactivarlo cuando quieras.</span>
          {configs.length > 0 && (
            <Alert tone="warning">
              Sigue configurado en: {configs.map((i) => usageLabel(i.kind, i.count)).join(", ")}. Esas configuraciones lo seguirán usando hasta que las cambies.
            </Alert>
          )}
        </div>
      }
      confirmLabel="Desactivar"
      loading={busy}
      onConfirm={() => code && onConfirm(code.code)}
      onCancel={onCancel}
    />
  );
}

/**
 * Concepto 1001 sugerido de la cuenta. Es solo una sugerencia: en Compras, costos y exógena toda propuesta queda «Por confirmar».
 * Se ofrece el catálogo 1001 del año actual (si no hay, se explica dónde crearlo).
 */
function Concept1001Editor({ code, value, onSaved }: { code: string; value: string; onSaved: () => unknown }) {
  const toast = useToast();
  const year = new Date().getFullYear();
  const concepts = useAsync(() => purchasesService.yearConcepts("1001", year), [year]);
  const [saving, setSaving] = useState(false);
  const active = (concepts.data ?? []).filter((c) => c.isActive);
  const save = async (conceptCode: string) => {
    setSaving(true);
    try {
      await purchasesService.setPucConcept1001(code, conceptCode || null);
      await onSaved();
      toast(conceptCode ? "Concepto 1001 sugerido guardado." : "Sugerencia eliminada.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Field label="Concepto 1001 sugerido" hint={active.length ? `Catálogo 1001 de ${year}. Solo sugiere; cada línea de compra se confirma.` : `No hay conceptos 1001 activos para ${year}: créalos en Datos → Catálogos Exógena.`}>
      {(id) => (
        <Select id={id} value={value} disabled={saving || concepts.loading} onChange={(e) => void save(e.target.value)}>
          <option value="">Sin sugerencia</option>
          {value && !active.some((c) => c.code === value) && <option value={value}>{value} (fuera del catálogo {year})</option>}
          {active.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.description}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
