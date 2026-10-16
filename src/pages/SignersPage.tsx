import { useEffect, useRef, useState } from "react";
import { ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, FormSection, Input, Loader, Modal, PageHeader, Select, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { signerService } from "../services/signerService";
import { SIGNER_FS_ROLE_LABEL, signerFsRole, type CertificateSigner, type CertificateSignerInput, type SignerFsRole } from "../types/models";

const empty: CertificateSignerInput = { name: "", role: "", professionalDocument: "", personalDocument: "", accountantTitle: "", fsExcluded: false, signatureFile: "" };

/** Rol EEFF elegido en el formulario → campos guardados. */
const roleFields = (role: SignerFsRole): Pick<CertificateSignerInput, "accountantTitle" | "fsExcluded"> =>
  role === "excluded" ? { accountantTitle: "", fsExcluded: true } : role === "pending" ? { accountantTitle: "", fsExcluded: false } : { accountantTitle: role, fsExcluded: false };

const ROLE_TONE: Record<SignerFsRole, "success" | "warning" | undefined> = { "Contador Público": "success", "Contadora Pública": "success", pending: "warning", excluded: undefined };

/** Miniatura de la firma PNG en la tabla (se lee del almacenamiento persistente de firmas). */
function SignatureThumb({ signer }: { signer: CertificateSigner }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (signer.signatureAvailable) signerService.dataUrl(signer.signatureFile).then((u) => alive && setUrl(u), () => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [signer.signatureAvailable, signer.signatureFile]);
  return url ? <img src={url} alt={`Firma de ${signer.name}`} className="signer-thumb" /> : <span className="signer-thumb signer-thumb--empty">—</span>;
}
/** "loading" mientras se lee la firma guardada; "missing" si SQLite la referencia pero el archivo ya no está. */
type SignatureStatus = "none" | "loading" | "ok" | "missing";

const signatureBox = { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 110, padding: 12, border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)" } as const;

export function SignersPage() {
  const toast = useToast(); const list = useAsync(() => signerService.list(), []);
  const [editing, setEditing] = useState<CertificateSigner | null | undefined>(); const [removing, setRemoving] = useState<CertificateSigner | null>(null);
  const [values, setValues] = useState<CertificateSignerInput>(empty); const [preview, setPreview] = useState<string | null>(null); const [status, setStatus] = useState<SignatureStatus>("none");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [picking, setPicking] = useState(false);
  // Evita que una lectura lenta de la firma guardada pise una firma recién seleccionada.
  const loadToken = useRef(0);

  function open(s: CertificateSigner | null) {
    const token = ++loadToken.current;
    setEditing(s); setPreview(null); setError(null);
    if (!s) { setValues(empty); setStatus("none"); return; }
    setValues({ name: s.name, role: s.role, professionalDocument: s.professionalDocument, personalDocument: s.personalDocument, accountantTitle: s.accountantTitle, fsExcluded: s.fsExcluded, signatureFile: s.signatureAvailable ? s.signatureFile : "" });
    if (!s.signatureAvailable) { setStatus(s.signatureFile ? "missing" : "none"); return; }
    setStatus("loading");
    const markMissing = () => { if (token === loadToken.current) { setStatus("missing"); setValues(v => ({ ...v, signatureFile: "" })); } };
    signerService.dataUrl(s.signatureFile).then(url => { if (token !== loadToken.current) return; if (url) { setPreview(url); setStatus("ok"); } else markMissing(); }, markMissing);
  }
  async function pick() {
    setPicking(true); setError(null);
    try { const r = await signerService.pickSignature(); if (r) { loadToken.current++; setValues(v => ({ ...v, signatureFile: r.signatureFile })); setPreview(r.dataUrl); setStatus("ok"); } }
    catch (e) { setError((e as Error).message || "No fue posible cargar la firma. Intenta seleccionarla nuevamente."); }
    finally { setPicking(false); }
  }
  async function save() {
    if (!values.name.trim() || !values.role.trim() || !values.professionalDocument.trim() || !values.signatureFile || status !== "ok") { setError("Completa todos los campos e importa la firma PNG."); return; }
    setBusy(true);
    try { editing ? await signerService.update(editing.id, values) : await signerService.create(values); toast(editing ? "Firma actualizada." : "Firma creada."); setEditing(undefined); void list.reload(); }
    catch (e) { setError((e as Error).message || "No fue posible guardar la imagen de la firma."); }
    finally { setBusy(false); }
  }
  async function remove() { if (!removing) return; setBusy(true); try { await signerService.remove(removing.id); toast("Firma eliminada."); setRemoving(null); void list.reload(); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); } }

  const changed = status === "ok" && !!editing && values.signatureFile !== editing.signatureFile;
  return <>
    <PageHeader eyebrow="Datos" title="Firmas" description="Firmantes reutilizables para certificados y Estados Financieros." actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => open(null)}>Nueva firma</Button>} />
    <Card flush title="Firmas registradas">
      {list.loading && !list.data ? <Loader /> : list.data?.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Firma</th><th>Firmante</th><th>Estado</th><th>Cargo</th><th>Rol EEFF</th><th>Documento profesional</th><th>Documento de identidad</th><th /></tr></thead><tbody>{list.data.map(s => <tr key={s.id} className="is-clickable" onClick={() => open(s)}><td><SignatureThumb signer={s} /></td><td><span className="table__primary">{s.name}</span></td><td>{s.signatureAvailable ? <Badge tone="success">Firma cargada</Badge> : <Badge tone="danger">Sin firma</Badge>}</td><td>{s.role}</td><td><Badge tone={ROLE_TONE[signerFsRole(s)]}>{SIGNER_FS_ROLE_LABEL[signerFsRole(s)]}</Badge></td><td>{s.professionalDocument}</td><td>{s.personalDocument || "—"}</td><td className="actions" onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => open(s)} /><Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setRemoving(s)} /></td></tr>)}</tbody></table></div> : <EmptyState title="Aún no hay firmas" description="Crea un firmante para usarlo en los certificados." action={<Button variant="primary" onClick={() => open(null)}>Nueva firma</Button>} />}
    </Card>
    <Modal open={editing !== undefined} size="lg" title={editing ? "Editar firma" : "Nueva firma"} onClose={() => setEditing(undefined)} locked={busy} footer={<><Button variant="ghost" onClick={() => setEditing(undefined)}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Guardar</Button></>}>
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="signer-form">
          <FormSection step={1} title="Firma" className="signer-form__signature">
            {status === "ok" && preview ? <div style={signatureBox}><img src={preview} alt="Firma" style={{ maxHeight: 90, maxWidth: "100%", objectFit: "contain" }} /></div>
              : status === "loading" ? <div style={signatureBox}><Loader /></div>
              : <div style={{ ...signatureBox, color: "var(--color-muted)" }}>{status === "missing" ? "La imagen guardada ya no está disponible" : "Sin firma"}</div>}
            {status === "missing" && <Alert tone="warning">Vuelve a cargar la firma PNG.</Alert>}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="field__hint">{editing && !changed && status === "ok" ? "Firma actual · " : ""}PNG, máximo 5 MB, con transparencia.</span>
              <Button size="sm" icon={<ImagePlus size={14} />} loading={picking} disabled={status === "loading"} onClick={() => void pick()}>{status === "ok" ? "Cambiar" : "Cargar firma PNG"}</Button>
            </div>
          </FormSection>
          <FormSection step={2} title="Identificación">
            <Field label="Nombre" required>{id => <Input id={id} value={values.name} onChange={e => setValues(v => ({ ...v, name: e.target.value }))} />}</Field>
            <Field label="Documento de identidad" hint="Opcional. Aparece bajo la firma del certificado de ingresos.">{id => <Input id={id} value={values.personalDocument} onChange={e => setValues(v => ({ ...v, personalDocument: e.target.value }))} placeholder="CC 1192729629" />}</Field>
          </FormSection>
          <FormSection step={3} title="Información profesional">
            <Field label="Cargo" required>{id => <Input id={id} value={values.role} onChange={e => setValues(v => ({ ...v, role: e.target.value }))} />}</Field>
            <Field label="Documento profesional" required hint="Ej. TP-290048">{id => <Input id={id} value={values.professionalDocument} onChange={e => setValues(v => ({ ...v, professionalDocument: e.target.value }))} />}</Field>
          </FormSection>
          <FormSection step={4} title="Uso en Estados Financieros" className="signer-form__signature" hint="No se deduce del nombre. Sin definir, la firma no se puede usar en el PDF de Estados Financieros.">
            <Field label="Se muestra como">{id => <Select id={id} value={signerFsRole(values)} onChange={e => setValues(v => ({ ...v, ...roleFields(e.target.value as SignerFsRole) }))}><option value="pending">Sin definir (Pendiente EEFF)</option><option value="Contador Público">Contador Público</option><option value="Contadora Pública">Contadora Pública</option><option value="excluded">No usar como contador en EEFF</option></Select>}</Field>
          </FormSection>
        </div>
      </div>
    </Modal>
    <ConfirmDialog open={!!removing} danger title="Eliminar firma" message="La firma y su imagen se eliminarán." confirmLabel="Eliminar" loading={busy} onCancel={() => setRemoving(null)} onConfirm={() => void remove()} />
  </>;
}
