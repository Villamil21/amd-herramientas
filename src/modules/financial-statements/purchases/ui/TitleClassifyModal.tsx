import { useState } from "react";
import { Button, Modal, useToast } from "../../../../components/ui";
import { purchasesService } from "../../../../services/purchasesService";
import { errorMessage } from "../../../../services/tauri";
import { TITLE_KIND_LABEL, type TitleKind } from "../../../../types/purchases";
import type { PurchasesData } from "../usePurchasesData";

/** Clasifica un encabezado nuevo como Compra (suma) o Devolución (resta); la homologación queda guardada para próximas cargas. */
export function TitleClassifyModal({ data, titleKey, title, onClose }: { data: PurchasesData; titleKey: string; title: string; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function choose(kind: TitleKind) {
    setBusy(true);
    try {
      await purchasesService.saveTitleType(titleKey, title, kind);
      await data.reloadTitleTypes();
      toast(`«${title}» quedó como ${TITLE_KIND_LABEL[kind].toLowerCase()}.`);
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Clasificar encabezado"
      description={`«${title}»: ¿suma como compra o resta como devolución? Decide tú; queda guardado para las próximas cargas.`}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => void choose("return")}>
            {TITLE_KIND_LABEL.return}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void choose("purchase")}>
            {TITLE_KIND_LABEL.purchase}
          </Button>
        </>
      }
    />
  );
}
