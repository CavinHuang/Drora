import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { createMcpAdapter } from "../src/mcp/index.js";
import { normalizeMcpToolDescriptor } from "../src/mcp/descriptor.js";
import { createNodePluginAdapter } from "../src/plugins/index.js";
import { toAiSdkMessages } from "../src/model/transform.js";
import { toAiSdkTools } from "../src/model/tool-transform.js";
import { toolSearchHeaders } from "../src/model/tool-search.js";
import { registerMcpTools } from "../../core/src/mcp/index.js";
import { createToolRegistry } from "../../core/src/tool/registry.js";
import { toolSearchToolEntry } from "../../core/src/tool/handlers/tool-search.js";
import { prepareRuntimeProviderRequest } from "../../core/src/runtime/helpers/runtime-provider-request-messages.js";
import { createTestRuntimeModel } from "../../core/tests/test-runtime-model.js";

// g3（specs/obsidian-vault-phase2-true-extraction.md §4/§6/§10-P2）：manifest 工具级
// `tools.<toolName>.deferred: true` 声明——解析归一化 + 运行时按 VaultSearch shouldDefer
// 同形语义进入 tool-search「先公告、按需加载」集合，并覆盖 server 级 alwaysLoad 常驻。

const PLUGIN_NAME = "tool-deferred-plugin";

