import type { RateVersion, RetentionPick } from "../../../../types/purchases";
import type { UvtValue, WithholdingRate } from "../../../../types/models";
import { formatMoneyCents } from "../../../../utils/format";
import { exemptionMessage } from "../domain/history";
import type { RetentionPreview } from "../domain/lineDraft";
import type { DocView } from "../domain/model";
import { RetentionPicker } from "./RetentionPicker";

interface Props {
  view: DocView;
  rates: readonly WithholdingRate[];
  versions: readonly RateVersion[];
  uvts: readonly UvtValue[];
  picks: readonly RetentionPick[];
  onChange: (picks: RetentionPick[]) => void;
  suggested: readonly number[];
  preview: (rate: WithholdingRate) => RetentionPreview;
}

/**
 * Retenciones de una línea. Si el proveedor era O-15 (autorretenedor) u O-47 (régimen simple) en la fecha de la factura NO hay
 * selector, buscador ni opciones: solo el mensaje, y la línea se confirma sin retención. Si no, el selector desplegable.
 */
export function RetentionSection({ view, rates, versions, uvts, picks, onChange, suggested, preview }: Props) {
  const { exemption } = view;
  return (
    <section className="stack" style={{ gap: 6 }}>
      <strong>Retenciones</strong>
      {exemption ? (
        <>
          <div role="status" className="field__hint" style={{ fontWeight: 600 }} data-testid="exempt-message">
            {exemptionMessage(exemption)}
          </div>
          {view.retention.practicedCents > 0 && (
            <div className="field__hint">
              La factura informa {formatMoneyCents(view.retention.practicedCents)} de retención: decide en el detalle de la factura si se conserva o se elimina. Esta línea se confirma sin retención.
            </div>
          )}
        </>
      ) : (
        <>
          <RetentionPicker rates={rates} versions={versions} uvts={uvts} date={view.doc.issueDate} picks={picks} onChange={onChange} suggested={suggested} preview={preview} />
          {view.retention.mismatch && (
            <div className="field__hint">
              La factura informa {formatMoneyCents(view.retention.practicedCents)}; con los conceptos de la factura la tabla da {formatMoneyCents(view.retention.expectedCents)}.
            </div>
          )}
        </>
      )}
    </section>
  );
}
