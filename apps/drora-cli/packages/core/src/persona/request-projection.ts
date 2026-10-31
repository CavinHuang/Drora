import type {
  PersonaContribution,
  PersonaProjectionDiagnostics,
  PersonaRequestProjection,
} from "./contract.js";

/** This operates on a single provider projection, never on canonical entries. */
export function applyPersonaContribution<Source, Diagnostics extends PersonaProjectionDiagnostics>(
  projection: PersonaRequestProjection<Source, Diagnostics>,
  contribution?: PersonaContribution,
): PersonaRequestProjection<Source, Diagnostics> {
  if (!contribution) return projection;
  let index = 0;
  while (projection.messages[index]?.role === "system") index += 1;
  const messages = projection.messages.slice();
  messages.splice(index, 0, { role: "system", content: contribution.content });
  const sourceEntries = projection.sourceEntries.slice();
  sourceEntries.splice(index, 0, undefined);
  const shift = (value: number): number => (value >= index ? value + 1 : value);
  return {
    messages,
    sourceEntries,
    diagnostics: {
      ...projection.diagnostics,
      ...(projection.diagnostics.latestRealUserMessageIndex !== undefined
        ? { latestRealUserMessageIndex: shift(projection.diagnostics.latestRealUserMessageIndex) }
        : {}),
      ...(projection.diagnostics.cacheControlIndex !== undefined
        ? { cacheControlIndex: shift(projection.diagnostics.cacheControlIndex) }
        : {}),
    },
  };
}
