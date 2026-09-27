import { Clock } from "lucide-react";
import { navigate } from "../app/router";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";

export function ComingSoonPage({ title, backTo }: { title: string; backTo: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState
          icon={<Clock size={20} />}
          title="Próximamente"
          description="Esta herramienta está en preparación y estará disponible en una próxima versión."
          action={<Button onClick={() => navigate(backTo)}>Volver</Button>}
        />
      </Card>
    </>
  );
}
