import { compilePersonaCore, defaultPersonaCore } from "./index.js";
import type { PersonaContribution } from "./contract.js";

/** Freeze this value at admission, then reuse it for all requests in the same living turn. */
export function examplePersonaContribution(): PersonaContribution | undefined {
  const result = compilePersonaCore(defaultPersonaCore, 1);
  return result.status === "compiled" ? result.contribution : undefined;
}
