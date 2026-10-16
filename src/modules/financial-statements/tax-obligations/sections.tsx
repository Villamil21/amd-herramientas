import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Eye, FileUp } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, EmptyState } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import type { ExoRecord } from "../../../types/exogena";
import { formatIsoDate, formatAccountingCents, formatExactCents } from "../shared/money";
import { StatusBadge } from "./components";
import type { TaxPeriodCell } from "./services/coverage";
import { anomalies, fiscalResult, periodName, type TaxEffect, type TaxIssue, type TaxStatus } from "./services/effects";
import { taxReconciliation } from "./services/reconcile";
import { returnView, versionsOf, type ReturnView } from "./services/view";
import { PERIODICITY_LABEL, TAX_LABEL, type TaxReturn, type TaxType, type VatPeriodicity } from "./types";

const EXOGENA = "informacion-exogena";

// ---------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------

/** Un periodo de la cobertura: declarado (con su estado de pago), sin obligación, faltante o por terminar. */
export function CoverageGrid({ cells, cut, vatPeriodicity, onOpen, onEmpty, onVoid }: { cells: TaxPeriodCell[]; cut: string; vatPeriodicity: VatPeriodicity | null; onOpen: (r: TaxReturn) => void; onEmpty: (c: TaxPeriodCell) => void; onVoid: (c: TaxPeriodCell) => void }) {
  return (
    <ol className="tax-coverage">
      {cells.map((c) => {
        const current = c.returns[0];
        const status: TaxStatus | null = current ? returnView(current, cut, vatPeriodicity, []).status : null;
        return (
          <li key={`${c.year}-${c.period}`} className={`tax-coverage__cell is-${c.state}${status ? ` is-s-${status}` : ""}`}>
            <span className="tax-coverage__label">{c.label}</span>
            {current ? (
              <button type="button" className="link-button" onClick={() => onOpen(current)} title="Ver el detalle de la declaración">
                <StatusBadge status={status!} />
                {c.history.length > 0 && <span className="tax-coverage__note">Corrección · {c.history.length + 1} versiones</span>}
              </button>
            ) : c.state === "empty" ? (
              <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                <Badge tone="success">Sin obligación</Badge>
                <Button size="sm" variant="ghost" onClick={() => onVoid(c)} title="Anular registro">
                  Anular
                </Button>
              </span>
            ) : c.state === "upcoming" ? (
              <span className="muted">Aún no termina</span>
            ) : (
              <button type="button" className="link-button tax-coverage__missing" onClick={() => onEmpty(c)} title="Registrar este periodo sin obligación">
                <Badge tone="danger">Falta</Badge>
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Tabla de declaraciones
// ---------------------------------------------------------------------------

const money = (cents: number) => formatExactCents(cents);

/** Cabecera y celdas propias de cada impuesto; el resto de la tabla es común. */
function headers(taxType: TaxType): string[] {
  if (taxType === "withholding") return ["Periodo", "Formulario", "Total declarado", "Pagado", "Saldo al corte", "Estado"];
  if (taxType === "vat") return ["Periodo", "Formulario", "Resultado de la declaración", "Pagado", "Saldo al corte", "Estado"];
  return ["Año gravable", "Formulario", "Resultado tributario", "Liquidación", "Pagos", "Saldo al corte", "Estado"];
}

function VatResult({ v }: { v: ReturnView }) {
  if (v.payableCents > 0) return <>{<span>IVA por pagar <strong>{money(v.payableCents)}</strong></span>}</>;
  if (v.favorCents > 0) return <span>Saldo a favor <strong>{money(v.favorCents)}</strong></span>;
  return <span className="muted">Sin saldo</span>;
}

function IncomeResult({ r }: { r: TaxReturn }) {
  const result = fiscalResult(r);
  return (
    <span className={result < 0 ? "amount--negative" : undefined}>
      {(r.incomeLossCents ?? 0) > 0 ? "Pérdida líquida " : "Renta líquida "}
      <strong>{formatAccountingCents(Math.abs(result))}</strong>
    </span>
  );
}

function IncomeSettlement({ v }: { v: ReturnView }) {
  const lines: string[] = [];
  if (v.payableCents > 0) lines.push(`Por pagar ${money(v.payableCents)}`);
  if (v.favorCents > 0) lines.push(`Saldo a favor ${money(v.favorCents)}`);
  if ((v.r.advanceNextCents ?? 0) > 0) lines.push(`Anticipo ${v.r.advanceTargetYear ?? ""} ${money(v.r.advanceNextCents!)}`);
  if (!lines.length) return <span className="muted">—</span>;
  return (
    <>
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </>
  );
}

function BalanceCell({ v }: { v: ReturnView }) {
  if (v.balanceKind === "none") return <span className="muted">—</span>;
  if (!v.due && v.balanceKind === "payable") return <span className="muted">Posterior al corte</span>;
  return <span className={v.balanceKind === "payable" && v.balanceCents > 0 ? "amount--negative" : undefined}>{money(v.balanceCents)}</span>;
}

export function ReturnsTable({ taxType, returns, all, cut, vatPeriodicity, effects, onOpen }: { taxType: TaxType; returns: TaxReturn[]; all: TaxReturn[]; cut: string; vatPeriodicity: VatPeriodicity | null; effects: TaxEffect[]; onOpen: (r: TaxReturn) => void }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const cols = headers(taxType);
  const toggle = (id: number) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));
  return (
    <div className="table-wrap table-wrap--scroll">
      <table className="table">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={c} className={i >= 2 && c !== "Estado" && c !== "Resultado de la declaración" && c !== "Resultado tributario" && c !== "Liquidación" ? "num" : undefined}>
                {c}
              </th>
            ))}
            <th className="actions" />
          </tr>
        </thead>
        <tbody>
          {returns.map((r) => {
            const v = returnView(r, cut, vatPeriodicity, effects);
            const versions = r.supersededBy === null ? versionsOf(r, all).filter((x) => x.id !== r.id) : [];
            const expanded = open.has(r.id);
            const rows = [v, ...(expanded ? versions.map((x) => returnView(x, cut, vatPeriodicity, effects)) : [])];
            return (
              <Fragment key={r.id}>
                {rows.map((row, i) => (
                  <ReturnRow key={row.r.id} v={row} taxType={taxType} vatPeriodicity={vatPeriodicity} old={i > 0} versions={i === 0 ? versions.length : 0} expanded={expanded} onToggle={() => toggle(r.id)} onOpen={onOpen} />
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReturnRow({ v, taxType, vatPeriodicity, old, versions, expanded, onToggle, onOpen }: { v: ReturnView; taxType: TaxType; vatPeriodicity: VatPeriodicity | null; old: boolean; versions: number; expanded: boolean; onToggle: () => void; onOpen: (r: TaxReturn) => void }) {
  const r = v.r;
  const review = v.status === "review";
  return (
    <tr className={["is-clickable", old || v.status === "superseded" ? "muted tax-row--old" : "", review ? "row-attention--blocking" : ""].filter(Boolean).join(" ")} onClick={() => onOpen(r)}>
      <td className="nowrap">
        {old && <span aria-hidden> ↳ </span>}
        {periodName(r)}
        {taxType === "vat" && !old && <div className="table__secondary">{PERIODICITY_LABEL[r.periodicity]}</div>}
      </td>
      <td className="mono">
        {r.formNumber || "—"}
        {r.isCorrection && <div className="table__secondary">Corrección{r.previousFormNumber ? ` de ${r.previousFormNumber}` : ""}</div>}
        {versions > 0 && (
          <div onClick={(e) => e.stopPropagation()}>
            <button type="button" className="link-button" onClick={onToggle} aria-expanded={expanded}>
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {versions === 1 ? "1 versión anterior" : `${versions} versiones anteriores`}
            </button>
          </div>
        )}
      </td>
      {taxType === "withholding" && (
        <>
          <td className="num">{money(v.payableCents)}</td>
          <td className="num">{v.payableCents > 0 ? money(v.paidCents) : "—"}</td>
          <td className="num">{old ? <span className="muted">—</span> : <BalanceCell v={v} />}</td>
        </>
      )}
      {taxType === "vat" && (
        <>
          <td className="nowrap">
            <VatResult v={v} />
          </td>
          <td className="num">{v.payableCents > 0 ? money(v.paidCents) : "—"}</td>
          <td className="num">{old ? <span className="muted">—</span> : <BalanceCell v={v} />}</td>
        </>
      )}
      {taxType === "income" && (
        <>
          <td>
            <IncomeResult r={r} />
          </td>
          <td>
            <IncomeSettlement v={v} />
          </td>
          <td className="num">{v.payableCents > 0 ? money(v.paidCents) : "—"}</td>
          <td className="num">{old ? <span className="muted">—</span> : <BalanceCell v={v} />}</td>
        </>
      )}
      <td>
        <StatusBadge status={v.status} />
        {review && <div className="table__secondary">{anomalies(r, vatPeriodicity)[0]}</div>}
        {v.status !== "superseded" && v.payableCents > 0 && r.payments.length > 0 && <div className="table__secondary">{r.payments.length === 1 ? `1 pago · ${formatIsoDate(r.payments[0].paymentDate)}` : `${r.payments.length} pagos · último ${formatIsoDate(r.payments[r.payments.length - 1].paymentDate)}`}</div>}
      </td>
      <td className="actions" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" icon={<Eye size={14} />} onClick={() => onOpen(r)}>
          Ver
        </Button>
      </td>
    </tr>
  );
}

export function EmptyReturns({ taxType, company }: { taxType: TaxType; company: string }) {
  return <EmptyState icon={<FileUp size={20} />} title={`Sin declaraciones de ${TAX_LABEL[taxType]}`} description={`No hay declaraciones importadas para ${company}.`} />;
}

// ---------------------------------------------------------------------------
// Conciliación y reportes
// ---------------------------------------------------------------------------

const KIND_TARGET: Partial<Record<TaxEffect["kind"], "1009" | "1008">> = { withholding_payable: "1009", vat_payable: "1009", income_payable: "1009", sanction_payable: "1009", vat_favor: "1008", income_favor: "1008", excess_favor: "1008" };

export function ReconciliationTab({ taxType, companyId, cut, effects, issues, onConfigurePuc, onReviewExcess }: { taxType: TaxType; companyId: number; cut: string; effects: TaxEffect[]; issues: TaxIssue[]; onConfigurePuc?: () => void; onReviewExcess?: () => void }) {
  const year = Number(cut.slice(0, 4));
  const yearEnd = /-12-31$/.test(cut);
  const [saved, setSaved] = useState<{ r1009: ExoRecord[]; r1008: ExoRecord[] } | null>(null);
  useEffect(() => {
    let live = true;
    setSaved(null);
    if (!yearEnd) return;
    void Promise.all([exogenaService.records(companyId, year, "1009"), exogenaService.records(companyId, year, "1008")]).then(
      ([r1009, r1008]) => live && setSaved({ r1009, r1008 }),
      () => live && setSaved({ r1009: [], r1008: [] }),
    );
    return () => {
      live = false;
    };
  }, [companyId, year, yearEnd]);

  const ownEffects = effects.filter((e) => e.taxType === taxType);
  const recon = taxReconciliation(effects, yearEnd ? (saved?.r1009 ?? null) : null, yearEnd ? (saved?.r1008 ?? null) : null, cut, taxType);
  const proposals = ownEffects.filter((e) => e.trace && KIND_TARGET[e.kind]);

  return (
    <div className="tax-recon">
      <Card flush title="Estados Financieros" description={`Lo que el Generador incluye de ${TAX_LABEL[taxType]} al ${formatIsoDate(cut)}. Se calcula siempre desde las declaraciones y sus pagos.`}>
        {issues.length > 0 && (
          <div style={{ padding: "var(--space-3) var(--space-5)" }}>
            <div className="table-wrap">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Pendiente</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i, n) => (
                    <tr key={n}>
                      <td>
                        <Badge tone={i.level === "blocking" ? "danger" : "warning"}>{i.level === "blocking" ? "Bloquea" : "Aviso"}</Badge>
                      </td>
                      <td>
                        {i.message}{" "}
                        {i.code === "puc_missing" && onConfigurePuc && (
                          <button type="button" className="link-button" onClick={onConfigurePuc}>
                            Configurar PUC
                          </button>
                        )}
                        {i.code === "excess_review" && onReviewExcess && (
                          <button type="button" className="link-button" onClick={onReviewExcess}>
                            Revisar excedentes
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {ownEffects.length === 0 ? (
          <p className="muted" style={{ padding: "var(--space-3) var(--space-5)", margin: 0 }}>
            Ningún valor de {TAX_LABEL[taxType]} a esta fecha de corte.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Código PUC</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {ownEffects.map((e, n) => (
                  <tr key={n}>
                    <td>{e.label}</td>
                    <td className="mono">
                      {e.pucCode ?? (
                        <>
                          <Badge tone="danger">Pendiente de clasificar</Badge>{" "}
                          {onConfigurePuc && (
                            <button type="button" className="link-button" onClick={onConfigurePuc}>
                              Configurar
                            </button>
                          )}
                        </>
                      )}
                      {e.noncurrent && <div className="table__secondary">No corriente</div>}
                    </td>
                    <td className={e.cents < 0 ? "num amount--negative" : "num"}>{money(e.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {taxType === "income" && <p className="field__hint" style={{ padding: "0 var(--space-5) var(--space-3)", margin: 0 }}>El patrimonio declarado es informativo: nunca se envía al ESF. El anticipo es un activo temporal del año siguiente y nunca se propone al 1008.</p>}
      </Card>

      <Card flush title="Información Exógena" description="Se concilia al 31 de diciembre: por pagar a la DIAN → 1009; saldo a favor de IVA y Renta → 1008. Las correcciones manuales en Exógena no cambian la declaración.">
        {!yearEnd ? (
          <p className="muted" style={{ padding: "var(--space-3) var(--space-5)", margin: 0 }}>
            Cambia la fecha de corte a 31/12/{year} para conciliar con el 1009 y el 1008.
          </p>
        ) : (
          <>
            {recon.rows.length === 0 ? (
              <p className="muted" style={{ padding: "var(--space-3) var(--space-5)", margin: 0 }}>
                {saved ? "Ningún valor de este impuesto se propone a Exógena a esta fecha." : "Cargando registros de Exógena…"}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table table--dense">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Formato</th>
                      <th className="num">EEFF</th>
                      <th className="num">Exógena</th>
                      <th className="num">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recon.rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td className="mono">{row.format}</td>
                        <td className="num">{money(row.eeffCents)}</td>
                        <td className="num">{row.exogenaCents === null ? <span className="muted">Sin sincronizar</span> : money(row.exogenaCents)}</td>
                        <td className="num">{row.differenceCents === null ? "—" : row.differenceCents === 0 ? <Badge tone="success">$0</Badge> : <span className="amount--negative">{money(row.differenceCents)}</span>}</td>
                      </tr>
                    ))}
                    <tr className="fs-row--subtotal">
                      <td colSpan={2}>
                        <strong>Total</strong>
                      </td>
                      <td className="num">{money(recon.eeffCents)}</td>
                      <td className="num">{recon.exogenaCents === null ? "—" : money(recon.exogenaCents)}</td>
                      <td className="num">{recon.differenceCents === null ? "—" : recon.differenceCents === 0 ? <Badge tone="success">$0 · listo</Badge> : <Badge tone="danger">{money(recon.differenceCents)}</Badge>}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {proposals.length > 0 && (
              <div style={{ padding: "var(--space-3) var(--space-5) 0" }}>
                <strong>Propuestas hacia Exógena</strong>
                <div className="table-wrap">
                  <table className="table table--dense">
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th>Formulario</th>
                        <th className="num">Valor declarado</th>
                        <th className="num">Pagos considerados</th>
                        <th>Corte</th>
                        <th className="num">Saldo resultante</th>
                        <th>Destino</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposals.map((e, n) => (
                        <tr key={`${e.trace!.returnId}-${e.kind}-${e.conceptKey ?? ""}-${n}`}>
                          <td>{e.trace!.periodLabel}</td>
                          <td className="mono">{e.trace!.formNumber || "—"}</td>
                          <td className="num">{money(e.trace!.declaredCents)}</td>
                          <td className="num">{money(e.trace!.paidCents)}</td>
                          <td>{formatIsoDate(e.trace!.cut)}</td>
                          <td className="num">{money(e.trace!.resultCents)}</td>
                          <td>{KIND_TARGET[e.kind]} · DIAN</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="row" style={{ padding: "var(--space-3) var(--space-5)", flexWrap: "wrap" }}>
              {recon.ready ? <Alert tone="success">Conciliado con Exógena: diferencia $0.</Alert> : saved && recon.rows.length > 0 && <Alert tone="warning">Sincroniza los formatos para dejar la diferencia en $0.</Alert>}
              <Button size="sm" onClick={() => navigate(paths.submodule(EXOGENA, "1009"))}>
                Abrir 1009
              </Button>
              <Button size="sm" onClick={() => navigate(paths.submodule(EXOGENA, "1008"))}>
                Abrir 1008
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
