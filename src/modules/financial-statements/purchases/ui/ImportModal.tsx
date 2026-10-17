import { useState } from "react";
import { Alert, Button, Modal, useToast } from "../../../../components/ui";
import { purchasesService } from "../../../../services/purchasesService";
import { errorMessage } from "../../../../services/tauri";
import type { IdenticalUpload, PurchaseDocFileInput, SavePurchaseUploadOutcome } from "../../../../types/purchases";
import { formatDateForDisplay } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import { findCompanyByNit } from "../../shared/companyMatch";
import { folderFingerprints, planFolder, replaceFilesOf, uploadFor, type FolderPlan, type InvoiceFolder, type ReadResult } from "../import";
import type { PurchasesData } from "../usePurchasesData";

export interface PendingImport {
  folder: InvoiceFolder;
  results: ReadResult[];
}

interface Props {
  data: PurchasesData;
  pending: PendingImport | null;
  onClose: () => void;
}

const plural = (n: number, one: string, many: string) => `${formatInteger(n)} ${n === 1 ? one : many}`;

/** Año con más facturas, para dejar la selección de Compras donde acaba de caer la carga. */
function topYear(files: PurchaseDocFileInput[]): number | null {
  const counts = new Map<number | null, number>();
  for (const f of files) counts.set(f.year, (counts.get(f.year) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (b[0] ?? 0) - (a[0] ?? 0))[0]?.[0] ?? null;
}

/**
 * Resumen de una carpeta leída, antes de guardarla. La empresa y el año no se piden: salen del «Datos del Adquiriente /
 * Comprador» (NIT) y de la fecha de expedición. Una carga es de un único NIT comprador: el de la mayoría; las facturas de otros
 * NIT se señalan y solo se guardan, en cargas separadas, si el usuario lo decide.
 */
export function ImportModal({ data, pending, onClose }: Props) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<{ buyerNit: string; result: SavePurchaseUploadOutcome } | null>(null);
  const [identical, setIdentical] = useState<{ buyerNit: string; files: PurchaseDocFileInput[]; upload: IdenticalUpload } | null>(null);
  const [replaced, setReplaced] = useState<{ buyerNit: string; upload: IdenticalUpload } | null>(null);

  if (!pending) return null;
  const plan: FolderPlan = planFolder(pending.results);
  const companies = data.fs.companies;
  const nameOf = (nit: string) => (companies ? findCompanyByNit(companies, nit)?.razonSocial : undefined);
  const years = new Map<number | null, number>();
  for (const f of plan.main) years.set(f.year, (years.get(f.year) ?? 0) + 1);

  /** Antes de crear nada: si la carpeta es exactamente una carga vigente de la empresa, se pregunta (cancelar o reemplazar). */
  async function save(buyerNit: string, files: PurchaseDocFileInput[], main: boolean) {
    setSaving(true);
    try {
      const upload = await purchasesService.findIdenticalUpload(buyerNit, folderFingerprints(files));
      if (upload) {
        setIdentical({ buyerNit, files, upload });
        return;
      }
      const result = await purchasesService.saveUpload(uploadFor(pending!.folder.folderName, buyerNit, files, plan, main));
      await registerRegimes(files);
      data.select({ buyerNit, year: topYear(files) });
      await data.reloadAll();
      setOutcome({ buyerNit, result });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function replaceIdentical() {
    if (!identical) return;
    setSaving(true);
    try {
      await purchasesService.replaceIdenticalUpload(identical.upload.uploadId, pending!.folder.folderName, replaceFilesOf(identical.files));
      data.select({ buyerNit: identical.buyerNit, year: topYear(identical.files) });
      await data.reloadAll();
      setReplaced({ buyerNit: identical.buyerNit, upload: identical.upload });
      setIdentical(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  /** El régimen que trae la factura se registra una vez por proveedor si aún no tiene historial (con la fecha de su primera factura). */
  async function registerRegimes(files: PurchaseDocFileInput[]) {
    const have = new Set(data.supplierFiscal.map((h) => h.supplierNit));
    const first = new Map<string, PurchaseDocFileInput>();
    for (const f of files) {
      if (have.has(f.issuerNit) || !f.data.issuer.fiscalCodes.length || !f.issueDate) continue;
      const cur = first.get(f.issuerNit);
      if (!cur || f.issueDate < cur.issueDate!) first.set(f.issuerNit, f);
    }
    for (const [nit, f] of first) {
      try {
        await purchasesService.saveSupplierFiscal({ supplierNit: nit, effectiveDate: f.issueDate!, regime: f.data.issuer.fiscalText ?? f.data.issuer.fiscalCodes.join(";"), source: "factura", note: `Leído de la factura ${f.data.number ?? f.fileName}` });
      } catch {
        /* el régimen queda pendiente de captura manual; no frena la importación */
      }
    }
  }

  const close = () => {
    setOutcome(null);
    setIdentical(null);
    setReplaced(null);
    onClose();
  };

  if (replaced) {
    return (
      <Modal open title="Carga reemplazada" description={`${nameOf(replaced.buyerNit) ?? `NIT ${replaced.buyerNit}`} · ${pending.folder.folderName}`} onClose={close} footer={<Button variant="primary" onClick={close}>Listo</Button>}>
        <Alert tone="success">
          Se reemplazó la carga anterior sin crear facturas, duplicados ni evidencias: las {plural(replaced.upload.documentCount, "factura", "facturas")} siguen siendo las mismas, con sus clasificaciones, confirmaciones y decisiones.
        </Alert>
      </Modal>
    );
  }

  if (identical) {
    return (
      <Modal
        open
        title="Esta carpeta ya está importada"
        description={`${nameOf(identical.buyerNit) ?? `NIT ${identical.buyerNit}`} · ${pending.folder.folderName}`}
        onClose={close}
        locked={saving}
        footer={
          <>
            <Button onClick={close} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void replaceIdentical()}>
              Reemplazar carga existente
            </Button>
          </>
        }
      >
        <div className="stack">
          <Alert tone="info">
            El contenido completo de la carpeta ({plural(identical.files.length, "factura", "facturas")}) coincide con la carga vigente «{identical.upload.folderName}», importada el {formatDateForDisplay(identical.upload.importedAt.slice(0, 10))}.
          </Alert>
          <p>
            <strong>Cancelar</strong> no cambia nada. <strong>Reemplazar carga existente</strong> sustituye la carga anterior sin crear facturas, duplicados ni evidencia, y conserva las clasificaciones, confirmaciones y decisiones ya tomadas. La cobertura, los conteos, Estados Financieros y Exógena no cambian.
          </p>
        </div>
      </Modal>
    );
  }

  if (outcome) {
    const docs = outcome.result.documents;
    const evidence = docs.filter((d) => d.status === "evidence");
    return (
      <Modal open title="Carga guardada" description={`${nameOf(outcome.buyerNit) ?? `NIT ${outcome.buyerNit}`} · ${pending.folder.folderName}`} onClose={close} footer={<Button variant="primary" onClick={close}>Listo</Button>}>
        <div className="stack">
          {docs.length > 0 && <Alert tone="success">
            {plural(docs.filter((d) => d.status === "current").length, "factura vigente", "facturas vigentes")} guardadas. Todas las líneas quedan «Por confirmar» hasta que las clasifiques.
          </Alert>}
          {evidence.length > 0 && (
            <Alert tone="warning" title="Duplicadas">
              {plural(evidence.length, "factura ya estaba importada", "facturas ya estaban importadas")} (mismo emisor y número): la versión anterior sigue vigente y la nueva quedó como evidencia.
              {evidence.some((d) => !d.sameContent) && " Alguna difiere en fecha o total: revísala en la pestaña Cargas."}
            </Alert>
          )}
          {outcome.result.unchanged > 0 && (
            <Alert tone="info">{plural(outcome.result.unchanged, "factura ya estaba vigente", "facturas ya estaban vigentes")} con exactamente el mismo contenido: no se guardaron de nuevo ni requieren decisión.</Alert>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      size="lg"
      title="Resumen de la carpeta"
      description={`${pending.folder.folderName} · ${plural(pending.results.length, "archivo", "archivos")}`}
      onClose={close}
      locked={saving}
      footer={
        <>
          <Button onClick={close} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={!plan.dominantNit || plan.main.length === 0} onClick={() => void save(plan.dominantNit!, plan.main, true)}>
            Guardar {plan.main.length} {plan.main.length === 1 ? "factura" : "facturas"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {plan.dominantNit ? (
          <Alert tone={nameOf(plan.dominantNit) ? "info" : "warning"} title={nameOf(plan.dominantNit) ?? `NIT ${plan.dominantNit} sin empresa registrada`}>
            {nameOf(plan.dominantNit)
              ? `La carga es de la empresa con NIT ${plan.dominantNit}.`
              : `El NIT comprador ${plan.dominantNit} (${plan.main[0].buyerName}) no está en Empresas. Las facturas se guardan, pero no pueden enviarse a Estados Financieros ni a Exógena hasta que crees la empresa.`}
          </Alert>
        ) : (
          <Alert tone="danger">Ninguna factura trae el NIT del adquiriente; no se puede ubicar la carga en ninguna empresa.</Alert>
        )}
        {plan.main.length > 0 && (
          <div>
            <strong>Por año de expedición:</strong>{" "}
            {[...years.entries()]
              .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
              .map(([y, n]) => `${y ?? "Sin fecha"}: ${n}`)
              .join(" · ")}
          </div>
        )}
        {plan.others.length > 0 && (
          <Alert tone="warning" title="Facturas de otros NIT compradores (excepciones)">
            <p>Una carga corresponde a un único NIT comprador. Estas facturas no se guardan con la carga principal:</p>
            {plan.others.map((o) => (
              <div key={o.buyerNit} className="row row--between" style={{ gap: 8, margin: "6px 0" }}>
                <span>
                  NIT {o.buyerNit} · {o.buyerName} · {plural(o.files.length, "factura", "facturas")} {nameOf(o.buyerNit) ? "" : "(sin empresa registrada)"}
                </span>
                <Button size="sm" loading={saving} onClick={() => void save(o.buyerNit, o.files, false)}>
                  Guardar como carga separada
                </Button>
              </div>
            ))}
          </Alert>
        )}
        {plan.noBuyer.length > 0 && (
          <Alert tone="danger" title={`${plural(plan.noBuyer.length, "archivo sin", "archivos sin")} NIT del adquiriente`}>
            No se guardan: {plan.noBuyer.map((n) => n.fileName).join(", ")}.
          </Alert>
        )}
        {plan.unreadable.length > 0 && (
          <Alert tone="warning" title={`${plural(plan.unreadable.length, "archivo no se pudo leer", "archivos no se pudieron leer")}`}>
            <ul>
              {plan.unreadable.slice(0, 20).map((u) => (
                <li key={u.fileName}>
                  {u.fileName}: {u.message}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>
    </Modal>
  );
}
