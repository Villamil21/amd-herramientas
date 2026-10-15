import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Card, Loader, PageHeader } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { fsService } from "../services/fsService";
import { pucService } from "../services/pucService";
import { formatInteger } from "../utils/format";
import { PucCatalog } from "../modules/financial-statements/puc-codes/components/PucCatalog";
import { buildPucIndex } from "../modules/financial-statements/puc-codes/services/pucCatalog";
import { CreatePucCodeModal } from "../modules/financial-statements/shared/components/CreatePucCodeModal";

/**
 * Datos → Tabla de Códigos PUC: catálogo oficial (de consulta) y códigos
 * personalizados (globales, creados en la app). Los códigos excluidos de los
 * Estados Financieros (ej. 7305 — No aplica) se marcan.
 */
export function PucTablePage() {
  const data = useAsync(() => pucService.listCodes(), []);
  const mappings = useAsync(() => fsService.mappings(), []);
  const index = useMemo(() => buildPucIndex(data.data ?? []), [data.data]);
  const mappingMap = useMemo(() => new Map((mappings.data ?? []).map((m) => [m.pucCode, m])), [mappings.data]);
  const excluded = useMemo(() => new Set((mappings.data ?? []).filter((m) => m.excluded).map((m) => m.pucCode)), [mappings.data]);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Datos"
        title="Tabla de Códigos PUC"
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            Nueva cuenta PUC
          </Button>
        }
      />
      {data.error && <Alert tone="danger">{data.error}</Alert>}
      {data.loading && !data.data ? (
        <Loader />
      ) : (
        <Card flush title="Catálogo de cuentas" description={`${formatInteger(index.all.length)} códigos · ${formatInteger(index.custom.size)} personalizados · Se asignan las subcuentas de 6 dígitos y los códigos personalizados`}>
          <PucCatalog index={index} excluded={excluded} maxHeight="calc(100vh - 320px)" />
        </Card>
      )}
      <CreatePucCodeModal
        open={creating}
        index={index}
        mappings={mappingMap}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          await Promise.all([data.reload(), mappings.reload()]);
          setCreating(false);
        }}
      />
    </>
  );
}
