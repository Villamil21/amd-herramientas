import { useState, type KeyboardEvent } from "react";
import { navigate, paths } from "../../../app/router";
import { Alert, Button, Modal } from "../../../components/ui";
import { formatExactCents, formatIsoDate, formatStatementPesos, roundThousands } from "../shared/money";
import { OPEN_RETURN_KEY } from "../tax-obligations/openReturn";
import { isActivationKey, missingMonthsText, type EstimatedIncomeTax } from "./estimatedTax";

const WITHHOLDING_PATH = paths.provider("estados-financieros", "obligaciones-tributarias", "retencion-en-la-fuente");

/** Abre el módulo de Retención en la fuente (opcionalmente directo en una declaración). */
function openWithholding(companyId: number | null, returnId?: number) {
  try {
    if (returnId !== undefined && companyId !== null) sessionStorage.setItem(OPEN_RETURN_KEY, JSON.stringify({ companyId, returnId }));
  } catch {
    // Sin almacenamiento solo se abre el módulo.
  }
  navigate(WITHHOLDING_PATH);
}

/**
 * Indicador informativo «Impuesto de renta estimado»: valor neto de autorretenciones de los Formularios 350. Toda la tarjeta
 * es un botón (clic, Enter y Espacio) que abre la discriminación. No genera movimientos ni va en el PDF.
 */
