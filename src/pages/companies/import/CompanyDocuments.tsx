import { useState } from "react";
import { Download, Eye, FileText, History, Info, RefreshCw, Trash2, Upload } from "lucide-react";
import { Alert, Badge, Button, Menu, Modal, useToast } from "../../../components/ui";
import { companyService } from "../../../services/companyService";
import type { CompanyDocument, CompanyDocumentKind, CompanyInput, LegalRole } from "../../../types/models";
import { DocumentPreviewModal, type PreviewTarget } from "./DocumentPreviewModal";
import { formatSize, KIND_LABEL, versionHistory, type VersionRow } from "./documentHistory";
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

/** Lo que se precargó desde los documentos y sigue vigente en el formulario, y lo que está por resolver. */
export function importSummary(values: CompanyInput, imports: Pick<CompanyImport, "origins" | "conflicts">): { preloaded: number; conflicts: number } {
  const preloaded = Object.entries(imports.origins).filter(([field, o]) => String(values[field as keyof CompanyInput]) === String(o!.value)).length;
  return { preloaded, conflicts: imports.conflicts.length };
}

/**
 * Dos tarjetas compactas (RUT y Cámara de Comercio): documento vigente, fecha, estado y un menú con Ver, Descargar, Cargar nueva
 * versión e Historial. Las versiones anteriores nunca se pierden; el historial las lista aparte de la vigente.
 */
