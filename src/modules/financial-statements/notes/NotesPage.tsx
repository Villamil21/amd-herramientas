import { AlertTriangle, Download, Eye, FileText, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, DateInput, Field, Modal, PageHeader, Select, Textarea, useToast } from "../../../components/ui";
import { LogoThumb } from "../../../components/LogoThumb";
import { getLogoDataUrl } from "../../../services/companyService";
import { fileService } from "../../../services/fileService";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import { PRESENTATION_LABEL, type Presentation } from "../../../types/fs";
import { PdfPages } from "../generator/components";
import { loadImage } from "../generator/snapshot";
import { CompanySelect } from "../shared/components/CompanySelect";
import { formatStatementPesos } from "../shared/money";
import { companySnapshot, entityText, initialNotesData, pruneEdits, titleName, type CompanySnapshot, type NoteItem, type NotesData } from "./model";
import { notesFileName, renderNotesPdf } from "./pdf";
import { POLICY_BLOCKS } from "./policies";
import { useNotesStatements } from "./useNotesStatements";

const currentYear = new Date().getFullYear();
type Selected = "general" | string;

/**
 * Notas Financieras: elige empresa y el mismo período de los estados; los datos de identidad, representante, ente económico y
 * objeto social vienen de Empresas (editables aquí sin cambiar Empresas). Las notas generales y las políticas son fijas; las notas
 * específicas salen de las partidas que aparecen en los estados y se numeran como su columna NOTA.
 */
