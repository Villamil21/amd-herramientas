import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Button, Modal } from "../../../../components/ui";
import { purchasesService } from "../../../../services/purchasesService";
import { formatMoneyCents } from "../../../../utils/format";
import { ConceptCombobox } from "../../../exogena/components/ConceptCombobox";
import { PucCodePicker } from "../../puc-codes/components/PucCodePicker";
import { leafConcept } from "../../puc-codes/services/pucCatalog";
import {
  isNotApplicablePuc,
  NOT_APPLICABLE_LABEL,
  NOT_APPLICABLE_MESSAGE,
  NOT_APPLICABLE_PUC,
  PROPOSAL_SOURCE_LABEL,
  proposalSourceText,
  productKey,
} from "../domain/classify";
import { hasRetention, previewRetention } from "../domain/lineDraft";
import { lineLabel, type DocView, type LineView } from "../domain/model";
import type { PurchasesData } from "../usePurchasesData";
import { RegimeInline } from "./RegimeInline";
import { RetentionSection } from "./RetentionSection";

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
export function LineClassifyModal({
  data,
  view,
  l,
  run,
  busy,
  onClose,
}: Props) {
  const initial = l.confirmed
    ? { puc: l.pucCode, concept: l.concept1001, retention: l.retention }
    : {
        puc: l.proposal.pucCode,
        concept: l.proposal.concept1001,
        retention: l.proposal.retention,
      };
  const [puc, setPuc] = useState(initial.puc);
  const [concept, setConcept] = useState(initial.concept);
  const [retention, setRetention] = useState(initial.retention);
  const [scope, setScope] = useState<"rule" | "invoice">(
    l.class?.scope ?? "rule",
  );
  const [pickingPuc, setPickingPuc] = useState(!puc);
  const notApplicable = isNotApplicablePuc(puc);
  /** O-15 / O-47 en la fecha de la factura: no hay selector ni cálculo de retención. */
  const exemption = view.exemption;
  const year = view.doc.issueDate
    ? Number(view.doc.issueDate.slice(0, 4))
    : null;
  const concepts = data.concepts1001.map((c) => ({
    code: c.code,
    description: c.description,
    isActive: c.isActive,
  }));
  const pucConceptSuggestion = puc
    ? data.concepts1001.find(
        (c) => c.code === (data.pucConceptMap.get(puc) ?? ""),
      )
    : undefined;
  /** Elegir 7305 limpia al instante concepto y retenciones; volver a otra cuenta las exige de nuevo. */
  const choosePuc = (code: string) => {
    setPuc(code);
    setPickingPuc(false);
    if (isNotApplicablePuc(code)) {
      setConcept("");
      setRetention([]);
      return;
    }
    const suggestedConcept = data.pucConceptMap.get(code);
    if (suggestedConcept && !concept) setConcept(suggestedConcept);
  };
  const suggested = l.confirmed
    ? []
    : l.proposal.retention.map((r) => r.rateId);

  // Retenciones que verá cada línea incluida: las demás con lo que muestran y esta con el borrador.
  const picksOf = (other: LineView) => (other.line.index === l.line.index ? retention : other.confirmed ? other.retention : other.proposal.retention);
  const included = view.lines.filter((o) => (o.line.index === l.line.index ? !notApplicable : !o.notApplicable));
  // Base del concepto en toda la factura (cuantía mínima): suma de las líneas incluidas que lo tienen.
  const conceptBase = (rateId: number) => included.reduce((sum, o) => (hasRetention(picksOf(o), rateId) ? sum + (o.line.baseCents ?? 0) : sum), 0);
  // Si el concepto está en TODAS las líneas incluidas es una retención de factura: se evalúa contra el subtotal y se cuenta una sola vez.
  const commonFor = (rateId: number) =>
    included.length >= 2 && included.every((o) => hasRetention(picksOf(o), rateId))
      ? { bases: included.map((o) => o.line.baseCents ?? 0), index: included.findIndex((o) => o.line.index === l.line.index) }
      : undefined;

  const save = () =>
    run(
      async () => {
        await purchasesService.saveLineClasses([
          {
            documentId: view.doc.id,
            lineIndex: l.line.index,
            pucCode: puc,
            concept1001: notApplicable ? "" : concept,
            retention: notApplicable || exemption ? [] : retention,
            saveRule: scope === "rule",
            supplierNit: view.doc.issuerNit,
            productKey: productKey(l.line),
            productLabel: lineLabel(l.line),
          },
        ]);
        onClose();
      },
      scope === "rule" ? "Línea confirmada y regla del producto guardada." : "Línea confirmada solo para esta factura (la regla del producto no cambió).",
    );

  const remove = () =>
    run(
      () =>
        purchasesService
          .deleteLineClass(view.doc.id, l.line.index)
          .then(onClose),
      "Se quitó la clasificación de la línea.",
    );

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
            <Button
              icon={<RotateCcw size={14} />}
              loading={busy}
              onClick={() => void remove()}
            >
              Quitar clasificación
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            Cerrar
          </Button>
          <Button
            variant="primary"
            icon={<Check size={14} />}
            loading={busy}
            disabled={!puc || (!notApplicable && !concept)}
            onClick={() => void save()}
          >
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
              onConfirm={choosePuc}
              onCancel={puc ? () => setPickingPuc(false) : undefined}
            />
          ) : (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span>
                {puc} —{" "}
                {leafConcept(data.fs.index, puc) ??
                  (notApplicable ? NOT_APPLICABLE_LABEL : "")}
              </span>
              <Button size="sm" onClick={() => setPickingPuc(true)}>
                Cambiar
              </Button>
              {!l.confirmed &&
                l.proposal.sources.puc &&
                puc === l.proposal.pucCode && (
                  <span className="field__hint">
                    {PROPOSAL_SOURCE_LABEL[l.proposal.sources.puc]}
                  </span>
                )}
            </div>
          )}
          {!notApplicable && (
            <div>
              <Button size="sm" onClick={() => choosePuc(NOT_APPLICABLE_PUC)}>
                Marcar {NOT_APPLICABLE_PUC} — {NOT_APPLICABLE_LABEL}
              </Button>
            </div>
          )}
        </section>

        {notApplicable ? (
          <div
            role="status"
            className="field__hint"
            style={{ fontWeight: 600 }}
            data-testid="not-applicable-message"
          >
            {NOT_APPLICABLE_MESSAGE}
          </div>
        ) : (
          <>
            <section className="stack" style={{ gap: 6 }}>
              <strong>Concepto 1001{year ? ` (${year})` : ""}</strong>
              <ConceptCombobox
                value={concept}
                concepts={concepts}
                onChange={(code) => setConcept(code)}
                onCreate={async (code, description) => {
                  if (year === null)
                    throw new Error(
                      "La factura no tiene fecha: no hay un año para el concepto.",
                    );
                  await purchasesService.saveYearConcept({
                    formatCode: "1001",
                    year,
                    code,
                    description,
                    validFrom: `${year}-01-01`,
                    validTo: "",
                    isActive: true,
                  });
                  await data.reloadConcepts();
                  setConcept(code);
                }}
              />
              {pucConceptSuggestion && !concept && (
                <div className="field__hint">
                  Concepto 1001 sugerido por la cuenta:{" "}
                  {pucConceptSuggestion.code}
                </div>
              )}
              {!l.confirmed &&
                concept &&
                l.proposal.sources.concept &&
                concept === l.proposal.concept1001 && (
                  <div className="field__hint">
                    {PROPOSAL_SOURCE_LABEL[l.proposal.sources.concept]}
                  </div>
                )}
            </section>

            <RegimeInline data={data} view={view} />

            <RetentionSection
              view={view}
              rates={data.rates}
              versions={data.rateVersions}
              uvts={data.uvts}
              picks={retention}
              onChange={setRetention}
              suggested={suggested}
              origin={!l.confirmed && l.proposal.sources.retention && suggested.length > 0 ? proposalSourceText(l.proposal.sources.retention, l.proposal.retentionFrom) : undefined}
              preview={(rate) =>
                previewRetention(
                  rate,
                  data.rateVersions,
                  view.doc.issueDate,
                  data.uvts,
                  l.line.baseCents ?? 0,
                  conceptBase(rate.id),
                  commonFor(rate.id),
                )
              }
            />
          </>
        )}

        <section className="stack" style={{ gap: 6 }}>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="radio"
              checked={scope === "rule"}
              onChange={() => setScope("rule")}
            />
            Guardar como regla de este producto para este proveedor
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="radio"
              checked={scope === "invoice"}
              onChange={() => setScope("invoice")}
            />
            Cambiar solo esta factura (no toca la regla)
          </label>
        </section>
      </div>
    </Modal>
  );
}
