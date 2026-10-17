import { useMemo, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Button, Modal } from "../../../../components/ui";
import { purchasesService } from "../../../../services/purchasesService";
import { formatMoneyCents } from "../../../../utils/format";
import { ConceptCombobox } from "../../../exogena/components/ConceptCombobox";
import { PucCodePicker } from "../../puc-codes/components/PucCodePicker";
import { leafConcept } from "../../puc-codes/services/pucCatalog";
import { PROPOSAL_SOURCE_LABEL, productKey } from "../domain/classify";
import { hasRetention, previewRetention } from "../domain/lineDraft";
import { lineLabel, type DocView, type LineView } from "../domain/model";
import type { PurchasesData } from "../usePurchasesData";
import { RetentionPicker } from "./RetentionPicker";

interface Props {
  data: PurchasesData;
  view: DocView;
  l: LineView;
  run: (a: () => Promise<void>, ok?: string) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}

/**
 * Clasificación de UNA línea en un panel aparte (la tabla de la factura se mantiene compacta). Primero lo sugerido —PUC y
 * concepto 1001—, después las retenciones: solo las sugeridas o ya asignadas, y un selector buscable para añadir otras.
 */
export function LineClassifyModal({ data, view, l, run, busy, onClose }: Props) {
  const initial = l.confirmed ? { puc: l.pucCode, concept: l.concept1001, retention: l.retention } : { puc: l.proposal.pucCode, concept: l.proposal.concept1001, retention: l.proposal.retention };
  const [puc, setPuc] = useState(initial.puc);
  const [concept, setConcept] = useState(initial.concept);
  const [retention, setRetention] = useState(initial.retention);
  const [scope, setScope] = useState<"rule" | "invoice">(l.class?.scope ?? "rule");
  const [pickingPuc, setPickingPuc] = useState(!puc);
  const year = view.doc.issueDate ? Number(view.doc.issueDate.slice(0, 4)) : null;
  const concepts = data.concepts1001.map((c) => ({ code: c.code, description: c.description, isActive: c.isActive }));
  const pucConceptSuggestion = puc ? data.concepts1001.find((c) => c.code === (data.pucConceptMap.get(puc) ?? "")) : undefined;
  const suggested = l.confirmed ? [] : l.proposal.retention.map((r) => r.rateId);

  // Base del concepto en toda la factura (cuantía mínima): las demás líneas con lo que muestran y esta con el borrador.
  const conceptBase = useMemo(
    () => (rateId: number) =>
      view.lines.reduce((sum, other) => {
        const picks = other.line.index === l.line.index ? retention : other.confirmed ? other.retention : other.proposal.retention;
        return hasRetention(picks, rateId) ? sum + (other.line.baseCents ?? 0) : sum;
      }, 0),
    [view.lines, l.line.index, retention],
  );

  const save = () =>
    run(async () => {
      await purchasesService.saveLineClasses([
        {
          documentId: view.doc.id,
          lineIndex: l.line.index,
          pucCode: puc,
          concept1001: concept,
          retention,
          saveRule: scope === "rule",
          supplierNit: view.doc.issuerNit,
          productKey: productKey(l.line),
          productLabel: lineLabel(l.line),
        },
      ]);
      onClose();
    }, scope === "rule" ? "Línea confirmada y regla del producto guardada." : "Línea confirmada solo para esta factura (la regla del producto no cambió).");

  const remove = () => run(() => purchasesService.deleteLineClass(view.doc.id, l.line.index).then(onClose), "Se quitó la clasificación de la línea.");

  return (
    <Modal
      open
      size="lg"
      title={`Clasificar línea ${l.line.index + 1}`}
      description={`${lineLabel(l.line)} · Base ${formatMoneyCents(l.line.baseCents ?? 0)} · IVA ${formatMoneyCents(l.line.vatCents ?? 0)}`}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          {l.confirmed && (
            <Button icon={<RotateCcw size={14} />} loading={busy} onClick={() => void remove()}>
              Quitar clasificación
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            Cerrar
          </Button>
          <Button variant="primary" icon={<Check size={14} />} loading={busy} disabled={!puc || !concept} onClick={() => void save()}>
            Confirmar clasificación
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <section className="stack" style={{ gap: 6 }}>
          <strong>Código PUC</strong>
          {pickingPuc ? (
            <PucCodePicker
              index={data.fs.index}
              autoFocus
              confirmLabel="Usar este código"
              onConfirm={(code) => {
                setPuc(code);
                setPickingPuc(false);
                const suggestedConcept = data.pucConceptMap.get(code);
                if (suggestedConcept && !concept) setConcept(suggestedConcept);
              }}
              onCancel={puc ? () => setPickingPuc(false) : undefined}
            />
          ) : (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span>
                {puc} — {leafConcept(data.fs.index, puc) ?? ""}
              </span>
              <Button size="sm" onClick={() => setPickingPuc(true)}>
                Cambiar
              </Button>
              {!l.confirmed && l.proposal.sources.puc && puc === l.proposal.pucCode && <span className="field__hint">{PROPOSAL_SOURCE_LABEL[l.proposal.sources.puc]}</span>}
            </div>
          )}
        </section>

        <section className="stack" style={{ gap: 6 }}>
          <strong>Concepto 1001{year ? ` (${year})` : ""}</strong>
          <ConceptCombobox
            value={concept}
            concepts={concepts}
            onChange={(code) => setConcept(code)}
            onCreate={async (code, description) => {
              if (year === null) throw new Error("La factura no tiene fecha: no hay un año para el concepto.");
              await purchasesService.saveYearConcept({ formatCode: "1001", year, code, description, validFrom: `${year}-01-01`, validTo: "", isActive: true });
              await data.reloadConcepts();
              setConcept(code);
            }}
          />
          {pucConceptSuggestion && !concept && <div className="field__hint">Concepto 1001 sugerido por la cuenta: {pucConceptSuggestion.code}</div>}
          {!l.confirmed && concept && l.proposal.sources.concept && concept === l.proposal.concept1001 && <div className="field__hint">{PROPOSAL_SOURCE_LABEL[l.proposal.sources.concept]}</div>}
        </section>

        <section className="stack" style={{ gap: 6 }}>
          <strong>Retenciones</strong>
          <RetentionPicker
            rates={data.rates}
            picks={retention}
            onChange={setRetention}
            suggested={suggested}
            preview={(rate) => previewRetention(rate, data.rateVersions, view.doc.issueDate, data.uvts, l.line.baseCents ?? 0, conceptBase(rate.id))}
          />
          {view.retention.mismatch && (
            <div className="field__hint">
              La factura informa {formatMoneyCents(view.retention.practicedCents)}; con los conceptos de la factura la tabla da {formatMoneyCents(view.retention.expectedCents)}.
            </div>
          )}
        </section>

        <section className="stack" style={{ gap: 6 }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" checked={scope === "rule"} onChange={() => setScope("rule")} />
            Guardar como regla de este producto para este proveedor
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" checked={scope === "invoice"} onChange={() => setScope("invoice")} />
            Cambiar solo esta factura (no toca la regla)
          </label>
        </section>
      </div>
    </Modal>
  );
}