export function EstimatedTaxCard({ tax, companyId }: { tax: EstimatedIncomeTax; companyId: number | null }) {
  const [open, setOpen] = useState(false);
  const favor = tax.kind === "favor";
  const onKey = (e: KeyboardEvent) => {
    if (isActivationKey(e.key)) {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <div className="fs-tax fs-tax--button" role="button" tabIndex={0} aria-haspopup="dialog" data-testid="estimated-tax-card" onClick={() => setOpen(true)} onKeyDown={onKey}>
        <div className="stack stack--sm">
          <span>{favor ? "Saldo a favor estimado por autorretenciones" : "Impuesto de renta estimado neto"} (solo en la app, no va en el PDF)</span>
          <small className="muted">Incluye autorretenciones netas declaradas en Formularios 350 · Ver detalle</small>
          {tax.partial && <small className="fs-tax__warn">Estimado parcial{tax.missingMonths.length > 0 ? `: faltan declaraciones de retención de ${missingMonthsText(tax.missingMonths)}` : ""}</small>}
        </div>
        <strong>{formatStatementPesos(roundThousands(tax.displayCents))}</strong>
      </div>

      <Modal
        open={open}
        size="xl"
        onClose={() => setOpen(false)}
        title={favor ? "Saldo a favor estimado por autorretenciones" : "Impuesto de renta estimado neto"}
        description={`Año fiscal ${tax.cutYear}. Solo informativo: no genera movimientos, no modifica Estados Financieros aprobados y no va en el PDF.`}
        footer={<Button onClick={() => setOpen(false)}>Cerrar</Button>}
      >
        <EstimatedTaxDetail tax={tax} companyId={companyId} />
      </Modal>
    </>
  );
}

/** Discriminación completa del cálculo: resumen, Formularios 350 incluidos, meses faltantes y pendientes. */
export function EstimatedTaxDetail({ tax, companyId }: { tax: EstimatedIncomeTax; companyId: number | null }) {
  const favor = tax.kind === "favor";
  const pendingText = tax.undistributedCents > 0 ? `${formatExactCents(tax.undistributedCents)} de devoluciones por distribuir` : null;
  return (
  <div className="stack">
    {tax.partial && (
      <Alert tone="warning" title="Estimado parcial" items={[...(tax.missingMonths.length ? [`Faltan declaraciones de retención de ${missingMonthsText(tax.missingMonths)}.`] : []), ...(pendingText ? [`${pendingText} (casilla 129 sin clasificar): no se asignan a autorretenciones.`] : []), ...tax.noDetailReturns.map((f) => `${f.period}: el formulario no trae casillas leídas; su autorretención no se conoce.`)]}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Button size="sm" onClick={() => openWithholding(companyId)}>
            Ir a Retención en la fuente
          </Button>
        </div>
      </Alert>
    )}

    <div className="table-wrap">
      <table className="table" aria-label="Cálculo del impuesto de renta estimado">
        <thead>
          <tr>
            <th>Concepto</th>
            <th style={{ textAlign: "right" }}>Valor</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Utilidad base usada</td>
            <td className="num">{formatExactCents(tax.baseCents)}</td>
          </tr>
          <tr>
            <td>Tarifa estimada</td>
            <td className="num">{Math.round(tax.rate * 100)}%</td>
          </tr>
          <tr>
            <td>Impuesto de renta estimado bruto</td>
            <td className="num">{formatExactCents(tax.grossCents)}</td>
          </tr>
          <tr>
            <td>(−) Autorretenciones netas acumuladas</td>
            <td className="num">{formatExactCents(tax.selfWithholdingCents)}</td>
          </tr>
          <tr>
            <td>
              <strong>{favor ? "Saldo a favor estimado por autorretenciones" : "Impuesto de renta estimado neto"}</strong>
            </td>
            <td className="num">
              <strong>{formatExactCents(tax.displayCents)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3 className="fs-section-title">Formularios 350 incluidos ({tax.included.length})</h3>
    {tax.included.length === 0 ? (
      <p className="muted">No hay Formularios 350 vigentes de {tax.cutYear} con periodo terminado a la fecha de corte.</p>
    ) : (
      <div className="table-wrap">
        <table className="table" aria-label="Formularios 350 incluidos">
          <thead>
            <tr>
              <th>Período</th>
              <th>Formulario</th>
              <th>Presentación</th>
              <th style={{ textAlign: "right" }}>Autorretenciones brutas</th>
              <th style={{ textAlign: "right" }}>Devoluciones de autorretenciones</th>
              <th style={{ textAlign: "right" }}>Autorretenciones netas</th>
              <th style={{ textAlign: "right" }}>Devoluciones de otros conceptos (excluidas)</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tax.included.map((f) => (
              <tr key={f.returnId}>
                <td>{f.period}</td>
                <td>{f.formNumber || "—"}</td>
                <td>{f.presentedOn ? formatIsoDate(f.presentedOn) : "—"}</td>
                <td className="num">{f.noDetail ? "Sin detalle" : formatExactCents(f.grossCents)}</td>
                <td className="num">{formatExactCents(f.classifiedReturnsCents)}</td>
                <td className="num">
                  <strong>{formatExactCents(f.netCents)}</strong>
                </td>
                <td className="num">
                  {formatExactCents(f.otherConceptsCents)}
                  {f.undistributedCents > 0 && <div className="fs-tax__warn">Pendiente de distribuir: {formatExactCents(f.undistributedCents)}</div>}
                </td>
                <td>{f.statusLabel}</td>
                <td>
                  <Button size="sm" onClick={() => openWithholding(companyId, f.returnId)}>
                    Abrir declaración
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {tax.missingMonths.length > 0 && (
      <div>
        <h3 className="fs-section-title">Meses sin declaración 350</h3>
        <p>{missingMonthsText(tax.missingMonths)}</p>
      </div>
    )}
    {tax.undistributedCents > 0 && (
      <div>
        <h3 className="fs-section-title">Pendiente de distribuir</h3>
        <p>
          {formatExactCents(tax.undistributedCents)} de la casilla 129 (retenciones en exceso, indebidas o anuladas) sin clasificar por concepto. Distribúyelos en el Formulario 350; mientras tanto no reducen las autorretenciones.
        </p>
      </div>
    )}
    <p className="muted">No se suman anticipos de renta: aquí solo se restan las autorretenciones netas de los Formularios 350. La composición de «Renta por pagar» no cambia.</p>
  </div>
  );
}
