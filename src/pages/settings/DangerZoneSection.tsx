import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Card, ConfirmDialog, Field, Input, Modal } from "../../components/ui";
import { appService } from "../../services/appService";
import { RESET_PHRASE, type ResetOutcome } from "../../types/exogena";

const DELETED = [
  "Empresas, socios y sus logos, RUT y Cámaras de Comercio",
  "Proveedores y terceros, con sus datos tributarios",
  "Firmas y sus imágenes",
  "Catálogos configurables y códigos PUC personalizados",
  "Movimientos, lotes, planillas, empleados y obligaciones tributarias",
  "Estados Financieros, incluida toda la clasificación (PUC → líneas, líneas y secciones propias, configuraciones por módulo, reglas y configuraciones de extractos)",
  "Información Exógena y sus registros",
];

/**
 * Zona de peligro: reinicia todos los datos de la aplicación. Solo se ejecuta cuando el usuario escribe la frase exacta y confirma
 * por segunda vez; antes se crea una copia recuperable. Después de reiniciar, solo quedan el catálogo estructural y las
 * configuraciones base que entrega la aplicación.
 */
export function DangerZoneSection() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ResetOutcome | null>(null);

  function close() {
    if (busy) return;
    setOpen(false);
    setPhrase("");
    setConfirming(false);
    setError(null);
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      setDone(await appService.resetAppData(phrase, true));
      setConfirming(false);
      setOpen(false);
    } catch (e) {
      setConfirming(false);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** La app vuelve a su estado inicial: se recarga para que nada quede apuntando a datos que ya no existen. */
  function reload() {
    window.location.hash = "#/herramientas";
    window.location.reload();
  }

  return (
    <>
      <Card className="card--danger" title="Zona de peligro" description="Acciones que no se pueden deshacer desde la aplicación.">
        <div className="row row--between" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="stack stack--sm" style={{ flex: "1 1 420px" }}>
            <strong>Reiniciar datos de la aplicación</strong>
            <span className="muted">Elimina todos los datos operativos y deja la aplicación como recién instalada. Antes se crea una copia de seguridad recuperable en la carpeta de datos.</span>
          </div>
          <Button variant="danger" icon={<TriangleAlert size={15} />} onClick={() => setOpen(true)}>
            Reiniciar datos…
          </Button>
        </div>
      </Card>

      <Modal
        open={open}
        size="md"
        title="Reiniciar datos de la aplicación"
        description="Esta acción vacía la aplicación. No se ejecuta sola ni durante las actualizaciones."
        onClose={close}
        locked={busy}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={phrase !== RESET_PHRASE} onClick={() => setConfirming(true)}>
              Continuar
            </Button>
          </>
        }
      >
        <div className="stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <Alert tone="danger" title="Se eliminarán">
            <ul>
              {DELETED.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            También se borran los archivos asociados (logos, firmas, RUT y Cámaras). Después solo quedan el catálogo estructural y las configuraciones base de la aplicación: ninguna clasificación, saldo ni decisión anterior sobrevive.
          </Alert>
          <Field label={`Escribe exactamente ${RESET_PHRASE} para continuar`} required>
            {(id) => <Input id={id} value={phrase} autoComplete="off" spellCheck={false} onChange={(e) => setPhrase(e.target.value)} placeholder={RESET_PHRASE} />}
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        danger
        title="Última confirmación"
        confirmLabel="Sí, reiniciar todos los datos"
        loading={busy}
        message="¿Seguro que quieres eliminar todos los datos de la aplicación? Se creará una copia de seguridad antes de vaciarla."
        onCancel={() => setConfirming(false)}
        onConfirm={() => void reset()}
      />

      <Modal
        open={!!done}
        size="sm"
        title="Datos reiniciados"
        onClose={reload}
        locked
        footer={
          <Button variant="primary" onClick={reload}>
            Volver al inicio
          </Button>
        }
      >
        {done && (
          <div className="stack">
            <span>La aplicación quedó como recién instalada ({done.removedFiles} archivos eliminados).</span>
            <span className="muted">Copia de seguridad previa: <code className="mono">{done.snapshotFile}</code> (carpeta «backups» de los datos de la aplicación).</span>
            {done.warnings.length > 0 && <Alert tone="warning">No se pudieron borrar algunos archivos: {done.warnings.join(", ")}.</Alert>}
          </div>
        )}
      </Modal>
    </>
  );
}