export default function NotesPage() {
  const toast = useToast();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [start, setStart] = useState(`${currentYear}-01-01`);
  const [end, setEnd] = useState(`${currentYear}-12-31`);
  const [presentation, setPresentation] = useState<Presentation>("bank");
  const { companies, company, model, rangeOk, loading } = useNotesStatements(companyId, start, end, presentation);

  const [data, setData] = useState<NotesData | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [snapshot, setSnapshot] = useState<CompanySnapshot | null>(null);
  const [selected, setSelected] = useState<Selected>("general");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Uint8Array | null | "loading">(null);
  const [staleCompany, setStaleCompany] = useState(false);

  // Carga lo guardado para empresa y período, o parte de los datos de Empresas.
  useEffect(() => {
    setData(null);
    setSnapshot(null);
    setSaved("");
    setStaleCompany(false);
    if (!company || !rangeOk) return;
    let alive = true;
    (async () => {
      try {
        const stored = await fsService.notes(company.id, start, end);
        if (!alive) return;
        if (stored) {
          const d = stored.data as NotesData;
          setData(d);
          setSaved(JSON.stringify(d));
          const snap = stored.companySnapshot as CompanySnapshot;
          setSnapshot(snap);
          const now = companySnapshot(company);
          setStaleCompany(entityText(now) !== entityText(snap) || now.corporatePurpose !== snap.corporatePurpose || now.legalRepName !== snap.legalRepName);
        } else {
          const snap = companySnapshot(company);
          setSnapshot(snap);
          setData(initialNotesData(snap, { start, end }, presentation));
        }
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    })();
    return () => {
      alive = false;
    };
    // El borrador depende de la empresa y el período; los cambios de presentación no lo reinician.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id, start, end, rangeOk]);

  const items = model?.items ?? [];
  const current = useMemo(() => (data ? pruneEdits(data, items) : null), [data, items]);
  const dirty = !!current && JSON.stringify(current) !== saved;
  const item = items.find((i) => i.key === selected) ?? null;

  const editParagraphs = (key: string, paragraphs: string[]) => setData((d) => (d ? { ...d, notes: { ...d.notes, [key]: { paragraphs } } } : d));
  const confirmField = (field: "entityNarrative" | "corporatePurpose") => setData((d) => (d ? { ...d, review: d.review.filter((f) => f !== field) } : d));
  const setText = (field: "entityNarrative" | "corporatePurpose", value: string) => setData((d) => (d ? { ...d, [field]: value, review: d.review.filter((f) => f !== field) } : d));

  async function persist(generated: boolean) {
    if (!company || !current) return;
    const snap = companySnapshot(company);
    const stored = await fsService.saveNotes({ companyId: company.id, periodStart: start, periodEnd: end, data: { ...current, presentation }, companySnapshot: snap, generated });
    setData(stored.data as NotesData);
    setSaved(JSON.stringify(stored.data));
    setSnapshot(snap);
    setStaleCompany(false);
  }

  async function save() {
    setBusy("save");
    try {
      await persist(false);
      toast("Notas guardadas.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function pdfBytes(): Promise<Uint8Array> {
    if (!company || !current) throw new Error("Faltan datos para generar las notas.");
    const logo = await getLogoDataUrl(company.logoFile).then(loadImage);
    const { bytes } = await renderNotesPdf({ companyName: company.razonSocial, nit: company.nit, dv: company.dv, logo, startDate: start, endDate: end, entityNarrative: current.entityNarrative, corporatePurpose: current.corporatePurpose, items, edits: current.notes });
    return bytes;
  }

  async function openPreview() {
    setPreview("loading");
    try {
      setPreview(await pdfBytes());
    } catch (e) {
      setPreview(null);
      toast(errorMessage(e), "error");
    }
  }

  async function download() {
    if (!company) return;
    setBusy("pdf");
    try {
      const bytes = await pdfBytes();
      const path = await fileService.savePdf(bytes, notesFileName(company.razonSocial, end));
      if (!path) return;
      await persist(true);
      toast("PDF de notas generado y guardado.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  function refreshFromCompany() {
    if (!company || !data) return;
    const snap = companySnapshot(company);
    const fresh = initialNotesData(snap, { start, end }, presentation);
    setSnapshot(snap);
    setData({ ...data, entityNarrative: fresh.entityNarrative, corporatePurpose: fresh.corporatePurpose, review: fresh.review });
    setStaleCompany(false);
    toast("Ente económico y objeto social tomados de Empresas.");
  }

  const ready = !!company && !!current && !!model;
  const rep = company?.legalRepName ? titleName(company.legalRepName) : "";

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros"
        title="Notas Financieras"
        description="Notas a los estados financieros del mismo período: datos de Empresas, políticas fijas y notas específicas numeradas como la columna NOTA."
        actions={
          <>
            <Button icon={<Save size={15} />} onClick={() => void save()} loading={busy === "save"} disabled={!ready || !dirty}>
              Guardar
            </Button>
            <Button icon={<Eye size={15} />} onClick={() => void openPreview()} disabled={!ready}>
              Vista previa
            </Button>
            <Button variant="primary" icon={<Download size={15} />} onClick={() => void download()} loading={busy === "pdf"} disabled={!ready}>
              Descargar PDF
            </Button>
          </>
        }
      />
      <Card title="Empresa y período">
        <div className="form-grid form-grid--compact" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <CompanySelect companies={companies} value={companyId} onChange={setCompanyId} />
          <Field label="Fecha inicial" required>{(id) => <DateInput id={id} value={start} onChange={setStart} />}</Field>
          <Field label="Fecha final" required error={start && end && start > end ? "Debe ser posterior a la inicial." : null}>{(id) => <DateInput id={id} value={end} onChange={setEnd} />}</Field>
          <Field label="Presentación" hint="La misma de los estados (interna; no se imprime).">
            {(id) => (
              <Select id={id} value={presentation} onChange={(e) => setPresentation(e.target.value as Presentation)}>
                {(Object.keys(PRESENTATION_LABEL) as Presentation[]).map((p) => (
                  <option key={p} value={p}>
                    {PRESENTATION_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      {!company ? (
        <Alert tone="info">Elige la empresa y el período de los estados para preparar sus notas.</Alert>
      ) : !rangeOk ? (
        <Alert tone="info">Elige un rango de fechas válido.</Alert>
      ) : loading || !current ? (
        <Card>
          <span className="muted">Calculando las partidas de los estados…</span>
        </Card>
      ) : (
        <>
          <Card>
            <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <LogoThumb logoFile={company.logoFile} size="lg" />
              <div className="stack stack--sm" style={{ flex: 1, minWidth: 220 }}>
                <strong>{company.razonSocial}</strong>
                <span className="muted selectable">
                  NIT {company.nit}
                  {company.dv ? `-${company.dv}` : ""} · {items.length} {items.length === 1 ? "nota específica" : "notas específicas"}
                </span>
                <span className="muted">{rep ? `Representante legal: ${rep}` : "Sin representante legal principal en Empresas."}</span>
              </div>
              <div className="stack stack--sm" style={{ alignItems: "flex-end" }}>
                <Badge tone={dirty ? "warning" : "success"}>{dirty ? "Cambios sin guardar" : saved ? "Guardado" : "Sin guardar"}</Badge>
                {snapshot && <span className="muted">Datos de Empresas tomados el {new Date(snapshot.takenAt).toLocaleDateString("es-CO")}</span>}
              </div>
            </div>
          </Card>
          {staleCompany && (
            <Alert tone="warning" title="Empresas cambió desde que se guardaron estas notas">
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>El ente económico, el objeto social o el representante legal son distintos. Lo escrito aquí no se modifica hasta que lo pidas.</span>
                <Button size="sm" icon={<RefreshCcw size={13} />} onClick={refreshFromCompany}>
                  Tomar de Empresas
                </Button>
              </div>
            </Alert>
          )}
          <div className="notes-layout">
            <nav className="notes-list" aria-label="Notas">
              <button type="button" className={`notes-list__item${selected === "general" ? " is-active" : ""}`} onClick={() => setSelected("general")}>
                <span>Notas de carácter general</span>
                {current.review.length > 0 && <Badge tone="warning">Revisar</Badge>}
              </button>
              <div className="notes-list__group">Notas de carácter específico</div>
              {items.length === 0 && <span className="muted">Los estados no tienen partidas.</span>}
              {items.map((i) => (
                <button key={i.key} type="button" className={`notes-list__item${selected === i.key ? " is-active" : ""}`} onClick={() => setSelected(i.key)}>
                  <span>
                    {i.number}. {i.title}
                  </span>
                  <span className="muted">{formatStatementPesos(i.pesos)}</span>
                </button>
              ))}
            </nav>
            <section className="notes-editor" aria-live="polite">
              {selected === "general" || !item ? (
                <GeneralEditor data={current} startDate={start} endDate={end} setText={setText} confirm={confirmField} />
              ) : (
                <NoteEditor item={item} data={current} year={end.slice(0, 4)} onChange={(p) => editParagraphs(item.key, p)} />
              )}
            </section>
          </div>
        </>
      )}

      <Modal open={preview !== null} size="xl" title="Vista previa · Notas a los Estados Financieros" onClose={() => setPreview(null)} footer={<><Button variant="ghost" onClick={() => setPreview(null)}>Cerrar</Button><Button variant="primary" icon={<Download size={14} />} onClick={() => void download()} loading={busy === "pdf"}>Descargar PDF</Button></>}>
        <PdfPages bytes={preview === "loading" ? null : preview} pageLabel={(n) => `Página ${n} de las notas`} />
      </Modal>
    </>
  );
}

function GeneralEditor({ data, startDate, endDate, setText, confirm }: { data: NotesData; startDate: string; endDate: string; setText: (f: "entityNarrative" | "corporatePurpose", v: string) => void; confirm: (f: "entityNarrative" | "corporatePurpose") => void }) {
  const flagged = (f: "entityNarrative" | "corporatePurpose") => data.review.includes(f);
  return (
    <div className="stack">
      <h3 className="notes-editor__title">Notas de carácter general</h3>
      <Field label="Ente económico" labelAdornment={flagged("entityNarrative") ? <span className="review-mark"><Badge tone="warning">Revisar</Badge></span> : undefined} hint="Viene de Empresas (Fiscal y registral). Se puede ajustar aquí para este período.">
        {(id) => <Textarea id={id} rows={4} value={data.entityNarrative} onChange={(e) => setText("entityNarrative", e.target.value)} />}
      </Field>
      {flagged("entityNarrative") && data.entityNarrative && <div><Button size="sm" variant="ghost" onClick={() => confirm("entityNarrative")}>Confirmar texto</Button></div>}
      <Field label="Objeto social" labelAdornment={flagged("corporatePurpose") ? <span className="review-mark"><Badge tone="warning">Revisar</Badge></span> : undefined}>
        {(id) => <Textarea id={id} rows={6} value={data.corporatePurpose} onChange={(e) => setText("corporatePurpose", e.target.value)} />}
      </Field>
      {flagged("corporatePurpose") && data.corporatePurpose && <div><Button size="sm" variant="ghost" onClick={() => confirm("corporatePurpose")}>Confirmar objeto social</Button></div>}
      <Alert tone="info" title="Políticas contables (texto fijo)">
        <details>
          <summary>Ver el resumen de políticas ({POLICY_BLOCKS.filter((b) => b.type === "heading").length} secciones)</summary>
          <div className="notes-policies">
            {POLICY_BLOCKS.map((b, i) =>
              b.type === "heading" ? <strong key={i}>{b.text}</strong> : b.type === "paragraph" ? <p key={i}>{b.text}</p> : b.type === "bullet" ? <p key={i}>• {b.text}</p> : b.type === "period" ? <p key={i}>Período cubierto: {startDate} a {endDate} (se redacta con las fechas elegidas).</p> : <p key={i} className="muted">Tabla de vidas útiles ({b.rows.length} filas)</p>,
            )}
          </div>
        </details>
      </Alert>
    </div>
  );
}

function NoteEditor({ item, data, year, onChange }: { item: NoteItem; data: NotesData; year: string; onChange: (paragraphs: string[]) => void }) {
  const paragraphs = data.notes[item.key]?.paragraphs ?? [];
  return (
    <div className="stack">
      <h3 className="notes-editor__title">
        {item.number}. {item.title}
      </h3>
      <div className="stat-row">
        <div className="stat">Estado<strong>{item.section === "esf" ? "Situación Financiera" : "Resultados"}</strong></div>
        <div className="stat">Partida<strong>{item.title}</strong></div>
        <div className="stat">Saldo {year}<strong>{item.pesos === 0 ? "$ -" : formatStatementPesos(item.pesos)}</strong></div>
      </div>
      {item.pesos === 0 && (
        <span className="muted row" style={{ gap: 6 }}>
          <AlertTriangle size={14} /> La partida aparece en el estado con saldo $0: conserva su nota.
        </span>
      )}
      <strong className="form-section__subtitle">Detalle de la nota</strong>
      {paragraphs.length === 0 && <span className="muted">Sin detalle adicional: la nota muestra solo la tabla con el saldo. Agrega los párrafos que quieras explicar.</span>}
      {paragraphs.map((text, i) => (
        <div key={i} className="row" style={{ gap: 6, alignItems: "flex-start" }}>
          <Textarea aria-label={`Párrafo ${i + 1} de la nota ${item.number}`} rows={3} value={text} onChange={(e) => onChange(paragraphs.map((p, k) => (k === i ? e.target.value : p)))} />
          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label={`Quitar párrafo ${i + 1}`} onClick={() => onChange(paragraphs.filter((_, k) => k !== i))} />
        </div>
      ))}
      <div>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => onChange([...paragraphs, ""])}>
          Agregar párrafo
        </Button>
      </div>
      <span className="muted row" style={{ gap: 6 }}>
        <FileText size={14} /> En el PDF aparece: «Se compone de la siguiente forma», la tabla con el saldo y estos párrafos.
      </span>
    </div>
  );
}
