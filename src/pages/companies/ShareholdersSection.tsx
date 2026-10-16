import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, Input, Modal, useToast } from "../../components/ui";
import { allocateCapital, subscribedCapitalPesos } from "../../modules/exogena/domain/capital";
import { useCatalogs } from "../../modules/exogena/hooks";
import { companyService } from "../../services/companyService";
import { RUT_STATUS_LABEL, type Company, type CompanyInput, type Shareholder } from "../../types/models";
import { pickShareholderRut, discardPicked, ShareholderModal, type PickedRut } from "./ShareholderModal";
import { matchShareholder, allocatedLabel } from "./shareholders";
import { sumsTo100, totalPercent } from "./normalize";

const NEW_SHAREHOLDER = (count: number): Shareholder => ({ name: "", identityDocument: "", percentage: count === 0 ? 100 : 0, sortOrder: count, legalRole: null, rutStatus: "pendiente", documents: [], newDocuments: [] });

interface Props {
  values: CompanyInput;
  /** Empresa ya guardada (null: nueva). */
  company: Company | null;
  update: (change: (list: CompanyInput["shareholders"]) => CompanyInput["shareholders"]) => void;
  error?: string;
}

/**
 * Socios / accionistas. La tabla solo muestra lo esencial (nombre o razón social, documento, participación, capital asignado y
 * estado del RUT); crear o editar abre la ficha completa del socio.
 */
export function ShareholdersSection({ values, company, update, error }: Props) {
  const toast = useToast();
  const { catalogs, index } = useCatalogs();
  const [editing, setEditing] = useState<{ index: number | null; imported?: PickedRut | null } | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const list = values.shareholders;
  const capital = subscribedCapitalPesos({ subscribedTotalShares: values.subscribedTotalShares, subscribedNominalValue: values.subscribedNominalValue });
  const allocation = useMemo(() => (capital === null || !list.length || !sumsTo100(list) ? null : allocateCapital(capital, list)), [capital, list]);
  const okTotal = list.length === 0 || sumsTo100(list);

  // Importar el RUT de un socio exige la empresa guardada con su RUT y su Cámara de Comercio.
  const docs = company?.documents ?? [];
  const importBlockedReason = !company ? "Guarda primero la empresa." : !docs.some((d) => d.kind === "rut") || !docs.some((d) => d.kind === "camara") ? "La empresa debe tener guardados su RUT y su Cámara de Comercio antes de importar el RUT de un socio." : list.length === 0 ? "Agrega primero a los socios." : null;

  async function importForAny() {
    if (!catalogs || !index) return;
    setImporting(true);
    try {
      const picked = await pickShareholderRut(catalogs, index);
      if (!picked) return;
      const match = matchShareholder(list, picked.rut);
      if (!match) {
        await discardPicked(picked);
        const who = picked.rut.businessName ?? ([picked.rut.firstSurname, picked.rut.secondSurname, picked.rut.firstName, picked.rut.otherNames].filter(Boolean).join(" ") || "la persona del RUT");
        setNotFound(`Ningún socio de la empresa coincide con ${who}${picked.rut.docNumber ? ` (documento ${picked.rut.docNumber})` : ""}, ni por documento ni por nombre. No se importó ni se vinculó nada. Crea o confirma primero al socio y vuelve a importar su RUT.`);
        return;
      }
      setEditing({ index: match.index, imported: picked });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setImporting(false);
    }
  }

  async function remove(i: number) {
    // El RUT cargado y aún sin guardar de un socio que se quita no queda huérfano.
    await Promise.all((list[i].newDocuments ?? []).map((d) => companyService.discardDocument(d.storedFile).catch(() => undefined)));
    update((l) => l.filter((_, k) => k !== i));
  }

  const target = editing === null ? null : editing.index === null ? NEW_SHAREHOLDER(list.length) : list[editing.index];

  return (
    <>
      <div className="row row--between">
        <strong className="form-section__subtitle">Socios / accionistas</strong>
        <div className="row" style={{ gap: 6 }}>
          <span title={importBlockedReason ?? undefined}>
            <Button size="sm" icon={<Upload size={14} />} loading={importing} disabled={!!importBlockedReason || !catalogs} onClick={() => void importForAny()}>
              Importar RUT de un socio
            </Button>
          </span>
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setEditing({ index: null })}>
            Agregar socio
          </Button>
        </div>
      </div>
      {list.length === 0 ? (
        <span className="muted">Sin socios registrados.</span>
      ) : (
        <div className="shareholder-table">
          <div className="shareholder-table__head">
            <span>Nombre o razón social</span>
            <span>Documento</span>
            <span className="num">Participación</span>
            <span>Capital asignado</span>
            <span>RUT</span>
            <span />
          </div>
          {list.map((s, i) => (
            <div className="shareholder-table__row is-clickable" key={s.id ?? `nuevo-${i}`} onClick={() => setEditing({ index: i })}>
              <span className="table__primary">
                {s.name || <span className="muted">Sin nombre</span>}
                {s.legalRole && (
                  <>
                    {" "}
                    <Badge tone="gold">{s.legalRole === "principal" ? "Rep. legal" : "Suplente"}</Badge>
                  </>
                )}
              </span>
              <span className="selectable">{s.identityDocument || "—"}</span>
              <Input readOnly tabIndex={-1} aria-label={`Participación del socio ${i + 1}`} className="input--right" value={s.percentage ? `${String(s.percentage).replace(".", ",")} %` : ""} />
              <span>{allocatedLabel(allocation ? allocation[i] : null)}</span>
              <span>
                <Badge tone={s.rutStatus === "validado" ? "success" : s.rutStatus === "revisar" ? "warning" : undefined}>{RUT_STATUS_LABEL[s.rutStatus ?? "pendiente"]}</Badge>
              </span>
              <span className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={14} />} aria-label={`Editar socio ${i + 1}`} onClick={() => setEditing({ index: i })} />
                <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label={`Quitar socio ${i + 1}`} onClick={() => void remove(i)} />
              </span>
            </div>
          ))}
        </div>
      )}
      <div className={`field__hint ${error || (list.length > 0 && !okTotal) ? "text-danger" : ""}`}>{error ?? `Participación total: ${totalPercent(list)} %. Debe sumar exactamente 100 % para guardar.`}</div>

      {target && (
        <ShareholderModal
          open
          shareholder={target}
          isNew={editing!.index === null}
          others={list.filter((_, i) => i !== editing!.index)}
          capitalPesos={capital}
          catalogs={catalogs}
          index={index}
          importBlockedReason={importBlockedReason}
          initialImport={editing!.imported ?? null}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            const at = editing!.index;
            update((l) => (at === null ? [...l, saved] : l.map((x, i) => (i === at ? { ...saved, id: x.id, legalRole: x.legalRole, documents: x.documents } : x))));
            setEditing(null);
          }}
        />
      )}
      <Modal open={!!notFound} size="sm" title="El RUT no corresponde a ningún socio" onClose={() => setNotFound(null)} footer={<Button variant="primary" onClick={() => setNotFound(null)}>Entendido</Button>}>
        <Alert tone="warning">{notFound}</Alert>
      </Modal>
    </>
  );
}
