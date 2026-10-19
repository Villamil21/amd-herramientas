import { useEffect, useMemo, useState } from "react";
import { Ban, Check, RotateCcw } from "lucide-react";
import { Alert, Button, ConfirmDialog, Modal, useToast } from "../../../../components/ui";
import { purchasesService } from "../../../../services/purchasesService";
import { errorMessage } from "../../../../services/tauri";
import { formatMoneyCents } from "../../../../utils/format";
import { leafConcept } from "../../puc-codes/services/pucCatalog";
import { PROPOSAL_SOURCE_LABEL } from "../domain/classify";
import { lineLabel, type DocView, type LineView } from "../domain/model";
import type { PurchasesData } from "../usePurchasesData";
import { confirmProposalsLabel, proposableLines, PROPOSALS_INCLUDE, proposalInputs } from "../domain/lineDraft";
import { LineClassifyModal } from "./LineClassifyModal";
import { StatusChip } from "./StatusStrip";

interface Props {
  data: PurchasesData;
  view: DocView | null;
  /** Línea que se abre ya en edición (desde una alerta). */
  focusLine?: number | null;
  onClose: () => void;
}

/**
 * Detalle de una factura: encabezado, decisiones sobre el documento y clasificación línea por línea (PUC, concepto 1001 y
 * conceptos de retención). Toda propuesta se muestra «Por confirmar»: nada se aplica hasta que el usuario confirma.
 */
