import { useState } from "react";
import { navigate } from "../../../../../app/router";
import { Button, Card, useToast } from "../../../../../components/ui";
import { fsService } from "../../../../../services/fsService";
import { errorMessage } from "../../../../../services/tauri";
import { SEVERITY_LABEL } from "../../../purchases/domain/status";
import { StatusChip, statusCount } from "../../../purchases/ui/StatusStrip";
import { BANK_EXO_DEST_LABEL, BANK_EXO_FORMATS, type BankExoAlert, type BankExoFormat, type BankExoResult } from "../model";

const CHIP = { block: "state-chip--block", pending: "state-chip--pending", review: "state-chip--review", info: "state-chip--na" } as const;

interface RowProps {
  alert: BankExoAlert;
  companyId: number;
  year: number;
  onChanged: () => void | Promise<unknown>;
}

/** Un pendiente: qué pasa, cómo resolverlo, a dónde ir y, si es revisable, incluir o excluir con la decisión guardada. */
export function BankExoAlertRow({ alert, companyId, year, onChanged }: RowProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(decision: "include" | "exclude") {
    if (!alert.review) return;
    setBusy(decision);
    try {
      await fsService.saveBankExoReview(companyId, year, alert.review.key, decision);
      toast(decision === "include" ? "Incluido en el formato; la decisión quedó registrada." : "Excluido del formato; la decisión quedó registrada.");
      await onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="alert-row">
      <span className={`state-chip ${CHIP[alert.severity]}`}>{SEVERITY_LABEL[alert.severity]}</span>
      <div>
        <div className="alert-row__title">{alert.title}</div>
        <div className="alert-row__text">
          <strong>Qué pasa: </strong>
          {alert.why}
        </div>
        <div className="alert-row__text">
          <strong>Cómo resolverlo: </strong>
          {alert.how}
        </div>
        <div className="alert-row__dests">
          {alert.dests.map((d) => (
            <span key={d} className="state-chip state-chip--na">
              {BANK_EXO_DEST_LABEL[d]}
            </span>
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {alert.review && (
          <>
            <Button size="sm" variant="primary" loading={busy === "include"} disabled={busy !== null} onClick={() => void decide("include")}>
              {alert.review.includeLabel}
            </Button>
            <Button size="sm" loading={busy === "exclude"} disabled={busy !== null} onClick={() => void decide("exclude")}>
              {alert.review.excludeLabel}
            </Button>
          </>
        )}
        {alert.actions.map((a) => (
          <Button key={a.path + a.label} size="sm" onClick={() => navigate(a.path)}>
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  result: BankExoResult;
  companyId: number;
  onChanged: () => void | Promise<unknown>;
  /** Formatos que se muestran (por defecto los tres). */
  formats?: BankExoFormat[];
  title?: string;
}

/**
 * Estado unificado de Extractos bancarios para Exógena: por formato (1012, 1007 y 1011) su estado con icono, texto y cantidad, y
 * las alertas que explican qué falta y llevan al banco, extracto o ficha exacta que lo resuelve. El de un formato no detiene a los demás.
 */
export function BankExoStatusCard({ result, companyId, onChanged, formats = BANK_EXO_FORMATS, title = "Estado de Extractos bancarios para Exógena" }: Props) {
  const [dest, setDest] = useState<BankExoFormat | null>(null);
  const alerts = result.alerts.filter((a) => formats.some((f) => a.dests.includes(f)));
  const shown = dest ? alerts.filter((a) => a.dests.includes(dest)) : alerts;
  return (
    <div className="stack">
      <div className="state-strip" role="group" aria-label={title}>
        {formats.map((f) => (
          <button key={f} type="button" className="state-strip__item state-strip__item--action" aria-pressed={dest === f} onClick={() => setDest(dest === f ? null : f)}>
            <span className="state-strip__dest">{BANK_EXO_DEST_LABEL[f]}</span>
            <StatusChip status={result.status[f]} count={statusCount(result.status[f], result.counts[f])} dest={BANK_EXO_DEST_LABEL[f]} />
            <span className="state-strip__detail">{result.status[f] === "ready" ? "Sin pendientes." : `${result.counts[f].block} bloquean · ${result.counts[f].pending} por confirmar · ${result.counts[f].review} por revisar`}</span>
            <span className="state-strip__cta">{dest === f ? "Ver todos" : "Ver pendientes"} →</span>
          </button>
        ))}
      </div>
      <Card title={dest ? `Pendientes de ${BANK_EXO_DEST_LABEL[dest]}` : "Pendientes de extractos bancarios"} description={shown.length === 0 ? "Sin pendientes." : `${shown.length} ${shown.length === 1 ? "alerta" : "alertas"}.`}>
        {shown.slice(0, 100).map((a) => (
          <BankExoAlertRow key={a.id} alert={a} companyId={companyId} year={result.year} onChanged={onChanged} />
        ))}
        {shown.length > 100 && <span className="muted">Se muestran las primeras 100 de {shown.length}.</span>}
      </Card>
    </div>
  );
}
