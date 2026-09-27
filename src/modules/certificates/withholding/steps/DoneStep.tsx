import { CheckCircle2, FilePlus2, FolderOpen, FileText } from "lucide-react";
import { Button, Card, EmptyState, useToast } from "../../../../components/ui";
import { fileService } from "../../../../services/fileService";

interface Props {
  result: { path: string; fileName: string };
  onNew: () => void;
  onBackToPreview: () => void;
}

export function DoneStep({ result, onNew, onBackToPreview }: Props) {
  const toast = useToast();
  const run = (fn: () => Promise<void>) => fn().catch((e: Error) => toast(e.message, "error"));
  return (
    <Card>
      <EmptyState
        icon={<CheckCircle2 size={20} color="var(--color-success)" />}
        title="Certificado generado"
        description={
          <>
            Se guardó <strong>{result.fileName}</strong>
            <br />
            <span className="mono selectable" style={{ fontSize: 11.5 }}>
              {result.path}
            </span>
          </>
        }
        action={
          <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
            <Button variant="primary" icon={<FileText size={15} />} onClick={() => run(() => fileService.openSaved(result.path))}>
              Abrir PDF
            </Button>
            <Button icon={<FolderOpen size={15} />} onClick={() => run(() => fileService.revealSaved(result.path))}>
              Mostrar en Finder
            </Button>
            <Button variant="ghost" onClick={onBackToPreview}>
              Volver a la vista previa
            </Button>
            <Button variant="ghost" icon={<FilePlus2 size={15} />} onClick={onNew}>
              Nuevo certificado
            </Button>
          </div>
        }
      />
    </Card>
  );
}
