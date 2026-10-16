import { useState } from "react";
import { Eye, FileText, RefreshCw, Trash2, Upload, Download } from "lucide-react";
import { Alert, Badge, Button, useToast } from "../../../components/ui";
import { companyService } from "../../../services/companyService";
import type { CompanyDocument, CompanyDocumentKind, CompanyInput, LegalRole } from "../../../types/models";
import { DocumentPreviewModal, type PreviewTarget } from "./DocumentPreviewModal";
import { formatSize, KIND_LABEL, versionHistory } from "./documentHistory";
import { displayValue, FIELD_LABEL, SOURCE_LABEL, type ImportField, type ImportSource } from "./importPlan";
import { camaraRepWarnings, findShareholder, type RepOption } from "./legalReps";
import { samePerson } from "../normalize";
import type { CompanyImport } from "./useCompanyImport";

const KINDS: CompanyDocumentKind[] = ["rut", "camara"];
const ROLE_LABEL: Record<LegalRole, string> = { principal: "principal", alternate: "suplente" };
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "Sin guardar");

interface Props {
  saved: CompanyDocument[];
  values: CompanyInput;
  imports: CompanyImport;
}

/** Carga del RUT y de la Cámara de Comercio, historial de versiones y revisión de lo importado. */
export function CompanyDocumentsSection({ saved, values, imports }: Props) {
  const toast = useToast();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  async function download(storedFile: string, fileName: string) {
    try {
      const path = await companyService.downloadDocument(storedFile, fileName);
      if (path) toast("Documento guardado.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="stack">
      <div className="company-docs">
        {KINDS.map((kind) => {
          const rows = versionHistory(saved, imports.pending, kind);
          return (
            <div className="company-docs__box" key={kind}>
              <div className="row row--between">
                <strong>{KIND_LABEL[kind]}</strong>
                <Button size="sm" icon={<Upload size={14} />} onClick={() => void imports.importDocument(kind)} loading={imports.busy === kind} disabled={imports.busy !== null}>
                  {rows.length ? "Cargar nueva versión" : `Cargar ${KIND_LABEL[kind]}`}
                </Button>
              </div>
              {rows.length === 0 ? (
                <span className="muted">Sin documento. Se lee en este equipo y precarga los datos; todo sigue siendo editable.</span>
              ) : (
                <ul className="company-docs__list">
                  {rows.map((row) => (
                    <li key={row.key} className={row.isCurrent ? "is-current" : undefined}>
                      <FileText size={16} aria-hidden />
                      <div className="company-docs__meta">
                        <span className="company-docs__name" title={row.fileName}>
                          {row.fileName}
                        </span>
                        <span className="muted">
                          {formatDate(row.uploadedAt)} · {formatSize(row.sizeBytes)}
                        </span>
                      </div>
                      {row.isCurrent && <Badge tone="success">Vigente</Badge>}
                      {row.pending && <Badge tone="warning">Nueva</Badge>}
                      <div className="row" style={{ gap: 2 }}>
                        <Button size="sm" variant="ghost" iconOnly icon={<Eye size={14} />} aria-label={`Ver ${row.fileName}`} title="Ver" onClick={() => setPreview({ storedFile: row.storedFile, fileName: row.fileName, title: `${KIND_LABEL[kind]}${row.isCurrent ? " · vigente" : ""}` })} />
                        <Button size="sm" variant="ghost" iconOnly icon={<Download size={14} />} aria-label={`Descargar ${row.fileName}`} title="Descargar" onClick={() => void download(row.storedFile, row.fileName)} />
                        {!row.pending && (
                          <Button size="sm" variant="ghost" iconOnly icon={<RefreshCw size={14} />} aria-label={`Volver a leer ${row.fileName}`} title="Volver a leer los datos de esta versión" disabled={imports.busy !== null} onClick={() => void imports.rereadVersion(kind, row.storedFile)} />
                        )}
                        {row.pending && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label={`Quitar ${row.fileName}`} title="Quitar (aún no se ha guardado)" onClick={() => void imports.removePending(row.storedFile)} />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {imports.notes[kind]?.length ? (
                <Alert tone="warning" title={`${KIND_LABEL[kind]}: lo que no se pudo leer con seguridad`}>
                  <ul className="company-docs__notes">
                    {imports.notes[kind]!.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                  Esos campos quedan editables para que los completes a mano.
                </Alert>
              ) : null}
            </div>
          );
        })}
      </div>
      {imports.error && <Alert tone="danger">{imports.error}</Alert>}
      <ImportReview values={values} imports={imports} />
      <DocumentPreviewModal target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function optionLabel(source: ImportSource | "current") {
  return source === "current" ? "Lo escrito en el formulario" : SOURCE_LABEL[source];
}

/** Discrepancias que hay que resolver y representantes propuestos por los documentos. */
function ImportReview({ values, imports }: { values: CompanyInput; imports: CompanyImport }) {
  const { conflicts, repProposals, repResolved } = imports;
  const applied = Object.entries(imports.origins).filter(([field, o]) => String(values[field as keyof CompanyInput]) === String(o!.value));
  if (!conflicts.length && !repProposals.length && !applied.length) return null;
  return (
    <div className="stack stack--sm">
      {conflicts.map((conflict) => (
        <Alert key={conflict.field} tone="danger" title={`Discrepancia en «${conflict.label}»: elige cuál conservar`}>
          <div className="import-options">
            {conflict.options.map((option) => (
              <Button key={`${option.source}-${option.value}`} size="sm" onClick={() => imports.resolveConflict(conflict, option)}>
                {optionLabel(option.source)}: <strong>{displayValue(option.value)}</strong>
              </Button>
            ))}
          </div>
          <span className="muted">No se guarda hasta que elijas. Después puedes editar el campo con libertad.</span>
        </Alert>
      ))}

      {repProposals.map((proposal) => (
        <Alert key={proposal.role} tone={(proposal.conflict || proposal.ambiguous) && !repResolved[proposal.role] ? "danger" : "info"} title={`Representante legal ${ROLE_LABEL[proposal.role]} propuesto por los documentos`}>
          <div className="stack stack--sm">
            {mergeSamePerson(proposal.options).map((option, i) => (
              <RepOptionRow key={`${option.source}-${i}`} role={proposal.role} option={option.option} sources={option.sources} values={values} imports={imports} />
            ))}
            {(proposal.conflict || proposal.ambiguous) && (
              <span className="muted">{proposal.ambiguous ? "El documento nombra a más de una persona para este cargo." : "El RUT y la Cámara de Comercio nombran personas distintas."} Elige una antes de guardar.</span>
            )}
            <div>
              <Button size="sm" variant="ghost" onClick={() => imports.keepRep(proposal.role)}>
                Conservar lo seleccionado en «Representación legal»
              </Button>
            </div>
          </div>
        </Alert>
      ))}

      {applied.length > 0 && (
        <div className="import-origins" aria-label="Datos precargados desde los documentos">
          <span className="muted">Precargado desde los documentos:</span>
          {applied.map(([field, o]) => (
            <Badge key={field}>
              {fieldLabel(field)} · {o!.sources.map((s) => SOURCE_LABEL[s]).join(" y ")}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const fieldLabel = (field: string) => FIELD_LABEL[field as ImportField] ?? field;

/** El RUT y la Cámara suelen nombrar a la misma persona: se muestra una vez con ambos orígenes. */
function mergeSamePerson(options: RepOption[]): { source: ImportSource; option: RepOption; sources: ImportSource[] }[] {
  const out: { source: ImportSource; option: RepOption; sources: ImportSource[] }[] = [];
  for (const option of options) {
    const same = out.find((o) => samePerson(o.option.person, option.person));
    if (same) same.sources.push(option.source);
    else out.push({ source: option.source, option, sources: [option.source] });
  }
  return out;
}

function RepOptionRow({ role, option, sources, values, imports }: { role: LegalRole; option: RepOption; sources: ImportSource[]; values: CompanyInput; imports: CompanyImport }) {
  const isShareholder = findShareholder(values.shareholders, option.person) >= 0;
  return (
    <div className="import-rep">
      <div className="import-rep__who">
        <strong>{option.person.name}</strong>
        <span className="muted">
          {option.person.document || "Sin documento"} · {sources.map((s) => SOURCE_LABEL[s]).join(" y ")} ({option.cargo})
        </span>
        <Badge tone={isShareholder ? "success" : "warning"}>{isShareholder ? "Es socio" : "No está entre los socios"}</Badge>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {isShareholder ? (
          <Button size="sm" onClick={() => imports.applyRep(role, option, "shareholder")}>
            Usar como {ROLE_LABEL[role]}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => imports.applyRep(role, option, "add-shareholder")}>
              Agregar como socio y usar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => imports.applyRep(role, option, "exception")}>
              No es socio: confirmar excepción
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Advertencia que no se oculta: los representantes de la Cámara no coinciden con los seleccionados. */
export function CamaraRepWarnings({ values, imports }: { values: CompanyInput; imports: CompanyImport }) {
  // Si los documentos ya proponen a alguien para ese cargo, la propuesta de arriba es la acción: no se repite el aviso.
  const proposed = new Set(imports.repProposals.map((p) => p.role));
  const warnings = camaraRepWarnings(values, imports.camara).filter((w) => !proposed.has(w.role));
  if (!warnings.length) return null;
  return (
    <>
      {warnings.map((w) => {
        const option: RepOption = { source: "camara", cargo: w.role === "principal" ? "Representante legal" : "Suplente", person: w.expected };
        const isShareholder = findShareholder(values.shareholders, w.expected) >= 0;
        return (
          <Alert key={w.role} tone="warning" title={`La Cámara de Comercio indica otro representante ${ROLE_LABEL[w.role]}`}>
            <div className="stack stack--sm">
              <span>
                Cámara: <strong>{w.expected.name}</strong> ({w.expected.document || "sin documento"}).{" "}
                {w.selected ? (
                  <>
                    Seleccionado: <strong>{w.selected.name}</strong> ({w.selected.document || "sin documento"}).
                  </>
                ) : (
                  "No hay uno seleccionado."
                )}
              </span>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {isShareholder ? (
                  <Button size="sm" onClick={() => imports.applyRep(w.role, option, "shareholder")}>
                    Usar el de la Cámara
                  </Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => imports.applyRep(w.role, option, "add-shareholder")}>
                      Agregar como socio y usar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => imports.applyRep(w.role, option, "exception")}>
                      Usar como excepción (no es socio)
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Alert>
        );
      })}
    </>
  );
}
