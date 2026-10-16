import { useState } from "react";
import { Button } from "../../components/ui";
import { ConflictAlerts, DocumentCards, ImportReviewModal, ImportStatusLine } from "./import/CompanyDocuments";
import { companyStatus } from "./companyStatus";
import type { TabProps } from "./tabs";

/** Resumen y documentos: RUT y Cámara, una sola línea de estado de la importación y las discrepancias por resolver. */
export function ResumenTab({ values, imports, company, goTo }: TabProps & { goTo: (tab: "generales" | "societaria" | "fiscal") => void }) {
  const [reviewing, setReviewing] = useState(false);
  const status = company ? companyStatus({ ...company, ...values, documents: company.documents }) : null;
  return (
    <div className="stack">
      <DocumentCards saved={company?.documents ?? []} imports={imports} />
      <ImportStatusLine values={values} imports={imports} onReview={() => setReviewing(true)} />
      <ConflictAlerts imports={imports} />
      {!company && !imports.pending.length && <span className="muted">Carga el RUT y la Cámara de Comercio para precargar los datos, o ve directo a «Datos generales» para escribirlos. Los socios se habilitan al guardar la empresa por primera vez.</span>}
      {status && status.state !== "lista" && (status.state === "revision" || status.missing.some((m) => !/sin cargar/.test(m))) && (
        <div className="import-status" role="status">
          <span>{status.state === "faltan" ? "Faltan datos: " : "Por revisar: "}{(status.state === "faltan" ? status.missing : status.review).join(" · ")}</span>
          <Button size="sm" variant="ghost" onClick={() => goTo(status.state === "faltan" && status.missing.some((m) => /Socios|Capital|Representante/.test(m)) ? "societaria" : status.review.length && status.state === "revision" ? "fiscal" : "generales")}>
            Completar
          </Button>
        </div>
      )}
      <ImportReviewModal open={reviewing} values={values} imports={imports} onClose={() => setReviewing(false)} />
    </div>
  );
}
