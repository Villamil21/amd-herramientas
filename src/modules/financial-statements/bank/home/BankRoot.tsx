import { ArrowLeft } from "lucide-react";
import { Suspense, type ComponentType } from "react";
import { navigate, useRoute } from "../../../../app/router";
import { Button, Loader } from "../../../../components/ui";
import { BANKS_PATH, parseBankExoFocus } from "../exogena/paths";
import BankHomePage from "./BankHomePage";

/** Segmento que abre la importación de un PDF (el lector propio de cada banco) dentro de la pantalla del banco. */
export const IMPORT_SEGMENT = "importar";

interface Props {
  id: string;
  name: string;
  /** Pantalla de importación y análisis del PDF de este banco. */
  ImportPage: ComponentType;
}

/**
 * Raíz de un banco dentro de Extractos bancarios: su pantalla (cobertura por período, ficha y Exógena) y, en `/importar`, su lector
 * de PDF. Un enlace con foco (`mes~…`, `ficha~…`) abre directamente ese mes o esa ficha.
 */
export function BankRoot({ id, name, ImportPage }: Props) {
  const route = useRoute();
  const segment = route[4];
  if (segment === IMPORT_SEGMENT) {
    return (
      <>
        <div className="row" style={{ marginBottom: 8 }}>
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate(`${BANKS_PATH}/${id}`)}>
            {`Volver a ${name}`}
          </Button>
        </div>
        <Suspense fallback={<Loader />}>
          <ImportPage />
        </Suspense>
      </>
    );
  }
  return <BankHomePage bankId={id} bankName={name} focus={parseBankExoFocus(segment)} />;
}
