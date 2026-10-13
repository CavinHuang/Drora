/**
 * VaultSearch 工具 handler 单测（obsidian-knowledge.md §5f / VS-1、VS-2、VS-5）。
 *
 * 断言：端口缺席构造即配置错误（VS-5 的兜底层）；入参校验（query ≤512、limit 1-10、
 * 严格模式拒绝未知字段）；limit 透传与缺省省略；结构化 status 原样返回不抛业务错。
 * 运行：node --import tsx --test apps/drora-cli/packages/core/test/vault-search-handler.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  VaultSearchInputSchema,
  type VaultSearchOutput,
} from "@drora/contracts";
import { vaultSearchToolEntry } from "../src/tool/handlers/vault-search.js";
import type { ToolExecutionContext } from "../src/tool/types.js";

function fakeContext(port: unknown): ToolExecutionContext {
  return {
    toolCallId: "call-1",
    toolName: "VaultSearch",
    traceId: "trace-1",
    abortSignal: new AbortController().signal,
    workingDirectory: "/tmp/workspace",
    workspaceRoot: "/tmp/workspace",
    ...(port === undefined ? {} : { vaultSearchPort: port }),
  } as unknown as ToolExecutionContext;
}

function fakePort(result: VaultSearchOutput, seen: unknown[] = []) {
  return {
    search: async (input: unknown) => {
      seen.push(input);
      return result;
    },
  };
}

const readyResult: VaultSearchOutput = {
  status: "ready",
  reason: null,
  candidates: [
    {
      articleId: "a1",
      relativePath: "notes/context.md",
      title: "上下文窗口",
      matchedHeading: null,
      excerpt: "上下文窗口优化……",
      quote: { startLine: 1, endLine: 2, startOffset: 0, endOffset: 20 },
      rank: 1,
      matchedChunkCount: 1,
    },
  ],
  diagnostics: {
    coveragePartial: false,
    matchRelaxedToOr: false,
    semantic: "unavailable",
  },
};

test("VS-1：正常检索 → 结构化结果原样返回，limit 缺省时不携带字段", async () => {
  const seen: unknown[] = [];
  const output = (await vaultSearchToolEntry.handler(
    { query: "上下文窗口" },
    fakeContext(fakePort(readyResult, seen)),
  )) as VaultSearchOutput;
  assert.equal(output.status, "ready");
  assert.equal(output.candidates[0]?.relativePath, "notes/context.md");
  assert.deepEqual(seen, [{ query: "上下文窗口" }]);

  const limited = (await vaultSearchToolEntry.handler(
    { query: "上下文窗口", limit: 3 },
    fakeContext(fakePort(readyResult, seen)),
  )) as VaultSearchOutput;
  assert.equal(limited.status, "ready");
  assert.deepEqual(seen[1], { query: "上下文窗口", limit: 3 });
});

test("VS-2：no_source/failed 结构化返回，不抛业务错", async () => {
  const noSource: VaultSearchOutput = {
    status: "no_source",
    reason: "vault_not_configured",
    candidates: [],
    diagnostics: null,
  };
  const output = (await vaultSearchToolEntry.handler(
    { query: "任意" },
    fakeContext(fakePort(noSource)),
  )) as VaultSearchOutput;
  assert.equal(output.status, "no_source");
  assert.equal(output.diagnostics, null);
});

test("VS-5 兜底：端口缺席 → 配置错误（正常装配下工具不会注册，此为纵深防御）", async () => {
  await assert.rejects(
    () => vaultSearchToolEntry.handler({ query: "任意" }, fakeContext(undefined)),
    /VaultSearchPort is not configured/u,
  );
});

test("入参校验：超长 query / 越界 limit / 未知字段（严格模式）", () => {
  assert.throws(() => VaultSearchInputSchema.parse({ query: "字".repeat(513) }));
  assert.throws(() => VaultSearchInputSchema.parse({ query: "合法", limit: 11 }));
  assert.throws(() => VaultSearchInputSchema.parse({ query: "合法", path: "notes/" }));
  assert.throws(() => VaultSearchInputSchema.parse({ query: "" }));
});
