import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { App } from "./app/App";
import { UpdateProvider } from "./app/UpdateProvider";
import { ToastProvider } from "./components/ui";

// Menú contextual del navegador (Recargar, Inspeccionar…) fuera de campos de texto.
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("input, textarea, .selectable")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <UpdateProvider>
        <App />
      </UpdateProvider>
    </ToastProvider>
  </StrictMode>,
);
