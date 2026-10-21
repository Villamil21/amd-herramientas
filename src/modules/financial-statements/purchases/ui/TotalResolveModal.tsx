import { useMemo, useState } from "react";
import { Ban, Check, RotateCcw } from "lucide-react";
import { Alert, Button, Field, Input, Modal } from "../../../../components/ui";
import { purchasesService } from "../../../../services/purchasesService";
import type { TotalChoice } from "../../../../types/purchases";
import { formatMoneyCents } from "../../../../utils/format";
import { lineLabel, type DocView } from "../domain/model";
import { parseCentsInput, totalCheck } from "../domain/totals";
import type { PurchasesData } from "../usePurchasesData";

interface Props {
  data: PurchasesData;
  view: DocView;
  run: (a: () => Promise<void>, ok?: string) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}

const CHOICE_DONE: Record<TotalChoice, string> = {
  gross: "Se usa el Total Bruto Factura: la diferencia queda ajustada y registrada.",
  lines: "Se usa la suma de las líneas: la decisión queda registrada.",
  exclude: "La factura quedó excluida y la decisión registrada.",
};

/**
 * Resolver diferencia: las líneas leídas no coinciden con el «Total Bruto Factura» del PDF. Muestra los valores, deja corregir las
 * líneas mal leídas (el PDF no se toca; el valor leído queda en la auditoría) y registra la decisión con quién, cuándo y por qué.
 */
export function TotalResolveModal({ data, view, run, busy, onClose }: Props) {
  const { doc } = view;
  const overrides = useMemo(() => new Map((data.state?.lineOverrides ?? []).filter((o) => o.documentId === doc.id).map((o) => [o.lineIndex, o])), [data.state, doc.id]);
  const decision = data.state?.totalDecisions?.find((d) => d.documentId === doc.id);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const check = view.totalCheck;
  const folder = data.state?.uploads.find((u) => u.id === doc.uploadId)?.folderName;
  const sign = view.sign;

  if (!check || check.grossCents === undefined) return null;
  const gross = check.grossCents;
  const needsReason = reason.trim().length < 3;

  // Con las correcciones aún sin guardar: ¿cuánto sumarían las líneas?
  const draftSum = view.data.lines.reduce((s, l) => {
    const d = drafts[l.index];
    const v = d === undefined ? l.baseCents ?? 0 : parseCentsInput(d) ?? l.baseCents ?? 0;
    return s + v;
  }, 0);
  const dirty = Object.keys(drafts).length > 0;

  const decide = (choice: TotalChoice) =>
    run(async () => {
      await purchasesService.setTotalDecision(doc.id, choice, reason, check.linesCents, gross);
      onClose();
    }, CHOICE_DONE[choice]);

  const saveLines = () =>
    run(async () => {
      for (const [idx, text] of Object.entries(drafts)) {
        const cents = parseCentsInput(text);
        if (cents === undefined) throw new Error(`El importe «${text}» de la línea ${Number(idx) + 1} no es válido.`);
        await purchasesService.setLineOverride(doc.id, Number(idx), cents, reason);
      }
      setDrafts({});
    }, "Líneas corregidas. Se vuelve a comparar con el Total Bruto Factura.");

  const next = totalCheck({ linesCents: draftSum, grossCents: gross });

  return (
    <Modal open size="lg" title="Resolver diferencia" description={`Factura ${view.data.number ?? doc.fileName}`} onClose={onClose} locked={busy} footer={<Button onClick={onClose}>Cerrar</Button>}>
      <div className="stack">
        <Alert tone={check.status === "resolved" ? "info" : "warning"} title="Las líneas no coinciden con el Total Bruto Factura">
          <div>
            Suma de las líneas: <strong>{formatMoneyCents(check.linesCents * sign)}</strong> · Total Bruto Factura: <strong>{formatMoneyCents(gross * sign)}</strong> · Diferencia: <strong>{formatMoneyCents(check.differenceCents * sign)}</strong>
          </div>
          <div className="field__hint">
            PDF de origen: {doc.fileName}
            {folder ? ` (carpeta ${folder})` : ""}. Se compara siempre con «Total Bruto Factura» (la base después de descuentos), nunca con el Subtotal. El IVA no se modifica.
          </div>
          {check.legacy && <div className="field__hint">La factura ya estaba confirmada antes de esta regla: nada cambia sin tu decisión.</div>}
        </Alert>

        {decision && (
          <Alert tone="info" title={`Decisión vigente: ${decision.choice === "gross" ? "usar Total Bruto Factura" : decision.choice === "lines" ? "usar suma de líneas" : "excluir factura"}`}>
            {decision.decidedBy || "Usuario"} · {decision.decidedAt.slice(0, 16).replace("T", " ")} · «{decision.reason}»
            {check.status === "stale" && " · La factura cambió desde entonces, decide de nuevo."}
            <div>
              <Button size="sm" icon={<RotateCcw size={14} />} loading={busy} onClick={() => void run(() => purchasesService.deleteTotalDecision(doc.id), "Decisión retirada.")}>
                Retirar decisión
              </Button>
            </div>
          </Alert>
        )}

        <div className="table-wrap table-wrap--scroll">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Producto</th>
                <th className="num">Leído del PDF</th>
                <th className="num">Base usada</th>
              </tr>
            </thead>
            <tbody>
              {view.data.lines.map((l) => {
                const o = overrides.get(l.index);
                const original = o ? o.originalCents : l.baseCents;
                return (
                  <tr key={l.index}>
                    <td>{l.index + 1}</td>
                    <td>{lineLabel(l)}</td>
                    <td className="num">{original == null ? "ilegible" : formatMoneyCents(original)}</td>
                    <td className="num">
                      <Input
                        aria-label={`Base de la línea ${l.index + 1}`}
                        inputMode="decimal"
                        style={{ textAlign: "right", width: 140 }}
                        value={drafts[l.index] ?? (l.baseCents === undefined ? "" : (l.baseCents / 100).toFixed(2).replace(".", ","))}
                        onChange={(e) => setDrafts({ ...drafts, [l.index]: e.target.value })}
                      />
                      {o && (
                        <div className="field__hint">
                          Corregida
                          <Button size="sm" variant="ghost" onClick={() => void run(() => purchasesService.deleteLineOverride(doc.id, l.index), "Corrección retirada.")}>
                            Quitar
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {dirty && (
          <div className="field__hint">
            Con tus cambios las líneas sumarían {formatMoneyCents(draftSum * sign)}
            {next.status === "ok" || next.status === "rounding" ? " y coincidirían con el Total Bruto Factura." : ` (diferencia ${formatMoneyCents(next.differenceCents * sign)}).`}
          </div>
        )}

        <Field label="Razón (queda en la auditoría)" required>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: la línea 3 se leyó mal; verificado en el PDF" />}
        </Field>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {dirty && (
            <Button variant="primary" icon={<Check size={14} />} loading={busy} disabled={needsReason} onClick={() => void saveLines()}>
              Guardar líneas corregidas
            </Button>
          )}
          <Button icon={<Check size={14} />} loading={busy} disabled={needsReason || dirty} onClick={() => void decide("gross")}>
            Usar Total Bruto Factura
          </Button>
          <Button icon={<Check size={14} />} loading={busy} disabled={needsReason || dirty} onClick={() => void decide("lines")}>
            Usar suma de líneas
          </Button>
          <Button variant="danger" icon={<Ban size={14} />} loading={busy} disabled={needsReason || dirty} onClick={() => void decide("exclude")}>
            Excluir factura
          </Button>
        </div>
      </div>
    </Modal>
  );
}
