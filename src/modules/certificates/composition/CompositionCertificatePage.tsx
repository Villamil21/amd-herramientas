import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Field, Loader, PageHeader, Select } from "../../../components/ui";
import { useAsync } from "../../../hooks/useAsync";
import { companyService, getLogoDataUrl } from "../../../services/companyService";
import { signerService } from "../../../services/signerService";
import { fileService } from "../../../services/fileService";
import { build, formatMoney, formatNumber, validate } from "./model";
import { renderCompositionPdf } from "./pdf";

const LAST_COMPANY = "composition.lastCompanyId";
const LAST_SIGNER = "composition.lastSignerId";
const readId = (key: string) => { try { const value = Number(localStorage.getItem(key)); return Number.isSafeInteger(value) && value > 0 ? value : null; } catch { return null; } };
const saveId = (key: string, value: number | null) => { try { value ? localStorage.setItem(key, String(value)) : localStorage.removeItem(key); } catch { /* preferencia no esencial */ } };

export default function CompositionCertificatePage() {
  const companies = useAsync(() => companyService.list(), []);
  const signers = useAsync(() => signerService.list(), []);
  const [companyId, setCompanyId] = useState<number | null>(() => readId(LAST_COMPANY));
  const [signerId, setSignerId] = useState<number | null>(() => readId(LAST_SIGNER));
  const [logo, setLogo] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const company = companies.data?.find((item) => item.id === companyId) ?? null;
  const signer = signers.data?.find((item) => item.id === signerId) ?? null;

  useEffect(() => { if (companies.data?.length && !companyId) setCompanyId(companies.data[0].id); }, [companies.data, companyId]);
  useEffect(() => { if (signers.data?.length && !signerId) setSignerId(signers.data[0].id); }, [signers.data, signerId]);
  useEffect(() => { saveId(LAST_COMPANY, companyId); }, [companyId]);
  useEffect(() => { saveId(LAST_SIGNER, signerId); }, [signerId]);
  useEffect(() => { setLogo(null); if (company?.logoFile) void getLogoDataUrl(company.logoFile).then(setLogo); }, [company?.logoFile]);
  useEffect(() => { setSignature(null); if (signer) void signerService.dataUrl(signer.signatureFile).then(setSignature); }, [signer?.signatureFile]);

  const errors = validate(company, signer, logo, signature);
  const doc = useMemo(() => company && signer && logo && signature && errors.length === 0 ? build(company, signer, logo, signature) : null, [company, signer, logo, signature, errors.length]);
  async function generate() {
    if (!doc) return;
    setBusy(true); setError(null);
    try {
      const fresh = build(company!, signer!, logo!, signature!, new Date());
      const path = await fileService.savePdf(await renderCompositionPdf(fresh), fresh.fileName);
      if (path) setError(`PDF guardado: ${path}`);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  if (companies.loading || signers.loading) return <Loader />;
  return <>
    <PageHeader eyebrow="Certificados" title="Composición Accionaria" description="Genera un certificado de una sola página con la información accionaria persistente." />
    {error && <Alert tone={error.startsWith("PDF guardado") ? "success" : "danger"}>{error}</Alert>}
    <Card title="Datos del certificado">
      <div className="form-grid">
        <Field label="Empresa" required>{id => <Select id={id} value={companyId ?? ""} onChange={event => { setCompanyId(event.target.value ? Number(event.target.value) : null); setPreview(false); }}><option value="">Seleccionar empresa…</option>{companies.data?.map(item => <option key={item.id} value={item.id}>{item.razonSocial}</option>)}</Select>}</Field>
        <Field label="Firmante" required>{id => <Select id={id} value={signerId ?? ""} onChange={event => { setSignerId(event.target.value ? Number(event.target.value) : null); setPreview(false); }}><option value="">Seleccionar firma…</option>{signers.data?.map(item => <option key={item.id} value={item.id}>{item.name} — {item.role}</option>)}</Select>}</Field>
      </div>
      {errors.length > 0 && <Alert tone="warning">{errors.map(message => <div key={message}>{message}</div>)}</Alert>}
      <div className="row"><Button variant="secondary" disabled={errors.length > 0} onClick={() => setPreview(true)}>Vista previa</Button><Button variant="primary" disabled={errors.length > 0 || !preview} loading={busy} onClick={() => void generate()}>Generar PDF</Button></div>
    </Card>
    {preview && doc && <Card title="Vista previa del certificado" description="Los datos, cálculos y orden de tablas son los mismos que se exportarán."><div style={{ maxWidth: 850, margin: "auto", background: "white", color: "#111", padding: 28, fontSize: 12 }}><img src={doc.logo} alt="Logo" style={{ display: "block", maxHeight: 36, maxWidth: 120, margin: "0 auto" }} /><h2 style={{ textAlign: "center" }}>COMPOSICIÓN ACCIONARIA</h2><p>Mediante el presente documento y obrando en mi calidad de Contadora Pública titulada mediante resolución expedida por el Ministerio de educación Nacional a través la Junta Central de Contadores bajo la Matrícula T-{doc.professionalNumber}</p><p>Que la sociedad {doc.company.razonSocial}, identificada con NIT {doc.company.nit}-{doc.company.dv}. Tiene un capital accionario dividido de la siguiente manera:</p>{[doc.subscribed, doc.paid].map(capital => <div key={capital.title}><h3 style={{ textAlign: "center" }}>{capital.title}</h3><table className="table" style={{ fontSize: 11 }}><thead><tr><th>No</th><th>Accionista</th><th>Doc Identidad</th><th>Vlr Nominal</th><th>No Acciones</th><th>Vlr Acciones</th></tr></thead><tbody>{capital.rows.map(row => <tr key={row.index}><td>{row.index}</td><td>{row.shareholder.name}</td><td>{row.shareholder.identityDocument}</td><td>{formatMoney(row.nominal)}</td><td>{formatNumber(row.shares)}</td><td>{formatMoney(row.value)}</td></tr>)}<tr><td /><td><strong>TOTAL</strong></td><td /><td /><td><strong>{formatNumber(capital.totalShares)}</strong></td><td><strong>{formatMoney(capital.totalShares * capital.nominalValue)}</strong></td></tr></tbody></table></div>)}<p>{doc.dateText}</p><img src={doc.signature} alt="Firma" style={{ maxHeight: 60, maxWidth: 180, objectFit: "contain" }} /><div><strong>{doc.signer.name}</strong><br />{doc.signer.role}<br />TP. T-{doc.professionalNumber} JUNTA CENTRAL DE CONTADORES</div></div></Card>}
  </>;
}
