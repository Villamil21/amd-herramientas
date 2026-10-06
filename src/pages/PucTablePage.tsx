import { useMemo } from "react";
import { Alert, Card, Loader, PageHeader } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { pucService } from "../services/pucService";
import { formatInteger } from "../utils/format";
import { PucCatalog } from "../modules/financial-statements/puc-codes/components/PucCatalog";
import { buildPucIndex } from "../modules/financial-statements/puc-codes/services/pucCatalog";

/**
 * Datos → Tabla de Códigos PUC: catálogo de cuentas del PUC, integrado a la
 * app. Tabla maestra de consulta: no se crean, editan ni eliminan códigos.
 */
export function PucTablePage() {
  const data = useAsync(() => pucService.listCodes(), []);
  const index = useMemo(() => buildPucIndex(data.data ?? []), [data.data]);

  return (
    <>
      <PageHeader eyebrow="Datos" title="Tabla de Códigos PUC" />
      {data.error && <Alert tone="danger">{data.error}</Alert>}
      {data.loading && !data.data ? (
        <Loader />
      ) : (
        <Card flush title="Catálogo de cuentas" description={`Solo consulta · ${formatInteger(index.all.length)} códigos · Los códigos de 6 dígitos son los que se asignan a facturas y productos`}>
          <PucCatalog index={index} maxHeight="calc(100vh - 320px)" />
        </Card>
      )}
    </>
  );
}
