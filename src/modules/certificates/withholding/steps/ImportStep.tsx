import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { Alert, Button, Card } from "../../../../components/ui";
import type { ExcelAnalysis } from "../logic/excelAnalysis";

interface Props {
  analysis: ExcelAnalysis | null;
  loading: boolean;
  error: string | null;
  dragOver: boolean;
  onPick: () => void;
  onBack: () => void;
  onNext: () => void;
}

export function ImportStep({ analysis, loading, error, dragOver, onPick, onBack, onNext }: Props) {
  return (
    <Card
      title="Importar archivo Excel"
      description="Reporte de documentos electrónicos (.xlsx o .xls). Las columnas se identifican por el nombre del encabezado."
      footer={
        <div className="wizard-actions" style={{ width: "100%" }}>
          <Button variant="ghost" onClick={onBack}>
            Volver
          </Button>
          <Button variant="primary" onClick={onNext} disabled={!analysis}>
            Continuar
          </Button>
        </div>
      }
    >
      <div className="stack">
        <div
          className={`dropzone ${dragOver ? "is-over" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => !loading && onPick()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick()}
        >
          <div className="dropzone__icon">{loading ? <span className="spinner" /> : <UploadCloud size={20} />}</div>
          <strong>{loading ? "Leyendo archivo…" : "Selecciona o arrastra el archivo Excel"}</strong>
          <span>Formatos .xlsx y .xls · Atajo ⌘O</span>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        {analysis && !loading && (
          <div className="file-chip">
            <div className="file-chip__icon">
              <FileSpreadsheet size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="file-chip__name">{analysis.fileName}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Hoja «{analysis.sheetName}» · {analysis.documents.length} documentos
                {analysis.errors.length > 0 && ` · ${analysis.errors.length} ${analysis.errors.length === 1 ? "problema" : "problemas"} por revisar`}
              </div>
            </div>
            <Button size="sm" onClick={onPick}>
              Cambiar archivo
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
