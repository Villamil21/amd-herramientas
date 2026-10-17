import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Alert, Button, Modal } from "../../../../components/ui";
import { buildPendingReport, progressText, type PendingGroup, type PendingReport } from "../domain/pending";
import type { PurchasesModel } from "../domain/model";
import { DEST_LABEL, SEVERITY_LABEL, STATUS_LABEL, type Alert as AlertItem, type Dest, type Severity } from "../domain/status";
import { StatusChip } from "./StatusStrip";

/** Lo que el panel recuerda mientras se edita algo fuera de él: grupos abiertos y posición. */
export interface PanelMemo {
  expanded: string[];
  scroll: number;
}

const SEVERITY_STATUS: Record<Exclude<Severity, "info">, "block" | "pending" | "review"> = { block: "block", pending: "pending", review: "review" };

function GroupCard({ group, dest, open, onToggle, onResolve }: { group: PendingGroup; dest: Dest; open: boolean; onToggle: () => void; onResolve: (a: AlertItem) => void }) {
  const first = group.items[0];
  const many = group.items.length > 1;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="pending-group" aria-label={group.cause} data-group={group.code}>
      <div className="pending-group__head">
        <StatusChip status={SEVERITY_STATUS[group.severity as Exclude<Severity, "info">]} label={`${SEVERITY_LABEL[group.severity]} · ${group.items.length}`} dest={dest} />
        <div>
          <div className="pending-group__title">{group.cause}</div>
          <div className="pending-group__text">
            <strong>Afecta: </strong>
            {group.scope}
          </div>
          <div className="pending-group__text">
            <strong>Efecto en {DEST_LABEL[dest]}: </strong>
            {group.effect}
          </div>
          <div className="pending-group__text">
            <strong>Cómo resolverlo: </strong>
            {group.how}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {many && (
            <Button size="sm" icon={<Chevron size={14} />} aria-expanded={open} onClick={onToggle}>
              {open ? "Ocultar" : `Ver ${group.items.length}`}
            </Button>
          )}
          {first.target.kind !== "none" && (
            <Button size="sm" variant="primary" onClick={() => onResolve(first)}>
              {many ? `${group.action}: la primera` : group.action}
            </Button>
          )}
        </div>
      </div>
      {many && open && (
        <div className="pending-group__items">
          {group.items.map((a) => (
            <div key={a.id} className="pending-group__item">
              <span>{a.title}</span>
              {a.target.kind !== "none" && (
                <Button size="sm" aria-label={`${a.action ?? "Resolver"}: ${a.title}`} onClick={() => onResolve(a)}>
                  {a.action ?? "Resolver"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Contenido del panel (sin el modal): resumen, avance y grupos por causa, o el estado vacío / «No aplica». */
export function PendingPanelBody({ report, memo, onResolve }: { report: PendingReport; memo: MutableRefObject<PanelMemo>; onResolve: (a: AlertItem) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(memo.current.expanded));
  const root = useRef<HTMLDivElement>(null);
  const { dest, summary, progress } = report;

  // Restaura la posición al volver de editar una factura, un proveedor o un encabezado.
  useEffect(() => {
    const scroller = root.current?.closest<HTMLElement>(".modal__body");
    if (!scroller) return;
    scroller.scrollTop = memo.current.scroll;
    const onScroll = () => {
      memo.current.scroll = scroller.scrollTop;
    };
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [memo]);

  const toggle = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      memo.current.expanded = [...n];
      return n;
    });

  if (report.notApplicable)
    return (
      <div ref={root} className="stack">
        <StatusChip status="na" label={STATUS_LABEL.na} dest={dest} />
        <Alert tone="info" title={`${DEST_LABEL[dest]} no aplica`}>
          {report.notApplicable}
        </Alert>
      </div>
    );

  return (
    <div ref={root}>
      <div className="pending-summary" aria-label="Resumen de pendientes">
        <StatusChip status="block" label={`${summary.block} ${summary.block === 1 ? "bloquea" : "bloquean"}`} />
        <StatusChip status="pending" label={`${summary.pending} por confirmar`} />
        <StatusChip status="review" label={`${summary.review} por revisar`} />
        {progress && (
          <div className="pending-progress">
            <span>{progressText(progress)}</span>
            <progress max={progress.total} value={progress.resolved} aria-label={progressText(progress)} />
          </div>
        )}
      </div>
      {report.groups.length === 0 ? (
        <Alert tone="success" title="Sin pendientes">
          {DEST_LABEL[dest]} no tiene nada por resolver para esta empresa y año.
        </Alert>
      ) : (
        report.groups.map((g) => <GroupCard key={g.key} group={g} dest={dest} open={expanded.has(g.key)} onToggle={() => toggle(g.key)} onResolve={onResolve} />)
      )}
    </div>
  );
}

interface Props {
  model: PurchasesModel;
  dest: Dest;
  companyName: string;
  memo: MutableRefObject<PanelMemo>;
  onClose: () => void;
  onResolve: (a: AlertItem) => void;
}

/** Pendientes de UN destino para la empresa y el año elegidos; se recalcula con el modelo, así que cada acción actualiza los conteos. */
export function PendingPanel({ model, dest, companyName, memo, onClose, onResolve }: Props) {
  const report = buildPendingReport(model, dest);
  return (
    <Modal
      open
      size="xl"
      title={`Pendientes de ${DEST_LABEL[dest]} · ${companyName} · ${model.year ?? "Sin fecha"}`}
      description={report.notApplicable ? undefined : "Agrupados por causa. Resolver abre el dato exacto y al terminar regresas aquí."}
      onClose={onClose}
      footer={<Button onClick={onClose}>Cerrar</Button>}
    >
      <PendingPanelBody report={report} memo={memo} onResolve={onResolve} />
    </Modal>
  );
}
