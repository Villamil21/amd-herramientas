import type { ReactNode } from "react";
import { FileText, FolderOpen, Upload } from "lucide-react";
import { Alert, Button, Card, useToast } from "../../../../components/ui";
import { fileService } from "../../../../services/fileService";
import type { ImportState } from "../useStatementImport";

interface Props {
  state: ImportState<unknown>;
  /** Datos de la cuenta y periodo que se muestran junto al archivo analizado. */
  details?: ReactNode;
  picking: boolean;
  busy: boolean;
  exportedPath: string | null;
  onPick: () => void;
}

/** Selección del PDF y estado del archivo: nombre, páginas y avance del análisis. */
export function StatementFileCard({ state, details, picking, busy, exportedPath, onPick }: Props) {
  const toast = useToast();
  const pickButton = (
    <Button variant={state.status === "idle" ? "primary" : "secondary"} icon={<Upload size={15} />} onClick={onPick} loading={picking} disabled={busy}>
      {state.status === "idle" ? "Seleccionar extracto PDF" : "Seleccionar otro PDF"}
    </Button>
  );

  return (
    <Card>
      {state.status === "idle" ? (
        <div className="row row--between">
          <p className="muted">El archivo se analiza en este equipo; no se envía a ningún servicio ni se guarda una copia.</p>
          {pickButton}
        </div>
      ) : (
        <div className="stack stack--sm">
          <div className="file-chip">
            <div className="file-chip__icon">
              <FileText size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="file-chip__name selectable">{state.fileName}</div>
              <div className="muted row" style={{ fontSize: "var(--text-sm)" }}>
                {state.pageCount !== undefined && <span>{state.pageCount === 1 ? "1 página" : `${state.pageCount} páginas`}</span>}
                {state.status === "analyzing" && (
                  <span className="row">
                    <span className="spinner" aria-hidden /> Analizando extracto…
                  </span>
                )}
                {state.status === "error" && <span>No se pudo analizar</span>}
                {state.status === "done" && details}
              </div>
            </div>
            {exportedPath && (
              <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => void fileService.revealSaved(exportedPath).catch((e: Error) => toast(e.message, "error"))}>
                Ver Excel en Finder
              </Button>
            )}
            {pickButton}
          </div>
          {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
        </div>
      )}
    </Card>
  );
}

/** "· Cuenta 431-00102-2 · 2026/02/01 a 2026/02/28" con lo que se haya extraído. */
export function AccountDetails({ accountNumber, periodFrom, periodTo }: { accountNumber?: string; periodFrom?: string; periodTo?: string }) {
  return (
    <>
      {accountNumber && <span>· Cuenta {accountNumber}</span>}
      {periodFrom && periodTo && (
        <span>
          · {periodFrom} a {periodTo}
        </span>
      )}
    </>
  );
}
