import type { Concept, ConceptInput } from "../types/models";
import { call } from "./tauri";

export const conceptService = {
  list: (search?: string) => call<Concept[]>("list_concepts", { search: search || null }),
  create: (input: ConceptInput) => call<number>("create_concept", { input }),
  update: (id: number, input: ConceptInput) => call<void>("update_concept", { id, input }),
  remove: (id: number) => call<void>("delete_concept", { id }),
};
