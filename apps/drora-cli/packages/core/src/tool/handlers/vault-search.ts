// ============================================================
// VaultSearch Tool Handler
// ============================================================
// agent 的只读 vault 检索入口（obsidian-knowledge.md §5f）：经 context.vaultSearchPort
// 走 host 侧 knowledge 检索服务（与 UI 同一条服务链，agent 是第二个消费方）。
// 只读、无权限 gate（vault 是用户显式授权配置的事实源，读操作不受限是 §5b.2 既有
// 语义）；结构化 status 不抛业务错——no_source/empty/failed 都是正常可转述结果。

import {
  CoreErrorType,
  createCoreError,
  VaultSearchInputJsonSchema,
  VaultSearchInputSchema,
  VaultSearchOutputJsonSchema,
  VaultSearchOutputSchema,
  type VaultSearchInput,
  type VaultSearchOutput,
} from "@drora/contracts";
import type { ToolEntry, ToolExecutionContext, ToolHandler } from "../types.js";

const VAULT_SEARCH_TOOL_TIMEOUT_MS = 15_000;
const VAULT_SEARCH_MODEL_BYTES = 24_000;

function assertVaultSearchPort(
  context: ToolExecutionContext,
): asserts context is ToolExecutionContext & {
  vaultSearchPort: NonNullable<ToolExecutionContext["vaultSearchPort"]>;
} {
  if (context.vaultSearchPort) return;
  throw createCoreError(
    CoreErrorType.ConfigurationError,
    "VaultSearchPort is not configured for VaultSearch",
    {
      context: {
        toolCallId: context.toolCallId,
        toolName: "VaultSearch",
      },
      recoverable: false,
    },
  );
}

const vaultSearchHandler: ToolHandler = async (input, context) => {
  const parsed = VaultSearchInputSchema.parse(input) as VaultSearchInput;
  assertVaultSearchPort(context);

  // 决策出站与该工具无涉（§5f.2 零出站）：端口实现不携带 decisionConsentId，
  // host 侧 search 按 off/denied 处理——Jev 开关与逐 run 授权面不被触达。
  const result = (await context.vaultSearchPort.search({
    query: parsed.query,
    ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
  })) satisfies VaultSearchOutput;
  return VaultSearchOutputSchema.parse(result) as VaultSearchOutput;
};

export const vaultSearchToolEntry: ToolEntry = {
  capability: "Search the user's configured Obsidian vault for relevant notes",
  metadata: {
    name: "VaultSearch",
    description:
      "Search the user's configured Obsidian vault (knowledge base) for notes relevant to a natural-language query. Returns ranked article candidates with verbatim excerpts and line-precise quote selectors, so you can cite exact source locations. Read-only; scoped to the whole authorized vault (no path/date/tag filters by design).",
    modelInstructions: [
      "Prefer this over Grep/Glob when the user asks about the content of their notes/knowledge base — it is relevance-ranked and returns verbatim excerpts with line numbers.",
      "The excerpt is a verbatim slice of the matched chunk, windowed around the match. Quote selectors (startLine/endLine/offsets) point at the real file locations; treat excerpts as unverified citations unless you verify by reading the file.",
      "If the vault lives outside the current workspace, the excerpt may be the only content you can see — do not fabricate file contents beyond it; reading full files outside the workspace may be restricted.",
      "status field is honest: 'no_source' means no vault is configured (tell the user to configure one in settings), 'partial' means the index is incomplete and results may miss matches, 'empty' means nothing matched (do not invent notes).",
      "No filters exist (path/date/tag are not supported); express intent in the query text itself.",
    ],
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: VAULT_SEARCH_TOOL_TIMEOUT_MS,
    maxOutputBytes: VAULT_SEARCH_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: vaultSearchHandler,
  inputSchema: VaultSearchInputJsonSchema,
  outputSchema: VaultSearchOutputJsonSchema,
  runtimeInputSchema: VaultSearchInputSchema,
  runtimeOutputSchema: VaultSearchOutputSchema,
  permission: {
    permission: "vault.read",
    reason: "VaultSearch only reads the user's authorized vault index",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: VAULT_SEARCH_MODEL_BYTES,
    maxModelBytes: VAULT_SEARCH_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: VAULT_SEARCH_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: VAULT_SEARCH_TOOL_TIMEOUT_MS,
    maxMs: VAULT_SEARCH_TOOL_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "VaultSearch was cancelled before results were returned",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