export function DocumentCards({ saved, imports }: Pick<Props, "saved" | "imports">) {
  const toast = useToast();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [history, setHistory] = useState<CompanyDocumentKind | null>(null);

  async function download(storedFile: string, fileName: string) {
    try {
      const path = await companyService.downloadDocument(storedFile, fileName);
      if (path) toast("Documento guardado.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const view = (kind: CompanyDocumentKind, row: VersionRow) => setPreview({ storedFile: row.storedFile, fileName: row.fileName, title: `${KIND_LABEL[kind]}${row.isCurrent ? " · vigente" : " · versión anterior"}` });

  return (
    <>
      <div className="doc-cards">
        {KINDS.map((kind) => {
          const rows = versionHistory(saved, imports.pending, kind);
          const current = rows[0];
          return (
            <section className="doc-card" key={kind} aria-label={KIND_LABEL[kind]}>
              <header className="doc-card__head">
                <strong>{KIND_LABEL[kind]}</strong>
                {current ? current.pending ? <Badge tone="warning">Nueva · sin guardar</Badge> : <Badge tone="success">Vigente</Badge> : <Badge>Sin documento</Badge>}
                {current && (
                  <Menu
                    label={`Acciones de ${KIND_LABEL[kind]}`}
                    items={[
                      { label: "Ver", icon: <Eye size={14} />, onSelect: () => view(kind, current) },
                      { label: "Descargar", icon: <Download size={14} />, onSelect: () => void download(current.storedFile, current.fileName) },
                      { label: "Cargar nueva versión", icon: <Upload size={14} />, onSelect: () => void imports.importDocument(kind), disabled: imports.busy !== null },
                      { label: `Historial (${rows.length})`, icon: <History size={14} />, onSelect: () => setHistory(kind) },
                    ]}
                  />
                )}
              </header>
              {current ? (
                <div className="doc-card__body">
                  <FileText size={18} aria-hidden />
                  <div className="doc-card__meta">
                    <span className="doc-card__name" title={current.fileName}>
                      {current.fileName}
                    </span>
                    <span className="muted">
                      {formatDate(current.uploadedAt)} · {formatSize(current.sizeBytes)}
                      {rows.length > 1 ? ` · ${rows.length - 1} ${rows.length - 1 === 1 ? "versión anterior" : "versiones anteriores"}` : ""}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="muted doc-card__empty">Se lee en este equipo y precarga los datos; todo sigue siendo editable.</p>
              )}
              {!current && (
                <Button size="sm" variant="primary" icon={<Upload size={14} />} onClick={() => void imports.importDocument(kind)} loading={imports.busy === kind} disabled={imports.busy !== null}>
                  Cargar {KIND_LABEL[kind]}
                </Button>
              )}
              {current && imports.busy === kind && <span className="muted">Leyendo el documento…</span>}
            </section>
          );
        })}
      </div>
      {imports.error && <Alert tone="danger">{imports.error}</Alert>}
      {KINDS.map((kind) =>
        imports.notes[kind]?.length ? (
          <Alert key={kind} tone="warning" title={`${KIND_LABEL[kind]}: lo que no se pudo leer con seguridad`}>
            <ul className="company-docs__notes">
              {imports.notes[kind]!.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            Esos campos quedan editables para que los completes a mano.
          </Alert>
        ) : null,
      )}

      <Modal open={history !== null} size="md" title={history ? `Historial · ${KIND_LABEL[history]}` : ""} description="La versión vigente es la más reciente. Las anteriores se conservan siempre." onClose={() => setHistory(null)} footer={<Button variant="primary" onClick={() => setHistory(null)}>Cerrar</Button>}>
        {history && (
          <ul className="company-docs__list">
            {versionHistory(saved, imports.pending, history).map((row) => (
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
                {row.pending ? <Badge tone="warning">Nueva</Badge> : row.isCurrent ? <Badge tone="success">Vigente</Badge> : <Badge>Anterior</Badge>}
                <div className="row" style={{ gap: 2 }}>
                  <Button size="sm" variant="ghost" iconOnly icon={<Eye size={14} />} aria-label={`Ver ${row.fileName}`} title="Ver" onClick={() => view(history, row)} />
                  <Button size="sm" variant="ghost" iconOnly icon={<Download size={14} />} aria-label={`Descargar ${row.fileName}`} title="Descargar" onClick={() => void download(row.storedFile, row.fileName)} />
                  {!row.pending && <Button size="sm" variant="ghost" iconOnly icon={<RefreshCw size={14} />} aria-label={`Volver a leer ${row.fileName}`} title="Volver a leer los datos de esta versión y compararlos con el formulario" disabled={imports.busy !== null} onClick={() => void imports.rereadVersion(history, row.storedFile)} />}
                  {row.pending && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label={`Quitar ${row.fileName}`} title="Quitar (aún no se ha guardado)" onClick={() => void imports.removePending(row.storedFile)} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <DocumentPreviewModal target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function optionLabel(source: ImportSource | "current") {
  return source === "current" ? "Lo escrito en el formulario" : SOURCE_LABEL[source];
}

const fieldLabel = (field: string) => FIELD_LABEL[field as ImportField] ?? field;

const short = (v: string | number) => {
  const text = displayValue(v);
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
};

/**
 * Una sola línea de estado tras importar («12 datos precargados · 1 diferencia por revisar») con acceso a la revisión.
 * Sin importaciones no se muestra nada.
 */
export function ImportStatusLine({ values, imports, onReview }: { values: CompanyInput; imports: CompanyImport; onReview: () => void }) {
  const { preloaded, conflicts } = importSummary(values, imports);
  const reps = imports.repProposals.filter((p) => (p.conflict || p.ambiguous) && !imports.repResolved[p.role]).length;
  if (!preloaded && !conflicts && !reps) return null;
  const parts = [
    `${preloaded} ${preloaded === 1 ? "dato precargado" : "datos precargados"}`,
    conflicts ? `${conflicts} ${conflicts === 1 ? "diferencia" : "diferencias"} por revisar` : "",
    reps ? `${reps} ${reps === 1 ? "representante por decidir" : "representantes por decidir"}` : "",
  ].filter(Boolean);
  return (
    <div className="import-status" role="status">
      <Info size={15} aria-hidden />
      <span>{parts.join(" · ")}</span>
      <button type="button" className="link-button" onClick={onReview}>
        Ver revisión
      </button>
    </div>
  );
}

/** Discrepancias entre documentos y formulario: alerta accionable (nunca se sobrescribe en silencio). */
export function ConflictAlerts({ imports }: { imports: CompanyImport }) {
  if (!imports.conflicts.length) return null;
  return (
    <div className="stack stack--sm">
      {imports.conflicts.map((conflict) => (
        <Alert key={conflict.field} tone="danger" title={`Discrepancia en «${conflict.label}»: elige cuál conservar`}>
          <div className="import-options">
            {conflict.options.map((option) => (
              <Button key={`${option.source}-${option.value}`} size="sm" onClick={() => imports.resolveConflict(conflict, option)} title={displayValue(option.value)}>
                {optionLabel(option.source)}: <strong>{short(option.value)}</strong>
              </Button>
            ))}
          </div>
          <span className="muted">No se guarda hasta que elijas. Después puedes editar el campo con libertad.</span>
        </Alert>
      ))}
    </div>
  );
}

/** Panel de revisión: de dónde salió cada dato precargado y qué avisos dejó la lectura. */
export function ImportReviewModal({ open, values, imports, onClose }: { open: boolean; values: CompanyInput; imports: CompanyImport; onClose: () => void }) {
  const applied = Object.entries(imports.origins).filter(([field, o]) => String(values[field as keyof CompanyInput]) === String(o!.value));
  return (
    <Modal open={open} size="md" title="Revisión de lo importado" description="Procedencia de cada dato precargado. Todo sigue siendo editable en su pestaña." onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Cerrar</Button>}>
      <div className="stack">
        {imports.conflicts.length > 0 && <Alert tone="danger">Hay {imports.conflicts.length} {imports.conflicts.length === 1 ? "diferencia" : "diferencias"} sin resolver: se muestran en «Resumen y documentos».</Alert>}
        {applied.length === 0 ? (
          <span className="muted">No hay datos precargados vigentes.</span>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Dato</th>
                  <th>Valor</th>
                  <th>Procedencia</th>
                </tr>
              </thead>
              <tbody>
                {applied.map(([field, o]) => (
                  <tr key={field}>
                    <td>{fieldLabel(field)}</td>
                    <td className="selectable">{short(o!.value)}</td>
                    <td>{o!.sources.map((s) => SOURCE_LABEL[s]).join(" y ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

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

/** Representantes propuestos por los documentos: se decide aquí (Estructura societaria), donde están los socios. */
export function RepProposalAlerts({ values, imports }: { values: CompanyInput; imports: CompanyImport }) {
  const { repProposals, repResolved } = imports;
  if (!repProposals.length) return null;
  return (
    <div className="stack stack--sm">
      {repProposals.map((proposal) => (
        <Alert key={proposal.role} tone={(proposal.conflict || proposal.ambiguous) && !repResolved[proposal.role] ? "danger" : "info"} title={`Representante legal ${ROLE_LABEL[proposal.role]} propuesto por los documentos`}>
          <div className="stack stack--sm">
            {mergeSamePerson(proposal.options).map((option, i) => (
              <RepOptionRow key={`${option.source}-${i}`} role={proposal.role} option={option.option} sources={option.sources} values={values} imports={imports} />
            ))}
            {(proposal.conflict || proposal.ambiguous) && <span className="muted">{proposal.ambiguous ? "El documento nombra a más de una persona para este cargo." : "El RUT y la Cámara de Comercio nombran personas distintas."} Elige una antes de guardar.</span>}
            <div>
              <Button size="sm" variant="ghost" onClick={() => imports.keepRep(proposal.role)}>
                Conservar lo seleccionado
              </Button>
            </div>
          </div>
        </Alert>
      ))}
    </div>
  );
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
