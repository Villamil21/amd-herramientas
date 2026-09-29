import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";

interface Props {
  children: ReactNode;
  /** Acción para salir de la pantalla con error (ej. volver a Herramientas). */
  action?: ReactNode;
}

/**
 * Si una pantalla falla al dibujarse, muestra un aviso en su lugar en vez de
 * dejar toda la ventana en blanco. La navegación sigue disponible.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[pantalla]", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="No se pudo mostrar esta pantalla"
          description="Ocurrió un error inesperado al dibujarla. Tus datos no se modificaron."
          action={this.props.action}
        />
      </Card>
    );
  }
}
