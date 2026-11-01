import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpDataSyncPayload } from "@drora/shared";
import { createMcpDataSyncMethods } from "../src/data-sync/mcpDataSync.js";
import { createMcpSyncService } from "../src/mcp-sync/mcpSyncService.js";

// 2026-11-01 S7 适配说明：上游 v3.17.1（S3 段）删除了 createMcpSyncService 的四个显式
// 远端接口（listLocalUserMcpCandidates、listRemoteUserMcpStatuses、exportMcpServers/
// importMcpServers 与 checkRemoteUserMcpWriteAccess），本地列举语义收敛进
// loadMcpFromUserDirectory（同一读取/迁移机制：readServerMapWithLegacyMigration +
// .agents 回退），远端同步语义迁至 data-sync 分类实现 createMcpDataSyncMethods
// （listSyncItems/exportSyncItems/importSyncItems/checkSyncWriteAccess）。本文件按新
// 契约重写原 12 例，断言的 产品语义（enable 迁移、停用优先、幂等、密钥保真、0600、
// 损坏文件保护、路径改写、同名不覆盖）逐条保留。
function makeHome() {
  return mkdtempSync(join(tmpdir(), "drora-mcp-sync-home-"));
}

async function writeDroraUserMcp(home: string, servers: Record<string, Record<string, unknown>>) {
  const configPath = join(home, ".drora", "cli", "config.json");
  await mkdir(join(home, ".drora", "cli"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ mcp: { servers } }, null, 2)}\n`);
  return configPath;
}

async function writeAgentsUserMcp(home: string, servers: Record<string, Record<string, unknown>>) {
  const configPath = join(home, ".agents", "mcp.json");
  await mkdir(join(home, ".agents"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
  return configPath;
}

async function readRemoteDroraServers(home: string) {
  const raw = await readFile(join(home, ".drora", "cli", "config.json"), "utf-8");
  const parsed = JSON.parse(raw) as {
    mcp?: { servers?: Record<string, Record<string, unknown>> };
  };
  return parsed.mcp?.servers ?? {};
}

async function exportAllItems(
  methods: ReturnType<typeof createMcpDataSyncMethods>,
  workspace?: Parameters<typeof methods.exportSyncItems>[0]["workspace"],
): Promise<McpDataSyncPayload> {
  const list = await methods.listSyncItems();
  return methods.exportSyncItems({
    keys: list.items.map((item) => item.key),
    ...(workspace ? { workspace } : {}),
  });
}

function createOnlyItems(payload: McpDataSyncPayload) {
  return payload.items.map((item) => ({ key: item.key, mode: "createOnly" as const }));
}

describe("mcp sync service", () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("lists user drora MCP servers through the user directory load path", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeDroraUserMcp(home, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    });
    const service = createMcpSyncService();

    const result = await service.loadMcpFromUserDirectory();

    expect(result.servers).toMatchObject([
      {
        source: "droraagentmcp",
        scope: "user",
        name: "context7",
        enabled: true,
        config: {
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
        },
        file: { filePath: join(home, ".drora", "cli", "config.json") },
      },
    ]);
  });

  it("marks a server disabled when only enabled:false is present", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 外部工具/手工编辑写的是 enabled:false；同步侧不能把它当成启用状态。
    await writeDroraUserMcp(home, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enabled: false,
      },
    });
    const service = createMcpSyncService();

    const result = await service.loadMcpFromUserDirectory();

    expect(result.servers[0]).toMatchObject({ name: "context7", enabled: false });
  });

  it("clears a stale enabled flag when toggling a server", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 线上配置里 enable 与 enabled 并存，切换开关后不能再留下自相矛盾的字段。
    await writeDroraUserMcp(home, {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enabled: true,
      },
    });
    const service = createMcpSyncService();

    await service.saveMcpToUserDirectory({
      action: "set-enabled",
      source: "droraagentmcp",
      name: "context7",
      enabled: false,
    });

    expect((await readRemoteDroraServers(home)).context7).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      enabled: false,
    });

    await service.saveMcpToUserDirectory({
      action: "set-enabled",
      source: "droraagentmcp",
      name: "context7",
      enabled: true,
    });

    expect((await readRemoteDroraServers(home)).context7).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    });
  });

  it("migrates a legacy enable flag to enabled when loading user MCP", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 存量配置只有桌面端历史写入的 enable；读取时应就地迁移成契约字段 enabled。
    await writeDroraUserMcp(home, {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enable: false,
      },
    });
    const service = createMcpSyncService();

    const result = await service.loadMcpFromUserDirectory();

    expect(result.servers[0]).toMatchObject({ name: "context7", enabled: false });
    expect((await readRemoteDroraServers(home)).context7).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      enabled: false,
    });
  });

  it("keeps a server disabled when legacy enable:false collides with enabled:true", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 线上事故配置：停用写了 enable:false，但外部导入残留 enabled:true。迁移必须保住停用语义。
    await writeDroraUserMcp(home, {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        enable: false,
        enabled: true,
      },
    });
    const service = createMcpSyncService();

    const result = await service.loadMcpFromUserDirectory();

    expect(result.servers[0]).toMatchObject({ name: "context7", enabled: false });
    expect((await readRemoteDroraServers(home)).context7).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      enabled: false,
    });
  });

  it("leaves the config file untouched when no legacy enable flag exists", async () => {
    const home = makeHome();
    process.env.HOME = home;
    // 迁移必须幂等：没有残留字段时不能重写文件，否则每次加载都会动用户的配置。
    // 故意用非规范化的紧凑 JSON 落盘，任何重写都会改变字节内容。
    const configPath = join(home, ".drora", "cli", "config.json");
    await mkdir(join(home, ".drora", "cli"), { recursive: true });
    const raw = JSON.stringify({
      mcp: {
        servers: {
          context7: {
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            enabled: false,
          },
        },
      },
    });
    await writeFile(configPath, raw);
    const service = createMcpSyncService();

    await service.loadMcpFromUserDirectory();

    await expect(readFile(configPath, "utf-8")).resolves.toBe(raw);
  });

  it("checks remote MCP config directory write access before sync", async () => {
    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const methods = createMcpDataSyncMethods();

    const result = await methods.checkSyncWriteAccess();

    expect(result).toMatchObject({
      ok: true,
      path: join(remoteHome, ".drora", "cli"),
    });
  });

  it("reports remote MCP write preflight failure when cli path is not a directory", async () => {
    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    await mkdir(join(remoteHome, ".drora"), { recursive: true });
    await writeFile(join(remoteHome, ".drora", "cli"), "not a directory");
    const methods = createMcpDataSyncMethods();

    const result = await methods.checkSyncWriteAccess();

    expect(result.ok).toBe(false);
    expect(result.path).toBe(join(remoteHome, ".drora", "cli"));
    expect(result.error).toBeTruthy();
  });

  it("falls back to user agents MCP servers when drora user MCP is empty", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeAgentsUserMcp(home, {
      docs: {
        type: "http",
        url: "https://mcp.example.com/mcp",
      },
    });
    const service = createMcpSyncService();

    const result = await service.loadMcpFromUserDirectory();

    expect(result.servers).toMatchObject([
      {
        name: "docs",
        file: { filePath: join(home, ".agents", "mcp.json") },
      },
    ]);
  });

  it("imports stdio and HTTP MCP servers while preserving secrets", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    await writeDroraUserMcp(localHome, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        env: { CONTEXT7_API_KEY: "secret-local" },
      },
      docsApi: {
        type: "http",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer secret-token" },
      },
    });
    const exported = await exportAllItems(createMcpDataSyncMethods());

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const result = await createMcpDataSyncMethods().importSyncItems({
      payload: exported,
      items: createOnlyItems(exported),
    });

    expect(result.results).toMatchObject([
      { key: "context7", status: "created" },
      { key: "docsapi", status: "created" },
    ]);
    const remoteServers = await readRemoteDroraServers(remoteHome);
    expect(remoteServers.context7).toMatchObject({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: { CONTEXT7_API_KEY: "secret-local" },
    });
    expect(remoteServers.docsApi).toMatchObject({
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("creates imported remote MCP config with owner-only permissions", async () => {
    if (process.platform === "win32") {
      return;
    }

    const previousUmask = process.umask(0o000);
    try {
      const remoteHome = makeHome();
      process.env.HOME = remoteHome;
      const payload: McpDataSyncPayload = {
        sourceHomeDir: "/Users/local",
        items: [
          {
            key: "docs-api",
            name: "docsApi",
            enabled: true,
            config: {
              type: "http",
              url: "https://mcp.example.com/mcp",
              headers: { Authorization: "Bearer secret-token" },
            },
          },
        ],
      };

      await createMcpDataSyncMethods().importSyncItems({
        payload,
        items: [{ key: "docs-api", mode: "createOnly" }],
      });

      const configMode = (await stat(join(remoteHome, ".drora", "cli", "config.json"))).mode;
      expect(configMode & 0o777).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });

  it("fails remote import without overwriting an invalid drora config file", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    await writeDroraUserMcp(localHome, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    });
    const exported = await exportAllItems(createMcpDataSyncMethods());

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    const invalidConfigPath = join(remoteHome, ".drora", "cli", "config.json");
    await mkdir(join(remoteHome, ".drora", "cli"), { recursive: true });
    await writeFile(invalidConfigPath, '{"mcp":');

    const result = await createMcpDataSyncMethods().importSyncItems({
      payload: exported,
      items: createOnlyItems(exported),
    });

    expect(result.results).toMatchObject([{ key: "context7", status: "failed" }]);
    expect(result.results[0]?.error).toContain("config.json");
    await expect(readFile(invalidConfigPath, "utf-8")).resolves.toBe('{"mcp":');
  });

  it("loads and saves user MCP through the service on the current host", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const service = createMcpSyncService();

    await service.saveMcpToUserDirectory({
      action: "upsert",
      source: "droraagentmcp",
      name: "deepwiki",
      config: {
        type: "http",
        url: "https://mcp.deepwiki.com/mcp",
      },
    });

    const result = await service.loadMcpFromUserDirectory();

    expect(result.servers).toMatchObject([
      {
        source: "droraagentmcp",
        scope: "user",
        name: "deepwiki",
        config: {
          type: "http",
          url: "https://mcp.deepwiki.com/mcp",
        },
      },
    ]);
    expect(result.servers[0]?.file?.filePath).toBe(join(home, ".drora", "cli", "config.json"));
  });

  it("loads workspace MCP before user MCP using the same directory precedence", async () => {
    const home = makeHome();
    const workspace = join(home, "workspace");
    process.env.HOME = home;
    await writeDroraUserMcp(home, {
      userOnly: { type: "http", url: "https://user.example.test/mcp" },
    });
    await mkdir(join(workspace, ".drora"), { recursive: true });
    await writeFile(
      join(workspace, ".drora", "config.json"),
      JSON.stringify(
        {
          mcp: {
            servers: {
              workspaceOnly: {
                type: "http",
                url: "https://workspace.example.test/mcp",
              },
            },
          },
        },
        null,
        2,
      ),
    );
    const service = createMcpSyncService();

    const result = await service.loadMcpFromUserDirectory({ workspacePath: workspace });

    expect(result.servers.map((server) => `${server.scope}:${server.name}`)).toEqual([
      "workspace:workspaceOnly",
      "user:userOnly",
    ]);
  });

  it("rewrites filesystem MCP home and workspace paths for the remote host", async () => {
    const localHome = makeHome();
    const localWorkspacePath = join(localHome, "workspace", "drora");
    process.env.HOME = localHome;
    await writeDroraUserMcp(localHome, {
      filesystem: {
        type: "stdio",
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          join(localWorkspacePath, "src"),
          join(localHome, "Documents"),
        ],
      },
    });
    const exported = await exportAllItems(createMcpDataSyncMethods(), {
      sourceWorkspacePath: localWorkspacePath,
      targetWorkspacePath: "/srv/drora",
    });

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    await createMcpDataSyncMethods().importSyncItems({
      payload: exported,
      items: createOnlyItems(exported),
    });

    const remoteServers = await readRemoteDroraServers(remoteHome);
    expect(remoteServers.filesystem?.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/srv/drora/src",
      join(remoteHome, "Documents"),
    ]);
  });

  it("skips same-name remote MCP servers without overwriting", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    await writeDroraUserMcp(localHome, {
      context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      },
    });
    const exported = await exportAllItems(createMcpDataSyncMethods());

    const remoteHome = makeHome();
    process.env.HOME = remoteHome;
    await writeDroraUserMcp(remoteHome, {
      context7: {
        type: "stdio",
        command: "existing-command",
      },
    });

    const result = await createMcpDataSyncMethods().importSyncItems({
      payload: exported,
      items: createOnlyItems(exported),
    });

    expect(result.results).toEqual([
      {
        key: "context7",
        status: "conflict",
        error: undefined,
      },
    ]);
    const remoteServers = await readRemoteDroraServers(remoteHome);
    expect(remoteServers.context7).toMatchObject({
      command: "existing-command",
    });
  });
});
