import { Download, Eye, FileText, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Field, Input, Modal, Tabs, useToast } from "../../components/ui";
import { IdentityFields, LocationFields, type IdentityValue, type LocationValue } from "../../modules/exogena/components/ThirdPartyForm";
import { allocateCapital } from "../../modules/exogena/domain/capital";
import type { CatalogIndex } from "../../modules/exogena/domain/catalogIndex";
import { isValidPercentage } from "../../modules/exogena/domain/numbers";
import { COLOMBIA, composeIdentityDocument, DOC_NIT, parseIdentityDocument, personName } from "../../modules/exogena/domain/thirdParty";
import { extractPdfText } from "../../modules/bank-analysis/shared/pdf/pdfExtractor";
import { companyService } from "../../services/companyService";
import type { ExoCatalogs } from "../../types/exogena";
import { RUT_STATUS_LABEL, type RutStatus, type Shareholder } from "../../types/models";
import { base64ToBytes, formatSize, versionHistory } from "./import/documentHistory";
import { DocumentPreviewModal, type PreviewTarget } from "./import/DocumentPreviewModal";
import { parseShareholderRut, resolveRutTerritory, type ResolvedTerritory, type ShareholderRutData } from "./import/shareholderRut";
import { allocatedLabel, applyRut, compareRut, matchShareholder, type FieldComparison, type FieldKey } from "./shareholders";
import { upperText } from "./normalize";

/** Un RUT de socio ya cargado en el almacenamiento y leído en el equipo, pendiente de revisar y confirmar. */
export interface PickedRut {
  storedFile: string;
  fileName: string;
  sizeBytes: number;
  rut: ShareholderRutData;
  territory: ResolvedTerritory;
}

/** Elige el PDF del RUT, lo copia al almacenamiento de la app y lo lee localmente. `null` si el usuario cancela. */
export async function pickShareholderRut(catalogs: ExoCatalogs, index: CatalogIndex): Promise<PickedRut | null> {
  const picked = await companyService.pickDocument("rut");
  if (!picked) return null;
  try {
    const text = await extractPdfText(base64ToBytes(picked.dataBase64));
    if (!text.pages.some((p) => p.items.length > 0)) throw new Error("El PDF no tiene texto legible (puede ser una imagen escaneada).");
    const rut = parseShareholderRut(text);
    return { storedFile: picked.storedFile, fileName: picked.fileName, sizeBytes: picked.sizeBytes, rut, territory: resolveRutTerritory(rut, catalogs, index) };
  } catch (e) {
    await companyService.discardDocument(picked.storedFile).catch(() => undefined);
    throw e;
  }
}

export const discardPicked = (picked: PickedRut) => companyService.discardDocument(picked.storedFile).catch(() => undefined);

const toIdentity = (s: Shareholder): IdentityValue => ({
  personType: s.personType ?? "",
  docTypeCode: s.docTypeCode ?? "",
  docNumber: parseIdentityDocument(s.identityDocument).number,
  dv: s.dv ?? "",
  firstSurname: s.firstSurname ?? "",
  secondSurname: s.secondSurname ?? "",
  firstName: s.firstName ?? "",
  otherNames: s.otherNames ?? "",
  legalName: s.personType === "PJ" ? s.name : "",
});

interface Props {
  open: boolean;
  /** Socio que se edita (o el modelo vacío de uno nuevo). */
  shareholder: Shareholder;
  isNew: boolean;
  /** Los demás socios de la empresa: con el capital suscrito dan el capital asignado. */
  others: Shareholder[];
  capitalPesos: number | null;
  catalogs: ExoCatalogs | null;
  index: CatalogIndex | null;
  /** «Importar RUT del socio» solo con la empresa guardada y con su RUT y Cámara de Comercio. */
  importBlockedReason: string | null;
  /** RUT que viene de «Importar RUT de un socio» (ya identificado con este socio): se abre directamente la revisión. */
  initialImport?: PickedRut | null;
  onClose: () => void;
  onSave: (shareholder: Shareholder) => void;
}

/**
 * Ficha de un socio, en tres bloques: Identificación · Ubicación y contacto · Participación y documentos. Importar su RUT
 * propone los datos con una comparación «extraído del RUT» vs «dato actual» (coincidencias en verde, conflictos en amarillo)
 * y no cambia nada hasta confirmar; el PDF queda como una versión más del historial al guardar la empresa.
 */
