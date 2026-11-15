import type {
  PersonaContribution,
  PersonaProjectionDiagnostics,
  PersonaRequestProjection,
} from "./contract.js";

/** This operates on a single provider projection, never on canonical entries. */
export function applyPersonaContribution<
  Source,
  Diagnostics extends PersonaProjectionDiagnostics,
  Origin = never,
>(
  projection: PersonaRequestProjection<Source, Diagnostics, Origin>,
  contribution?: PersonaContribution,
): PersonaRequestProjection<Source, Diagnostics, Origin> {
  if (!contribution) return projection;
  let index = 0;
  while (projection.messages[index]?.role === "system") index += 1;
  const messages = projection.messages.slice();
  messages.splice(index, 0, { role: "system", content: contribution.content });
  const sourceEntries = projection.sourceEntries.slice();
  sourceEntries.splice(index, 0, undefined);
  // v3.18.0：originEntries 在场时同步插入空组（注入消息无来源），保持与 messages 逐组对齐。
  const originEntries = projection.originEntries?.slice();
  originEntries?.splice(index, 0, []);
  const shift = (value: number): number => (value >= index ? value + 1 : value);
  return {
    messages,
    sourceEntries,
    ...(originEntries ? { originEntries } : {}),
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
