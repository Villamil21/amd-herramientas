import { ArrowRight, FileSpreadsheet, Landmark, ShieldCheck, Users, HandCoins } from "lucide-react";
import type { ReactNode } from "react";
import { navigate, paths } from "../../../app/router";
import { Badge, Card, EmptyState, PageHeader } from "../../../components/ui";
import { FORMAT_STATUS_LABEL } from "../../../types/exogena";
import { ExogenaContextBar } from "../components/ExogenaContextBar";
import { StatusBadge } from "../components/StatusPanel";
import { FORMATS } from "../domain/formats";
import { useCompanies, useOverview } from "../hooks";
import { useExogenaSelection } from "../state";

const MODULE_ID = "informacion-exogena";

interface CardProps {
  title: string;
  description: string;
  icon: ReactNode;
  onOpen: () => void;
  footer?: ReactNode;
}

function FormatCard({ title, description, icon, onOpen, footer }: CardProps) {
  return (
    <button className="card tile" onClick={onOpen}>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        {icon}
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      <p>{description}</p>
      <div className="row row--between" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {footer}
        <span className="tile__meta">
          <ArrowRight size={13} /> Abrir
        </span>
      </div>
    </button>
  );
}

/** Entrada del módulo: empresa y año a informar, y las pantallas de esta fase con su estado y número de registros reales. */
export default function ExogenaHome() {
  const [selection] = useExogenaSelection();
  const { companies } = useCompanies();
  const { statusOf, overview } = useOverview(selection.companyId, selection.year);
  const hasCompany = selection.companyId !== null;
  const row = (code: string) => statusOf(code);
  const open = (sub: string) => navigate(paths.submodule(MODULE_ID, sub));

  const records = (code: string) => {
    const r = row(code);
    return (
      <span className="row" style={{ gap: 8, alignItems: "center" }}>
        {hasCompany && overview ? <StatusBadge status={r.status} /> : <Badge>{FORMAT_STATUS_LABEL.en_preparacion}</Badge>}
        <span className="muted">
          {hasCompany ? r.recordCount : 0} {r.recordCount === 1 ? "registro" : "registros"}
        </span>
      </span>
    );
  };

  const pendingFormats = FORMATS.filter((f) => !f.implemented);
  return (
    <>
      <PageHeader eyebrow="Herramientas" title="Información Exógena" description="Prepara los formatos anuales para la DIAN por empresa. El corte es siempre del 01/01 al 31/12 del año a informar." />
      <ExogenaContextBar companies={companies} />
      {!hasCompany && (
        <Card>
          <EmptyState icon={<Users size={20} />} title="Selecciona la empresa y el año" description="Elige la empresa y el año a informar para ver el estado de cada formato." />
        </Card>
      )}
      <div className="tile-grid">
        <FormatCard title="1010 · Socios, accionistas y similares" description="Socios con su participación y el capital suscrito asignado a 31 de diciembre, desde Empresas." icon={<Users size={18} />} onOpen={() => open("1010")} footer={records("1010")} />
        <FormatCard title="1009 · Saldos de cuentas por pagar al 31 de diciembre" description="Saldo pendiente por tercero al cierre: proveedores, DIAN y seguridad social, conciliado con el ESF." icon={<Landmark size={18} />} onOpen={() => open("1009")} footer={records("1009")} />
        <FormatCard title="1008 · Saldo de cuentas por cobrar al 31 de diciembre" description="CxC a socios (capital suscrito − pagado) repartida por participación, con conceptos propios del formato." icon={<HandCoins size={18} />} onOpen={() => open("1008")} footer={records("1008")} />
        <FormatCard title="Control y exportación" description="Auditoría de los formatos de la empresa y el año, y exportación a un único Excel." icon={<ShieldCheck size={18} />} onOpen={() => open("control")} footer={<span className="muted">{hasCompany ? "Estado de 1008, 1009 y 1010" : "Selecciona una empresa"}</span>} />
      </div>
      <Card title="Formatos previstos para fases posteriores" description="Están registrados para agregarlos sin cambiar la infraestructura, pero todavía no tienen pantalla.">
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {pendingFormats.map((f) => (
            <span key={f.code} title={f.name}>
              <Badge>
                <FileSpreadsheet size={11} style={{ verticalAlign: "-1px" }} /> {f.code}
              </Badge>
            </span>
          ))}
        </div>
      </Card>
    </>
  );
}
