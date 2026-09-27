import { Compass } from "lucide-react";
import { navigate, paths } from "../app/router";
import { Button, Card, EmptyState } from "../components/ui";

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={<Compass size={20} />}
        title="No encontramos esta sección"
        action={<Button onClick={() => navigate(paths.home)}>Ir al inicio</Button>}
      />
    </Card>
  );
}
