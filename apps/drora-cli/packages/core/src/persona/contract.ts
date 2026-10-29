import type { ModelInputMessage } from "@drora/contracts";
// 版本字面量单一出处是 shared contracts（AGENTS.md）；类型经 typeof 引用同一常量，
// 升级版本时本契约形状随常量自动演进，不再出现第二份手写字面量。
import { PERSONA_COMPILER_VERSION, PERSONA_TEMPLATE_VERSION } from "@drora/shared";

/** Pure, local P0a contract; not a wire schema or execution permission. */
export interface PersonaCore {
  readonly displayName: string;
  readonly selfDescription: string;
  readonly warmth: "restrained" | "balanced" | "warm";
  readonly directness: "gentle" | "balanced" | "direct";
  readonly humor: "off" | "light";
}

export interface PersonaContribution {
  readonly content: string;
  readonly coreRevision: number;
  readonly templateVersion: typeof PERSONA_TEMPLATE_VERSION;
  readonly compilerVersion: typeof PERSONA_COMPILER_VERSION;
}

export type PersonaCompileResult =
  | { readonly status: "compiled"; readonly contribution: PersonaContribution }
  | {
      readonly status: "invalid";
      readonly field: keyof PersonaCore | "core" | "coreRevision" | "content";
    };

export interface PersonaProjectionDiagnostics {
  latestRealUserMessageIndex?: number;
  cacheControlIndex?: number;
}

/** Source entries remain canonical; an added request-only system message has no source. */
export interface PersonaRequestProjection<
  Source,
  Diagnostics extends PersonaProjectionDiagnostics,
> {
  messages: ModelInputMessage[];
  sourceEntries: Array<Source | undefined>;
  diagnostics: Diagnostics;
}

/**
 * Runtime-facing capture seam for one admitted main turn. The production service
 * and its storage arrive in a later slice; an unregistered port means the
 * feature is off and the turn keeps the original request path. The port owns
 * permission, repository reads and its own bounded waiting budget.
 */
export interface PersonaTurnCaptureRequest {
  readonly sessionId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
}

export type PersonaCaptureOutcome =
  | { readonly status: "applied"; readonly contribution: PersonaContribution }
  | { readonly status: "omitted"; readonly reason?: string }
  | { readonly status: "cancelled"; readonly reason?: string };

export interface PersonaCapturePort {
  captureContribution(request: PersonaTurnCaptureRequest): Promise<PersonaCaptureOutcome>;
}
