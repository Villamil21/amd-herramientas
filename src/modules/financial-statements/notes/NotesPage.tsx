import { Download, Eye, FileText, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, DateInput, Field, Modal, PageHeader, Select, Textarea, useToast } from "../../../components/ui";
import { LogoThumb } from "../../../components/LogoThumb";
import { getLogoDataUrl } from "../../../services/companyService";
import { fileService } from "../../../services/fileService";
import { fsService } from "../../../services/fsService";
import { signerService } from "../../../services/signerService";
import { errorMessage } from "../../../services/tauri";
import type { CertificateSigner } from "../../../types/models";
import { PdfPages } from "../generator/components";
import { loadImage } from "../generator/snapshot";
import { ACCOUNTING_LABEL, ACCOUNTING_PRESENTATIONS } from "../shared/accountingPresentation";
import { CompanySelect } from "../shared/components/CompanySelect";
import { formatPdfNit, formatStatementPesos } from "../shared/money";
import { companySnapshot, initialNotesData, noteTableTotal, NO_BALANCES_TEXT, pruneEdits, titleName, type CapitalTable, type CompanySnapshot, type NoteItem, type NotesData } from "./model";
import { notesFileName, renderNotesPdf } from "./pdf";
import { POLICY_BLOCKS } from "./policies";
import { useNotesStatements } from "./useNotesStatements";

const currentYear = new Date().getFullYear();
type Selected = "general" | string;

/**
 * Notas Financieras: elige empresa y el mismo período de los estados (con la presentación compartida del Generador). Las notas de
 * carácter general se leen de Empresas y no se editan aquí; las notas específicas son grupos contables numerados de forma
 * consecutiva (el mismo número de la columna NOTA de los estados) y solo sus párrafos de detalle se editan, por período y empresa.
 */
