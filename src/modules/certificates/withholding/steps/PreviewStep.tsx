import { FileDown, Pencil } from "lucide-react";
import { Alert, Button, Card } from "../../../../components/ui";
import { CertificatePreview } from "../CertificatePreview";
import type { CertificateDocument } from "../logic/certificateModel";

interface Props {
  doc: CertificateDocument;
  generating: boolean;
  error: string | null;
  onBack: () => void;
  onEdit: () => void;
  onGenerate: () => void;
}

export function PreviewStep({ doc, generating, error, onBack, onEdit, onGenerate }: Props) {
  return (
    <Card
      title="Vista previa del certificado"
      description="Así quedará el documento. La fecha y hora definitivas se asignan al momento de generar el PDF."
      footer={
        <div className="wizard-actions" style={{ width: "100%" }}>
          <div className="row">
            <Button variant="ghost" onClick={onBack} disabled={generating}>
              Volver
            </Button>
            <Button variant="ghost" icon={<Pencil size={14} />} onClick={onEdit} disabled={generating}>
              Editar información
            </Button>
          </div>
          <Button variant="primary" icon={<FileDown size={15} />} onClick={onGenerate} loading={generating} title="⌘S">
            Generar PDF
          </Button>
        </div>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <CertificatePreview doc={doc} />
        <p className="muted" style={{ fontSize: 12.5 }}>
          Archivo: <span className="mono selectable">{doc.fileName}</span>
        </p>
      </div>
    </Card>
  );
}
