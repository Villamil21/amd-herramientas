import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Alert, Button, Loader, Modal, useToast } from "../../../components/ui";
import { companyService } from "../../../services/companyService";
import { base64ToBytes } from "./documentHistory";
import { PdfViewer } from "./PdfViewer";

export interface PreviewTarget {
  storedFile: string;
  fileName: string;
  title: string;
}

/** Vista previa y descarga de cualquier versión (registrada o recién cargada). */
export function DocumentPreviewModal({ target, onClose }: { target: PreviewTarget | null; onClose: () => void }) {
  const toast = useToast();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBytes(null);
    setError(null);
    if (!target) return;
    let current = true;
    companyService.readDocument(target.storedFile).then(
      (b64) => current && setBytes(base64ToBytes(b64)),
      (e) => current && setError((e as Error).message),
    );
    return () => {
      current = false;
    };
  }, [target]);

  async function download() {
    if (!target) return;
    setSaving(true);
    try {
      const path = await companyService.downloadDocument(target.storedFile, target.fileName);
      if (path) toast("Documento guardado.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={target !== null}
      size="xl"
      title={target?.title ?? ""}
      description={target?.fileName}
      onClose={onClose}
      footer={
        <>
          <Button icon={<Download size={14} />} onClick={() => void download()} loading={saving} disabled={!!error}>
            Descargar
          </Button>
          <Button variant="primary" onClick={onClose}>
            Cerrar
          </Button>
        </>
      }
    >
      {error ? <Alert tone="danger">{error}</Alert> : bytes ? <PdfViewer bytes={bytes} /> : <Loader />}
    </Modal>
  );
}
