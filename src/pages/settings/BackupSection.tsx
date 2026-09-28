import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Alert, Button, Card, ConfirmDialog, useToast } from "../../components/ui";
import { backupService } from "../../services/backupService";
import type { BackupSummary } from "../../types/models";

function formatExportDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" });
}

export function BackupSection() {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pending, setPending] = useState<BackupSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    setExporting(true);
    setError(null);
    try {
      const path = await backupService.export();
      if (path) toast("Copia de seguridad exportada.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function pickBackup() {
    setPicking(true);
    setError(null);
    try {
      setPending(await backupService.pick());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPicking(false);
    }
  }

  async function applyBackup() {
    setApplying(true);
    try {
      await backupService.apply();
      setPending(null);
      toast("Datos restaurados correctamente.");
    } catch (e) {
      setPending(null);
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card title="Copia de seguridad" description="Traslada tu información a otro computador o recupérala si es necesario.">
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="row row--between">
          <div>
            <strong>Exportar datos</strong>
            <p className="muted" style={{ fontSize: 13 }}>
              Genera un archivo .json con empresas (incluidos sus logos), conceptos, firmantes (incluidas sus firmas PNG) y configuración.
            </p>
          </div>
          <Button icon={<Download size={15} />} onClick={() => void exportData()} loading={exporting}>
            Exportar datos
          </Button>
        </div>
        <div className="row row--between">
          <div>
            <strong>Importar datos</strong>
            <p className="muted" style={{ fontSize: 13 }}>
              Restaura un archivo exportado. Reemplaza la información actual después de tu confirmación.
            </p>
          </div>
          <Button icon={<Upload size={15} />} onClick={() => void pickBackup()} loading={picking}>
            Importar datos
          </Button>
        </div>
        <Alert tone="info">
          Antes de importar y antes de cada actualización que modifique la base de datos, la aplicación guarda una copia automática (se
          conservan las últimas 5).
        </Alert>
      </div>

      <ConfirmDialog
        open={!!pending}
        danger
        title="Reemplazar datos actuales"
        confirmLabel="Reemplazar datos"
        loading={applying}
        onCancel={() => {
          setPending(null);
          void backupService.discard();
        }}
        onConfirm={() => void applyBackup()}
        message={
          pending && (
            <div className="stack stack--sm">
              <span>
                El archivo <strong>{pending.fileName}</strong> ({formatExportDate(pending.exportedAt)}, versión {pending.appVersion}) contiene:
              </span>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>{pending.companies} empresas</li>
                <li>{pending.concepts} conceptos</li>
                {pending.signers !== null && <li>{pending.signers} firmantes (con sus firmas PNG)</li>}
                <li>{pending.settings} ajustes de configuración</li>
              </ul>
              <span>
                {pending.signers !== null ? "Las empresas, conceptos, firmantes y configuración" : "Las empresas, conceptos y configuración"}{" "}
                actuales <strong>se reemplazarán</strong>. Se guardará una copia automática antes de continuar.
                {pending.signers === null && " Este backup no incluye firmantes: se conservan los actuales."}
              </span>
            </div>
          )
        }
      />
    </Card>
  );
}