export function ShareholderModal({ open, shareholder, isNew, others, capitalPesos, catalogs, index, importBlockedReason, initialImport, onClose, onSave }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<Shareholder>(shareholder);
  const [percentage, setPercentage] = useState("");
  const [review, setReview] = useState<PickedRut | null>(null);
  const [keep, setKeep] = useState<Set<FieldKey>>(new Set());
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [tab, setTab] = useState<"ident" | "ubic" | "part">("ident");

  useEffect(() => {
    if (!open) return;
    setDraft(shareholder);
    setPercentage(shareholder.percentage > 0 ? String(shareholder.percentage).replace(".", ",") : "");
    setReview(initialImport ?? null);
    setKeep(new Set());
    setWarning(null);
    setError(null);
    setTab(initialImport ? "part" : "ident");
    // Solo al abrir: después manda lo que escribe el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shareholder]);

  const identity = useMemo(() => toIdentity(draft), [draft]);
  const location: LocationValue = { address: draft.address ?? "", countryCode: draft.countryCode ?? "", deptCode: draft.deptCode ?? "", muniCode: draft.muniCode ?? "" };
  const pct = Number(percentage.replace(",", "."));

  const allocated = useMemo(() => {
    if (capitalPesos === null || !isValidPercentage(pct)) return null;
    const list = [...others.map((o) => ({ percentage: o.percentage })), { percentage: pct }];
    return allocateCapital(capitalPesos, list)[list.length - 1];
  }, [capitalPesos, others, pct]);

  /** Cambios del bloque de identificación → la ficha (documento «CC 123…», nombre completo de la persona natural). */
  function onIdentity(patch: Partial<IdentityValue>) {
    setDraft((d) => {
      const next: Shareholder = { ...d };
      if (patch.personType !== undefined) next.personType = patch.personType || null;
      if (patch.docTypeCode !== undefined) next.docTypeCode = patch.docTypeCode || null;
      if (patch.dv !== undefined) next.dv = patch.dv;
      for (const key of ["firstSurname", "secondSurname", "firstName", "otherNames"] as const) if (patch[key] !== undefined) next[key] = patch[key];
      if (next.personType === "PJ") {
        next.docTypeCode = DOC_NIT;
        next.firstSurname = next.secondSurname = next.firstName = next.otherNames = "";
      }
      if (patch.legalName !== undefined) next.name = patch.legalName;
      else if (next.personType === "PN" && (patch.firstSurname !== undefined || patch.secondSurname !== undefined || patch.firstName !== undefined || patch.otherNames !== undefined)) {
        next.name = personName({ firstSurname: next.firstSurname ?? "", secondSurname: next.secondSurname ?? "", firstName: next.firstName ?? "", otherNames: next.otherNames ?? "" });
      }
      if (patch.docNumber !== undefined || patch.docTypeCode !== undefined || patch.personType !== undefined) {
        const number = patch.docNumber ?? parseIdentityDocument(d.identityDocument).number;
        next.identityDocument = next.docTypeCode ? composeIdentityDocument(next.docTypeCode, number) : number;
      }
      return next;
    });
  }

  function onLocation(patch: Partial<LocationValue>) {
    setDraft((d) => ({ ...d, ...patch, ...(patch.countryCode !== undefined && patch.countryCode !== COLOMBIA ? { deptCode: "", muniCode: "" } : {}) }));
  }

  async function importRut() {
    if (!catalogs || !index) return;
    setBusy(true);
    setWarning(null);
    setError(null);
    try {
      const picked = await pickShareholderRut(catalogs, index);
      if (!picked) return;
      // Debe ser el RUT de ESTE socio: si no coincide por documento ni por nombre, no se importa nada en silencio.
      const probe = { ...draft, name: draft.name, identityDocument: draft.identityDocument };
      if (!matchShareholder([probe], picked.rut)) {
        await discardPicked(picked);
        setWarning(`El RUT es de ${picked.rut.businessName ?? (personName({ firstSurname: picked.rut.firstSurname ?? "", secondSurname: picked.rut.secondSurname ?? "", firstName: picked.rut.firstName ?? "", otherNames: picked.rut.otherNames ?? "" }) || "otra persona")}${picked.rut.docNumber ? ` (documento ${picked.rut.docNumber})` : ""}, que no coincide con este socio por documento ni por nombre. No se importó nada: verifica el archivo o el documento del socio.`);
        return;
      }
      setReview(picked);
      setKeep(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const comparison = useMemo<FieldComparison[]>(() => (review ? compareRut(draft, review.rut, review.territory, index) : []), [review, draft, index]);

  function confirmImport() {
    if (!review) return;
    const { shareholder: next, status } = applyRut(draft, review.rut, review.territory, comparison, keep);
    setDraft({ ...next, rutStatus: status, newDocuments: [...(draft.newDocuments ?? []), { kind: "rut", fileName: review.fileName, storedFile: review.storedFile }] });
    setReview(null);
    toast(status === "validado" ? "RUT importado y validado. Se guarda al guardar la empresa." : "RUT importado con diferencias por revisar. Se guarda al guardar la empresa.");
  }

  async function cancelImport() {
    if (review) await discardPicked(review);
    setReview(null);
  }

  async function close() {
    if (review) await discardPicked(review);
    onClose();
  }

  function save() {
    if (!draft.name.trim() && !(draft.personType === "PN" && personName(toIdentity(draft)))) return setError("Escribe el nombre o la razón social del socio.");
    if (!parseIdentityDocument(draft.identityDocument).number.trim()) return setError("Escribe el número de documento del socio.");
    if (!isValidPercentage(pct)) return setError("La participación debe ser mayor que 0 y hasta 100, con a lo sumo dos decimales.");
    setError(null);
    onSave({ ...draft, name: upperText(draft.name || personName(toIdentity(draft))), percentage: pct });
  }

  const rutRows = versionHistory(draft.documents ?? [], (draft.newDocuments ?? []).map((d) => ({ kind: "rut" as const, fileName: d.fileName, storedFile: d.storedFile, sizeBytes: 0 })), "rut");
  const status: RutStatus = draft.rutStatus ?? "pendiente";
  const statusTone = status === "validado" ? "success" : status === "revisar" ? "warning" : undefined;

  async function download(storedFile: string, fileName: string) {
    try {
      const path = await companyService.downloadDocument(storedFile, fileName);
      if (path) toast("Documento guardado.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={isNew ? "Nuevo socio" : "Ficha del socio"}
      description="Identificación, ubicación y participación. Alimenta el formato 1010 de Información Exógena."
      onClose={() => void close()}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !!review}>
            {isNew ? "Agregar socio" : "Aceptar"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        {warning && (
          <Alert tone="warning" title="El RUT no corresponde a este socio">
            {warning}
          </Alert>
        )}
        <Tabs label="Secciones del socio" value={tab} onChange={setTab} tabs={[{ id: "ident", label: "Identificación" }, { id: "ubic", label: "Ubicación y contacto" }, { id: "part", label: "Participación y documentos", badge: status === "revisar" ? "Revisar" : undefined }]} />
        {tab === "ident" && (
        <div className="stack" role="tabpanel" id="panel-ident" aria-labelledby="tab-ident">
          <IdentityFields value={identity} onChange={onIdentity} catalogs={catalogs} numberLabel="Número de documento" numberHint="Sin puntos ni espacios; el NIT sin DV." />
          {identity.personType === "PJ" && (
            <div className="form-grid form-grid--compact">
              <Field label="Razón social" required className="span-2">
                {(id) => <Input id={id} value={identity.legalName} onChange={(e) => onIdentity({ legalName: e.target.value })} />}
              </Field>
            </div>
          )}
          {identity.personType !== "PJ" && identity.personType !== "PN" && (
            <div className="form-grid form-grid--compact">
              <Field label="Nombre completo" required hint="Elige antes el tipo de persona para separar apellidos y nombres." className="span-2">
                {(id) => <Input id={id} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />}
              </Field>
            </div>
          )}
        </div>
        )}

        {tab === "ubic" && (
        <div className="stack" role="tabpanel" id="panel-ubic" aria-labelledby="tab-ubic">
          <LocationFields value={location} onChange={onLocation} catalogs={catalogs} />
          <div className="form-grid form-grid--compact">
            <Field label="Teléfono" hint="Sin espacios ni separadores.">
              {(id) => <Input id={id} value={draft.phone ?? ""} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />}
            </Field>
            <Field label="Correo electrónico">{(id) => <Input id={id} type="email" value={draft.email ?? ""} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />}</Field>
          </div>
        </div>
        )}

        {tab === "part" && (
        <div className="stack" role="tabpanel" id="panel-part" aria-labelledby="tab-part">
          <div className="form-grid form-grid--compact">
            <Field label="Participación (%)" required hint="Hasta dos decimales. Un solo socio inicia en 100 %; varios deben sumar exactamente 100 %.">
              {(id) => <Input id={id} value={percentage} inputMode="decimal" className="input--right" onChange={(e) => setPercentage(e.target.value)} />}
            </Field>
            <Field label="Capital asignado" hint="Capital suscrito × participación (el reparto se ajusta para que la suma de los socios dé el capital).">
              {(id) => <Input id={id} value={allocatedLabel(allocated)} readOnly disabled />}
            </Field>
          </div>
          <div className="row row--between" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span className="row" style={{ gap: 8, alignItems: "center" }}>
              <strong>RUT del socio</strong>
              <Badge tone={statusTone}>{RUT_STATUS_LABEL[status]}</Badge>
            </span>
            <Button icon={<Upload size={14} />} loading={busy} disabled={!catalogs || !!review || !!importBlockedReason} onClick={() => void importRut()}>
              Importar RUT del socio
            </Button>
          </div>
          {importBlockedReason && <Alert tone="info">{importBlockedReason}</Alert>}
          {rutRows.length === 0 ? (
            <span className="muted">Sin RUT importado. Se lee en este equipo y propone los datos; todo sigue siendo editable.</span>
          ) : (
            <ul className="company-docs__list">
              {rutRows.map((row) => (
                <li key={row.key} className={row.isCurrent ? "is-current" : undefined}>
                  <FileText size={16} aria-hidden />
                  <div className="company-docs__meta">
                    <span className="company-docs__name" title={row.fileName}>
                      {row.fileName}
                    </span>
                    <span className="muted">
                      {row.uploadedAt ? new Date(row.uploadedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "Sin guardar"}
                      {row.sizeBytes ? ` · ${formatSize(row.sizeBytes)}` : ""}
                    </span>
                  </div>
                  {row.isCurrent && <Badge tone="success">Vigente</Badge>}
                  {row.pending && <Badge tone="warning">Nueva</Badge>}
                  <div className="row" style={{ gap: 2 }}>
                    <Button size="sm" variant="ghost" iconOnly icon={<Eye size={14} />} aria-label={`Ver ${row.fileName}`} onClick={() => setPreview({ storedFile: row.storedFile, fileName: row.fileName, title: `RUT de ${draft.name || "socio"}` })} />
                    <Button size="sm" variant="ghost" iconOnly icon={<Download size={14} />} aria-label={`Descargar ${row.fileName}`} onClick={() => void download(row.storedFile, row.fileName)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </div>
      <RutReviewModal review={review} comparison={comparison} keep={keep} setKeep={setKeep} onConfirm={confirmImport} onCancel={() => void cancelImport()} />
      <DocumentPreviewModal target={preview} onClose={() => setPreview(null)} />
    </Modal>
  );
}


/**
 * Revisión del RUT de un socio antes de aplicarlo: primero las diferencias (conservar el dato actual o aplicar el extraído, una
 * por una), las coincidencias quedan plegadas. Nada cambia hasta confirmar.
 */
function RutReviewModal({ review, comparison, keep, setKeep, onConfirm, onCancel }: { review: PickedRut | null; comparison: FieldComparison[]; keep: Set<FieldKey>; setKeep: (fn: (k: Set<FieldKey>) => Set<FieldKey>) => void; onConfirm: () => void; onCancel: () => void }) {
  const diffs = comparison.filter((c) => c.status === "conflict" || c.status === "new");
  const same = comparison.filter((c) => c.status === "match" || c.status === "absent");
  const toggle = (key: FieldKey, keepCurrent: boolean) =>
    setKeep((k) => {
      const next = new Set(k);
      if (keepCurrent) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <Modal open={!!review} size="lg" title="Revisar el RUT del socio" description={review ? review.fileName : undefined} onClose={onCancel} footer={<><Button variant="ghost" onClick={onCancel}>Cancelar importación</Button><Button variant="primary" onClick={onConfirm}>Confirmar y aplicar</Button></>}>
      {review && (
        <div className="stack">
          <span className="muted">Nada cambia hasta que confirmes. En cada diferencia elige si conservas el dato actual o aplicas el extraído del RUT.</span>
          {review.rut.notes.length > 0 && <Alert tone="warning">{review.rut.notes.join(" ")}</Alert>}
          {review.territory.warnings.length > 0 && <Alert tone="warning">{review.territory.warnings.join(" ")}</Alert>}
          {diffs.length === 0 ? (
            <Alert tone="success">El RUT coincide con los datos actuales del socio; no hay diferencias.</Alert>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Campo</th>
                    <th>Dato actual</th>
                    <th>Extraído del RUT</th>
                    <th>Qué hacer</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((c) => (
                    <tr key={c.key} className="row--warning">
                      <td>{c.label}</td>
                      <td className="selectable">{c.current || <span className="muted">—</span>}</td>
                      <td className="selectable">{c.extracted || <span className="muted">—</span>}</td>
                      <td>
                        {c.status === "new" ? (
                          <Badge tone="gold">Dato nuevo: se aplica</Badge>
                        ) : (
                          <div className="stack stack--sm">
                            <label className="checkbox">
                              <input type="radio" name={`rut-${c.key}`} checked={keep.has(c.key)} onChange={() => toggle(c.key, true)} /> Conservar el actual
                            </label>
                            <label className="checkbox">
                              <input type="radio" name={`rut-${c.key}`} checked={!keep.has(c.key)} onChange={() => toggle(c.key, false)} /> Aplicar el del RUT
                            </label>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {same.length > 0 && (
            <details>
              <summary>Ver campos que coinciden ({same.length})</summary>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {same.map((c) => (
                      <tr key={c.key} className={c.status === "match" ? "row--ok" : undefined}>
                        <td>{c.label}</td>
                        <td className="selectable">{c.status === "match" ? c.current : <span className="muted">El RUT no lo trae</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
