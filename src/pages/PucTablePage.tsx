import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, Loader, Modal, PageHeader, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { pucService } from "../services/pucService";
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
type Dialog = { kind: "edit" | "classify" | "delete" | "deactivate" | "references"; code: string } | null;

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
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

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
  const selected = dialog ? byCode.get(dialog.code) : undefined;
  const uses = (code: string) => usageMap.get(code) ?? 0;

  async function reload() {
    await Promise.all([data.reloadCodes(), data.reloadMappings(), usage.reload()]);
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
    onEdit: (code) => setDialog({ kind: "edit", code }),
    onClassify: (code) => setDialog({ kind: "classify", code }),
    onDelete: (code) => setDialog({ kind: uses(code) > 0 ? "references" : "delete", code }),
    onReferences: (code) => setDialog({ kind: "references", code }),
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
          <PucCatalog index={data.index} admin={admin} maxHeight="calc(100vh - 340px)" />
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
      <EditPucCodeModal code={dialog?.kind === "edit" ? (selected ?? null) : null} inUse={dialog ? uses(dialog.code) > 0 : false} index={data.index} onClose={() => setDialog(null)} onSaved={reload} />
      <ClassifyPucModal
        open={dialog?.kind === "classify"}
        pucCode={dialog?.code ?? ""}
        concept={selected?.concept ?? ""}
        catalog={data.catalog}
        mappings={data.mappingMap}
        onClose={() => setDialog(null)}
        onSaved={data.reloadMappings}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        title={`¿Eliminar el código PUC ${dialog?.code ?? ""} — ${selected?.concept ?? ""}?`}
        message="Esta acción eliminará el código del catálogo. No tiene movimientos ni referencias; si estaba clasificado en EEFF, su clasificación también se elimina."
        confirmLabel="Eliminar"
        danger
        loading={busy}
        onConfirm={() => dialog && void run(() => pucService.deleteCode(dialog.code), `Código ${dialog.code} eliminado.`)}
        onCancel={() => setDialog(null)}
      />
      <DeactivateDialog
        code={dialog?.kind === "deactivate" ? (selected ?? null) : null}
        busy={busy}
        onConfirm={(code) => void run(() => pucService.setActive(code, false), `Cuenta ${code} desactivada.`)}
        onCancel={() => setDialog(null)}
      />
      <ReferencesModal
        code={dialog?.kind === "references" ? (selected ?? null) : null}
        busy={busy}
        onDeactivate={(code) => void run(() => pucService.setActive(code, false), `Cuenta ${code} desactivada.`)}
        onClose={() => setDialog(null)}
      />
    </>
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