export function DocDetailModal({ data, view, focusLine, onClose }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [excludeAsk, setExcludeAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(focusLine ?? null);
  }, [view?.doc.id, focusLine]);

  const lines = view?.lines ?? [];
  const proposable = useMemo(() => proposableLines(lines), [lines]);

  if (!view) return null;
  const { doc, data: parsed } = view;

  async function run(action: () => Promise<void>, ok?: string) {
    setBusy(true);
    try {
      await action();
      await data.reloadState();
      await data.reloadRules();
      if (ok) toast(ok);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const confirmProposals = () =>
    run(
      () =>
        purchasesService.saveLineClasses(proposalInputs(doc.id, doc.issuerNit, lines)),
      `${proposable.length} ${proposable.length === 1 ? "línea confirmada" : "líneas confirmadas"} con PUC, concepto 1001 y retenciones, solo para esta factura.`,
    );

  const flag = (kind: "name_confirm" | "exclude") => run(() => purchasesService.setFlag(doc.id, kind, "1").then(() => purchasesService.audit(doc.buyerNit, doc.year, kind === "exclude" ? "Factura excluida" : "Nombre del adquiriente confirmado", { documentId: doc.id, number: parsed.number })));
  const unflag = (kind: "name_confirm" | "exclude") => run(() => purchasesService.deleteFlag(doc.id, kind));

  const flags = new Set(data.state?.flags.filter((f) => f.documentId === doc.id).map((f) => f.kind));
  const retentionDecision = data.state?.flags.find((f) => f.documentId === doc.id && f.kind === "retention_decision")?.value;

  return (
    <Modal
      open
      size="xl"
      title={`${parsed.title} ${parsed.number ?? ""}`.trim()}
      description={`${doc.issuerName} · NIT ${doc.issuerNit} · ${doc.issueDate ?? "sin fecha"} · ${view.kind === "return" ? "Devolución (resta)" : view.kind === "purchase" ? "Compra" : "Encabezado sin clasificar"} · ${doc.fileName}`}
      onClose={onClose}
      locked={busy || editing !== null}
      footer={<Button onClick={onClose}>Cerrar</Button>}
    >
      <div className="stack">
        {view.alerts
          .filter((a) => a.severity !== "info" && a.target.kind !== "line")
          .map((a) => (
            <Alert key={a.id} tone={a.severity === "block" ? "danger" : a.severity === "pending" ? "info" : "warning"} title={a.title}>
              <div>{a.why}</div>
              <div>
                <strong>Cómo resolverlo:</strong> {a.how}
              </div>
            </Alert>
          ))}

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span>
            Comprador: <strong>{doc.buyerName}</strong> ({doc.buyerNit}) · Subtotal <strong>{formatMoneyCents(view.baseCents * view.sign)}</strong> · IVA <strong>{formatMoneyCents(view.vatCents * view.sign)}</strong> · Retención informada <strong>{formatMoneyCents(parsed.retefuenteCents ?? 0)}</strong>
            {view.retention.invoiceLevelCents > 0 && (
              <>
                {" "}· Retención común de la factura <strong>{formatMoneyCents(view.retention.invoiceLevelCents)}</strong> (una sola vez)
              </>
            )}
          </span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {view.alerts.some((a) => a.code === "name-mismatch") && (
            <Button icon={<Check size={14} />} loading={busy} onClick={() => void flag("name_confirm")}>
              Confirmar que es de esta empresa
            </Button>
          )}
          {flags.has("name_confirm") && (
            <Button icon={<RotateCcw size={14} />} loading={busy} onClick={() => void unflag("name_confirm")}>
              Quitar confirmación del nombre
            </Button>
          )}
          {view.alerts.some((a) => a.code === "retention-exempt") && (
            <>
              <Button loading={busy} onClick={() => void run(() => purchasesService.setFlag(doc.id, "retention_decision", "keep"), "Se conserva la retención informada.")}>
                Conservar retención informada
              </Button>
              <Button loading={busy} onClick={() => void run(() => purchasesService.setFlag(doc.id, "retention_decision", "remove"), "La retención informada se elimina del cálculo.")}>
                Eliminar retención informada
              </Button>
            </>
          )}
          {retentionDecision && (
            <Button icon={<RotateCcw size={14} />} loading={busy} onClick={() => void unflag("name_confirm").then(() => run(() => purchasesService.deleteFlag(doc.id, "retention_decision")))}>
              Cambiar decisión de retención ({retentionDecision === "keep" ? "se conserva" : "se elimina"})
            </Button>
          )}
          {proposable.length > 0 && (
            <div className="stack" style={{ gap: 2 }}>
              <Button variant="primary" icon={<Check size={14} />} loading={busy} onClick={() => void confirmProposals()}>
                {confirmProposalsLabel(proposable.length)}
              </Button>
              <span className="field__hint">{PROPOSALS_INCLUDE}</span>
            </div>
          )}
          {flags.has("exclude") ? (
            <Button icon={<RotateCcw size={14} />} loading={busy} onClick={() => void unflag("exclude")}>
              Restaurar factura
            </Button>
          ) : (
            <Button variant="danger" icon={<Ban size={14} />} onClick={() => setExcludeAsk(true)}>
              Excluir factura
            </Button>
          )}
        </div>

        <div className="table-wrap table-wrap--scroll">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Producto</th>
                <th className="num">Base</th>
                <th className="num">IVA</th>
                <th>PUC</th>
                <th>Concepto 1001</th>
                <th>Retención</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <LineRows key={l.line.index} data={data} view={view} l={l} editing={editing === l.line.index} onEdit={(on) => setEditing(on ? l.line.index : null)} run={run} busy={busy} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ConfirmDialog
        open={excludeAsk}
        title="Excluir factura"
        message={`La factura ${parsed.number ?? doc.fileName} dejará de sumar en Estados Financieros y en los formatos 1001, 1005 y 1006. Queda registrada y se puede restaurar.`}
        confirmLabel="Excluir"
        onCancel={() => setExcludeAsk(false)}
        onConfirm={() => {
          setExcludeAsk(false);
          void flag("exclude");
        }}
      />
    </Modal>
  );
}

function LineRows({ data, view, l, editing, onEdit, run, busy }: { data: PurchasesData; view: DocView; l: LineView; editing: boolean; onEdit: (on: boolean) => void; run: (a: () => Promise<void>, ok?: string) => Promise<void>; busy: boolean }) {
  const proposal = l.proposal;
  const shownPuc = l.confirmed ? l.pucCode : proposal.pucCode;
  const shownConcept = l.confirmed ? l.concept1001 : proposal.concept1001;
  const shownRetention = l.confirmed ? l.retention : proposal.retention;
  const rateName = (id: number) => data.rates.find((r) => r.id === id);
  const problems = [l.pucProblem, l.conceptProblem].filter(Boolean) as string[];
  const status = l.line.issue ? "block" : problems.length ? "block" : l.notApplicable ? "na" : l.confirmed ? "ready" : "pending";
  return (
    <>
      <tr>
        <td>{l.line.index + 1}</td>
        <td>
          {lineLabel(l.line)}
          {l.line.issue && <div className="field__error">No se pudo leer: {l.line.issue}</div>}
        </td>
        <td className="num">{l.line.baseCents === undefined ? "—" : formatMoneyCents(l.notApplicable ? l.excludedBaseCents : l.baseCents)}</td>
        <td className="num">{l.line.vatCents === undefined ? "—" : formatMoneyCents(l.notApplicable ? l.excludedVatCents : l.vatCents)}</td>
        <td>
          {shownPuc ? `${shownPuc} — ${leafConcept(data.fs.index, shownPuc) ?? ""}` : "—"}
          {!l.confirmed && shownPuc && proposal.sources.puc && <div className="field__hint">{PROPOSAL_SOURCE_LABEL[proposal.sources.puc]}</div>}
        </td>
        <td>
          {shownConcept || "—"}
          {!l.confirmed && shownConcept && proposal.sources.concept && <div className="field__hint">{PROPOSAL_SOURCE_LABEL[proposal.sources.concept]}</div>}
        </td>
        <td>
          {shownRetention.length ? shownRetention.map((r) => rateName(r.rateId)?.name ?? `#${r.rateId}`).join(", ") : "—"}
          {l.commonRetentionRateIds.length > 0 && <div className="field__hint">Participa en la retención común de la factura</div>}
        </td>
        <td>
          <StatusChip status={status} label={l.line.issue ? "Bloquea · ilegible" : problems.length ? "Bloquea · dato inválido" : l.notApplicable ? "No aplica" : l.confirmed ? "Confirmada" : "Por confirmar"} />
          {l.notApplicable && <div className="field__hint">Excluida: importe informativo, no se envía a EEFF ni a Exógena.</div>}
          {l.confirmed && l.class && <div className="field__hint">{l.class.scope === "rule" ? "Regla del producto" : "Solo esta factura"}</div>}
        </td>
        <td>
          <Button size="sm" onClick={() => onEdit(true)} disabled={Boolean(l.line.issue)}>
            {l.confirmed ? "Cambiar" : "Clasificar"}
          </Button>
        </td>
      </tr>
      {problems.length > 0 && (
        <tr>
          <td />
          <td colSpan={8}>
            <Alert tone="danger">{problems.join(" ")}</Alert>
          </td>
        </tr>
      )}
      {editing && <LineClassifyModal data={data} view={view} l={l} run={run} busy={busy} onClose={() => onEdit(false)} />}
    </>
  );
}