export default function NotesPage() {
  const toast = useToast();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [start, setStart] = useState(`${currentYear}-01-01`);
  const [end, setEnd] = useState(`${currentYear}-12-31`);
  const { companies, company, model, rangeOk, loading, accounting, changeAccounting } = useNotesStatements(companyId, start, end);
  const presentation = accounting ?? "";
  const [signers, setSigners] = useState<CertificateSigner[]>([]);
  const [accountantId, setAccountantId] = useState<number | null>(null);

  const [data, setData] = useState<NotesData | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [snapshot, setSnapshot] = useState<CompanySnapshot | null>(null);
  const [selected, setSelected] = useState<Selected>("general");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Uint8Array | null | "loading">(null);

  useEffect(() => {
    signerService.list().then(setSigners, (e) => toast(errorMessage(e), "error"));
  }, [toast]);
  const validAccountants = signers.filter((x) => x.signatureAvailable && x.accountantTitle && !x.fsExcluded);
  // Con un solo contador válido no hay nada que elegir.
  useEffect(() => {
    if (accountantId === null && validAccountants.length === 1) setAccountantId(validAccountants[0].id);
  }, [accountantId, validAccountants]);
  const accountant = signers.find((x) => x.id === accountantId) ?? null;

  // Carga lo guardado para empresa y período, o parte de los datos de Empresas.
  useEffect(() => {
    setData(null);
    setSnapshot(null);
    setSaved("");
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
          setSnapshot(stored.companySnapshot as CompanySnapshot);
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
  // Las notas de carácter general salen SIEMPRE de Empresas (no se editan aquí): se vuelven a tomar en cada lectura.
  const current = useMemo(() => {
    if (!data || !company) return null;
    const general = initialNotesData(companySnapshot(company), { start, end }, presentation);
    return { ...pruneEdits(data, items), entityNarrative: general.entityNarrative, corporatePurpose: general.corporatePurpose, review: general.review, presentation };
  }, [data, items, company, start, end, presentation]);
  const dirty = !!current && JSON.stringify(current) !== saved;
  const item = items.find((i) => i.key === selected) ?? null;

  // Parte de las ediciones ya migradas (las guardadas por partida pasan a su grupo) para no duplicar párrafos al editar.
  const editParagraphs = (key: string, paragraphs: string[]) =>
    setData((d) => {
      if (!d) return d;
      const base = pruneEdits(d, items);
      return { ...base, notes: { ...base.notes, [key]: { paragraphs } } };
    });

  async function persist(generated: boolean) {
    if (!company || !current) return;
    const snap = companySnapshot(company);
    const stored = await fsService.saveNotes({ companyId: company.id, periodStart: start, periodEnd: end, data: current, companySnapshot: snap, generated });
    setData(stored.data as NotesData);
    setSaved(JSON.stringify(stored.data));
    setSnapshot(snap);
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
    const signature = accountant?.signatureFile ? await signerService.dataUrl(accountant.signatureFile).then(loadImage, () => null) : null;
    const sh = company.shareholders.find((x) => x.legalRole === "principal");
    const parts = sh?.firstName?.trim() && sh.firstSurname?.trim() ? { firstName: sh.firstName, otherNames: sh.otherNames, firstSurname: sh.firstSurname, secondSurname: sh.secondSurname } : null;
    const { bytes } = await renderNotesPdf({
      companyName: company.razonSocial,
      nit: company.nit,
      dv: company.dv,
      logo,
      startDate: start,
      endDate: end,
      entityNarrative: current.entityNarrative,
      corporatePurpose: current.corporatePurpose,
      items,
      edits: current.notes,
      city: company.ciudad,
      generatedAt: new Date(),
      legalRep: { name: company.legalRepName, document: company.legalRepDocument, parts },
      accountant: { name: accountant?.name ?? "", title: accountant?.accountantTitle ?? "", identification: accountant?.personalDocument ?? "", professionalDocument: accountant?.professionalDocument ?? "", signature },
    });
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

  const ready = !!company && !!current && !!model;
  const pdfMissing = [!company?.legalRepName && "Falta el representante legal en Empresas", !accountant && "Elige el contador (con firma PNG y «Contador Público» / «Contadora Pública» definido en Firmas)"].filter(Boolean) as string[];
  const rep = company?.legalRepName ? titleName(company.legalRepName) : "";

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros"
        title="Notas Financieras"
        description="Notas a los estados financieros del mismo período: notas generales de Empresas y notas específicas por grupo contable, numeradas como la columna NOTA."
        actions={
          <>
            <Button icon={<Save size={15} />} onClick={() => void save()} loading={busy === "save"} disabled={!ready || !dirty}>
              Guardar
            </Button>
            <Button icon={<Eye size={15} />} onClick={() => void openPreview()} disabled={!ready}>
              Vista previa
            </Button>
            <Button variant="primary" icon={<Download size={15} />} onClick={() => void download()} loading={busy === "pdf"} disabled={!ready || pdfMissing.length > 0}>
              Descargar PDF
            </Button>
          </>
        }
      />
      <Card title="Empresa y período">
        <div className="notes-config">
          <div className="notes-config__company">
            <CompanySelect companies={companies} value={companyId} onChange={setCompanyId} />
          </div>
          <Field label="Fecha inicial" required>{(id) => <DateInput id={id} value={start} onChange={setStart} />}</Field>
          <Field label="Fecha final" required error={start && end && start > end ? "Debe ser posterior a la inicial." : null}>{(id) => <DateInput id={id} value={end} onChange={setEnd} />}</Field>
          <Field label="Presentación" hint="La misma de los Estados Financieros (una por empresa y año). No se imprime.">
            {(id) => (
              <Select id={id} value={accounting ?? ""} disabled={!accounting} onChange={(e) => changeAccounting(e.target.value)}>
                {!accounting && <option value="">{companyId !== null && rangeOk ? "Cargando…" : "Elige empresa y fechas"}</option>}
                {ACCOUNTING_PRESENTATIONS.map((p) => (
                  <option key={p} value={p}>
                    {ACCOUNTING_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Contador / Contadora" hint={validAccountants.length === 0 ? "En Firmas, define «Contador Público» o «Contadora Pública» y carga la firma PNG." : "Firma la certificación final."}>
            {(id) => (
              <Select id={id} value={accountantId ?? ""} onChange={(e) => setAccountantId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Seleccionar…</option>
                {validAccountants.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.accountantTitle}
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
                  NIT {formatPdfNit(company.nit, company.dv)} · {items.length} {items.length === 1 ? "nota específica" : "notas específicas"}
                </span>
                <span className="muted">{rep ? `Representante legal: ${rep}` : "Sin representante legal principal en Empresas."}</span>
              </div>
              <div className="stack stack--sm" style={{ alignItems: "flex-end" }}>
                <Badge tone={dirty ? "warning" : "success"}>{dirty ? "Cambios sin guardar" : saved ? "Guardado" : "Sin guardar"}</Badge>
                {snapshot && <span className="muted">Datos de Empresas tomados el {new Date(snapshot.takenAt).toLocaleDateString("es-CO")}</span>}
              </div>
            </div>
          </Card>
          {pdfMissing.length > 0 && <Alert tone="info">Para el PDF: {pdfMissing.join(" · ")}.</Alert>}
          <div className="notes-layout">
            <nav className="notes-list" aria-label="Notas">
              <button type="button" className={`notes-list__item${selected === "general" ? " is-active" : ""}`} onClick={() => setSelected("general")}>
                <span>Notas de carácter general</span>
                {current.review.length > 0 && <Badge tone="warning">Revisar</Badge>}
              </button>
              <div className="notes-list__group">Notas de carácter específico</div>
              {items.length === 0 && <span className="muted">Los estados no tienen grupos con nota.</span>}
              {items.map((i) => (
                <button key={i.key} type="button" className={`notes-list__item${selected === i.key ? " is-active" : ""}`} onClick={() => setSelected(i.key)}>
                  <span>
                    {i.number}. {i.title}
                  </span>
                  <span className="muted">{i.body.kind === "empty" ? "Sin saldos" : formatStatementPesos(i.pesos)}</span>
                </button>
              ))}
            </nav>
            <section className="notes-editor" aria-live="polite">
              {selected === "general" || !item ? (
                <GeneralView data={current} startDate={start} endDate={end} />
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

function GeneralView({ data, startDate, endDate }: { data: NotesData; startDate: string; endDate: string }) {
  const flagged = (f: "entityNarrative" | "corporatePurpose") => data.review.includes(f);
  return (
    <div className="stack">
      <h3 className="notes-editor__title">Notas de carácter general</h3>
      <Alert tone="info">
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>Este contenido se configura desde el módulo Empresas.</span>
          <Button size="sm" onClick={() => navigate(paths.companies)}>
            Ir a Empresas
          </Button>
        </div>
      </Alert>
      <div className="stack stack--sm">
        <strong className="form-section__subtitle">
          Ente económico {flagged("entityNarrative") && <Badge tone="warning">Revisar en Empresas</Badge>}
        </strong>
        <p className="selectable" style={{ margin: 0 }}>{data.entityNarrative || <span className="muted">Sin ente económico en Empresas.</span>}</p>
      </div>
      <div className="stack stack--sm">
        <strong className="form-section__subtitle">
          Objeto social {flagged("corporatePurpose") && <Badge tone="warning">Revisar en Empresas</Badge>}
        </strong>
        <p className="selectable" style={{ margin: 0, whiteSpace: "pre-line" }}>{data.corporatePurpose || <span className="muted">Sin objeto social en Empresas.</span>}</p>
      </div>
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

function CapitalPreview({ table }: { table: CapitalTable }) {
  return (
    <table className="notes-table">
      <thead>
        <tr>
          <th style={{ width: 44 }}>No.</th>
          <th style={{ textAlign: "left" }}>Accionista</th>
          <th className="num">Valor nominal</th>
          <th className="num">Número de acciones</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r) => (
          <tr key={r.number}>
            <td style={{ fontStyle: "normal" }}>{r.number}</td>
            <td>{r.name}</td>
            <td className="num">{formatStatementPesos(r.nominalValue)}</td>
            <td className="num">{r.shares.toLocaleString("es-CO")}</td>
            <td className="num">{formatStatementPesos(r.total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td />
          <td>TOTAL</td>
          <td className="num" />
          <td className="num">{table.totalShares.toLocaleString("es-CO")}</td>
          <td className="num">{formatStatementPesos(table.total)}</td>
        </tr>
      </tfoot>
    </table>
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
        <div className="stat">Grupo<strong>{item.title}</strong></div>
        <div className="stat">Saldo {year}<strong>{item.body.kind === "empty" ? "Sin saldos" : formatStatementPesos(item.pesos)}</strong></div>
      </div>
      {item.body.kind === "empty" && <span className="muted">{NO_BALANCES_TEXT}</span>}
      {item.body.kind === "capital" &&
        (item.body.table ? <CapitalPreview table={item.body.table} /> : <Alert tone="warning">El capital suscrito y los accionistas no están configurados en Empresas.</Alert>)}
      {item.body.kind === "table" && (
        <table className="notes-table">
          <thead>
            <tr>
              <th />
              <th className="num">{year}</th>
            </tr>
          </thead>
          <tbody>
            {item.body.rows.map((r, i) => (
              <tr key={i}>
                <td style={{ paddingLeft: r.indent ? 24 : 8 }}>{r.label}</td>
                <td className="num">{r.pesos === undefined ? "" : formatStatementPesos(r.pesos)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>TOTAL</td>
              <td className="num">{formatStatementPesos(noteTableTotal(item.body.rows))}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <strong className="form-section__subtitle">Detalle de la nota</strong>
      {paragraphs.length === 0 && <span className="muted">Sin detalle adicional. Agrega los párrafos que quieras explicar (solo para esta empresa y este período).</span>}
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
        <FileText size={14} /> En el PDF aparece la tabla de la nota y, debajo, estos párrafos justificados.
      </span>
    </div>
  );
}