describe("plugin MCP 工具级 deferred 声明解析", () => {
  it("合法声明归一化进 config.tools，键为原始 tool 名", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-plugin-tool-deferred-"));
    try {
      const pluginRoot = join(root, PLUGIN_NAME);
      await mkdir(join(pluginRoot, ".zcode-plugin"), { recursive: true });
      await writeFile(
        join(pluginRoot, ".zcode-plugin", "plugin.json"),
        JSON.stringify({
          name: PLUGIN_NAME,
          mcpServers: {
            knowledge: {
              type: "stdio",
              command: "node",
              alwaysLoad: true,
              tools: {
                VaultSearch: { deferred: true },
                vault_neighbors: { deferred: true },
                readFile: {},
              },
            },
          },
        }),
      );
      const storageRoot = join(root, "storage");
      const outcome = await createNodePluginAdapter({ storageRoot }).discoverPlugins({
        config: { dirs: [pluginRoot], enabled: true, enabledPlugins: {}, options: {} },
        env: {},
        storageRoot,
        workingDirectory: root,
      });
      expect(outcome.diagnostics).toEqual([]);
      expect(outcome.mcpServers[`plugin:${PLUGIN_NAME}:knowledge`]).toMatchObject({
        alwaysLoad: true,
        tools: {
          VaultSearch: { deferred: true },
          vault_neighbors: { deferred: true },
          readFile: {},
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { label: "非对象 tools", servers: { knowledge: { type: "stdio", command: "node", tools: [] } } },
    {
      label: "非对象条目",
      servers: { knowledge: { type: "stdio", command: "node", tools: { lookup: true } } },
    },
    {
      label: "非布尔 deferred",
      servers: {
        knowledge: { type: "stdio", command: "node", tools: { lookup: { deferred: "yes" } } },
      },
    },
    {
      label: "未知键",
      servers: {
        knowledge: { type: "stdio", command: "node", tools: { lookup: { autoAllow: true } } },
      },
    },
  ])("非法声明 fail-closed 禁用整台 server（$label）", async ({ servers }) => {
    const root = await mkdtemp(join(tmpdir(), "drora-plugin-tool-deferred-invalid-"));
    try {
      const pluginRoot = join(root, PLUGIN_NAME);
      await mkdir(join(pluginRoot, ".zcode-plugin"), { recursive: true });
      await writeFile(
        join(pluginRoot, ".zcode-plugin", "plugin.json"),
        JSON.stringify({ name: PLUGIN_NAME, mcpServers: servers }),
      );
      const storageRoot = join(root, "storage");
      const outcome = await createNodePluginAdapter({ storageRoot }).discoverPlugins({
        config: { dirs: [pluginRoot], enabled: true, enabledPlugins: {}, options: {} },
        env: {},
        storageRoot,
        workingDirectory: root,
      });
      expect(outcome.diagnostics).toHaveLength(1);
      expect(outcome.diagnostics[0]).toMatchObject({
        code: "plugin_mcp_server_disabled",
        severity: "error",
        pluginId: `${PLUGIN_NAME}@inline`,
      });
      expect(outcome.mcpServers).toEqual({});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("normalizeMcpToolDescriptor deferred 位", () => {
  it("deferred=true 置位；缺省不置位（行为不变）", () => {
    const tool = { name: "VaultSearch", inputSchema: { type: "object", properties: {} } };
    expect(normalizeMcpToolDescriptor("plugin:x:knowledge", tool, undefined, false, true, true))
      .toMatchObject({ toolName: "VaultSearch", alwaysLoad: true, deferred: true });
    expect(
      normalizeMcpToolDescriptor("plugin:x:knowledge", tool, undefined, false, true, false),
    ).toMatchObject({ toolName: "VaultSearch", alwaysLoad: true });
    expect(
      normalizeMcpToolDescriptor("plugin:x:knowledge", tool).deferred,
    ).toBeUndefined();
  });
});

it("工具级 deferred 覆盖 server alwaysLoad：wire 首发只带常驻工具（真实 MCP server）", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-plugin-tool-deferred-wire-"));
  const mcp = createMcpAdapter({ workingDirectory: root });
  const INPUT_SCHEMA = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  };
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            capabilities: { tools: {} },
            protocolVersion: "2025-06-18",
            serverInfo: { name: "tool-deferred", version: "1.0.0" },
          }
        : {
            tools: [
              { name: "VaultSearch", description: "Search the vault", inputSchema: INPUT_SCHEMA },
              { name: "readFile", description: "Read a file", inputSchema: INPUT_SCHEMA },
            ],
          };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing MCP test endpoint");
    const pluginRoot = join(root, PLUGIN_NAME);
    await mkdir(join(pluginRoot, ".zcode-plugin"), { recursive: true });
    await writeFile(
      join(pluginRoot, ".zcode-plugin", "plugin.json"),
      JSON.stringify({
        name: PLUGIN_NAME,
        mcpServers: {
          knowledge: {
            type: "http",
            url: `http://127.0.0.1:${address.port}/mcp`,
            // server 级常驻 + 工具级 deferred：VaultSearch 按需加载、readFile 常驻。
            alwaysLoad: true,
            tools: { VaultSearch: { deferred: true } },
          },
        },
      }),
    );
    const storageRoot = join(root, "storage");
    const outcome = await createNodePluginAdapter({ storageRoot }).discoverPlugins({
      config: { dirs: [pluginRoot], enabled: true, enabledPlugins: {}, options: {} },
      env: {},
      storageRoot,
      workingDirectory: root,
    });
    expect(outcome.diagnostics).toEqual([]);
    const [name, config] = Object.entries(outcome.mcpServers)[0]!;
    expect(await mcp.connectServer(name, config)).toMatchObject({ status: "connected" });
    const descriptors = await mcp.listTools();
    expect(descriptors).toHaveLength(2);
    expect(descriptors.find((tool) => tool.toolName === "VaultSearch")).toMatchObject({
      alwaysLoad: true,
      deferred: true,
    });
    expect(descriptors.find((tool) => tool.toolName === "readFile")).toMatchObject({
      alwaysLoad: true,
    });
    const registry = createToolRegistry();
    registry.register(toolSearchToolEntry);
    const names = registerMcpTools(registry, mcp, descriptors);
    // names 只含本 server 的两个 MCP 工具；ToolSearch 控制工具是注册表内建，不在此列。
    expect(names).toHaveLength(2);
    const model = {
      ...createTestRuntimeModel({
        generateText: async () => ({ text: "", finishReason: "stop", usage: {} }),
      }),
      requestCapabilities: { toolSearch: { protocolSupported: true, defaultEnabled: true } },
    };
    const prepared = prepareRuntimeProviderRequest(
      { config: { toolSearch: { mode: "native" } } },
      {
        model,
        entries: [{ message: { role: "user", content: "Search the vault." } }],
        tools: registry.toContracts(),
        registry,
      },
    ).request;
    expect(prepared.toolSearchEnabled).toBe(true);
    let wire: { tools: Array<{ name: string; defer_loading?: boolean }> } | undefined;
    const provider = createAnthropic({
      apiKey: "test",
      fetch: async (_url, init) => {
        wire = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "capture" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      },
    });
    const options = {
      providerKind: "anthropic" as const,
      toolSearchEnabled: prepared.toolSearchEnabled,
    };
    await expect(
      generateText({
        model: provider("test"),
        maxRetries: 0,
        headers: toolSearchHeaders(undefined, prepared.toolSearchEnabled),
        tools: toAiSdkTools(prepared.tools, options),
        messages: toAiSdkMessages(prepared.messages, options),
      }),
    ).rejects.toBeDefined();
    const wireNames = wire?.tools.map((tool) => tool.name).sort();
    // 首发：常驻工具在（readFile 带全量 schema、ToolSearch 控制入口），声明 deferred 的
    // VaultSearch 整体不进首发请求（native 模式只有 discovered 工具才带 defer_loading 回来）。
    expect(wireNames).toContain("ToolSearch");
    expect(wireNames).toContain(
      names.find((candidate) => candidate.includes("readFile")) as string,
    );
    expect(wire?.tools.find((tool) => tool.name.includes("VaultSearch"))).toBeUndefined();
    expect(
      wire?.tools.find((tool) => tool.name.includes("readFile")),
    ).toMatchObject({ input_schema: INPUT_SCHEMA });
  } finally {
    await mcp.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { force: true, recursive: true });
  }
});
