import { useRef, useState } from "react";
import { ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Loader, Modal, PageHeader, useToast } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { signerService } from "../services/signerService";
import type { CertificateSigner, CertificateSignerInput } from "../types/models";

const empty: CertificateSignerInput = { name: "", role: "", professionalDocument: "", personalDocument: "", signatureFile: "" };
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
    setValues({ name: s.name, role: s.role, professionalDocument: s.professionalDocument, personalDocument: s.personalDocument, signatureFile: s.signatureAvailable ? s.signatureFile : "" });
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
    <PageHeader eyebrow="Datos" title="Firmas" description="Firmantes reutilizables para certificados." actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => open(null)}>Nueva firma</Button>} />
    <Card flush title="Firmas registradas">
      {list.loading && !list.data ? <Loader /> : list.data?.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Firmante</th><th>Cargo</th><th>Documento profesional</th><th>Documento de identidad</th><th /></tr></thead><tbody>{list.data.map(s => <tr key={s.id} className="is-clickable" onClick={() => open(s)}><td><span className="table__primary">{s.name}</span>{!s.signatureAvailable && <> <Badge tone="warning">Firma faltante</Badge></>}</td><td>{s.role}</td><td>{s.professionalDocument}</td><td>{s.personalDocument || "—"}</td><td className="actions" onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} aria-label="Editar" onClick={() => open(s)} /><Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} aria-label="Eliminar" onClick={() => setRemoving(s)} /></td></tr>)}</tbody></table></div> : <EmptyState title="Aún no hay firmas" description="Crea un firmante para usarlo en los certificados." action={<Button variant="primary" onClick={() => open(null)}>Nueva firma</Button>} />}
    </Card>
    <Modal open={editing !== undefined} title={editing ? "Editar firma" : "Nueva firma"} onClose={() => setEditing(undefined)} locked={busy} footer={<><Button variant="ghost" onClick={() => setEditing(undefined)}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Guardar</Button></>}>
      <div className="stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="stack stack--sm">
          {status === "ok" && preview ? <>
            <div className="field__label">{editing && !changed ? "Firma actual" : "Vista previa de la firma"}</div>
            <div style={signatureBox}><img src={preview} alt="Firma" style={{ maxHeight: 90, maxWidth: "100%", objectFit: "contain" }} /></div>
          </> : status === "loading" ? <div style={signatureBox}><Loader /></div> : <>
            {status === "missing" && <Alert tone="warning">Firma no disponible. La imagen de firma guardada ya no está disponible; vuelve a cargarla.</Alert>}
            {status === "none" && <div className="field__hint">No hay firma cargada.</div>}
          </>}
          <div className="row"><Button icon={<ImagePlus size={14} />} loading={picking} disabled={status === "loading"} onClick={() => void pick()}>{status === "ok" ? "Cambiar firma PNG" : "Cargar firma PNG"}</Button></div>
          <span className="field__hint">PNG, máximo 5 MB. Se conserva tal cual, con su transparencia.</span>
        </div>
        <Field label="Nombre" required>{id => <Input id={id} value={values.name} onChange={e => setValues(v => ({ ...v, name: e.target.value }))} />}</Field>
        <Field label="Cargo" required>{id => <Input id={id} value={values.role} onChange={e => setValues(v => ({ ...v, role: e.target.value }))} />}</Field>
        <Field label="Documento profesional" required hint="Ej. TP-290048">{id => <Input id={id} value={values.professionalDocument} onChange={e => setValues(v => ({ ...v, professionalDocument: e.target.value }))} />}</Field>
        <Field label="Documento de identidad" hint="Opcional. Ej. CC 1192729629. Aparece bajo la firma del certificado de ingresos.">{id => <Input id={id} value={values.personalDocument} onChange={e => setValues(v => ({ ...v, personalDocument: e.target.value }))} />}</Field>
      </div>
    </Modal>
    <ConfirmDialog open={!!removing} danger title="Eliminar firma" message="La firma y su imagen se eliminarán." confirmLabel="Eliminar" loading={busy} onCancel={() => setRemoving(null)} onConfirm={() => void remove()} />
  </>;
}
