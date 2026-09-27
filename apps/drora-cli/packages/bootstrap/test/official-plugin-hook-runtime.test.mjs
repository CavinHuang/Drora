// official plugin hook 运行时单测：manifest hooks 重写（specs/obsidian-plugin.md
// 「Proma 式原生访问重构」验收场景 12）+ hook env overlay 合并 + __drora-plugin-hook runner。
// 经 tsx 直接消费 src（与 adapters/test 先例一致；@drora/contracts、@drora/core 依赖闭包需先 build）。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { officialPluginHookPrefixArgs, writeOfficialPluginRuntimeManifest } from "../src/app/official-plugin-runtime.js";
import { createPluginEnvOverlay } from "../../core/src/hooks/configured-runner-input.js";
import { runPluginHookCommand } from "../../cli/src/plugin-hook-command.js";
import { createNodePluginAdapter } from "../../adapters/src/plugins/index.js";
import { DRORA_PLUGIN_HOOK_COMMAND } from "@drora/contracts";

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL - ${name}`);
    console.error(`  ${error?.stack ?? error}`);
  }
}

function withManifest(manifest, fn) {
  const rootPath = mkdtempSync(join(tmpdir(), "drora-official-plugin-runtime-"));
  try {
    mkdirSync(join(rootPath, ".zcode-plugin"), { recursive: true });
    const manifestPath = join(rootPath, ".zcode-plugin", "plugin.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return fn({ rootPath, manifestPath, read: () => JSON.parse(readFileSync(manifestPath, "utf8")) });
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
}

const HOOK_ENTRY = {
  type: "process",
  command: "node",
  args: ["${DRORA_PLUGIN_ROOT}/dist/hooks/session-start.mjs"],
  timeoutMs: 10000,
};

// ---- manifest hooks 重写 ----

await test("hooks 中 command:\"node\" 被重写为 __drora-plugin-hook 宿主启动", () => {
  withManifest({ name: "obsidian", hooks: { SessionStart: [{ hooks: [structuredClone(HOOK_ENTRY)] }] } }, ({ rootPath, read }) => {
    writeOfficialPluginRuntimeManifest({ pluginName: "obsidian", rootPath });
    const entry = read().hooks.SessionStart[0].hooks[0];
    const prefix = officialPluginHookPrefixArgs();
    assert.ok(prefix);
    assert.equal(entry.command, process.execPath);
    assert.deepEqual(entry.args.slice(0, -1), prefix);
    assert.equal(entry.args.at(-1), resolve(rootPath, "dist/hooks/session-start.mjs"));
    assert.equal(entry.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(entry.env.DRORA_PLUGIN_ID, "obsidian@drora-plugins-official");
    // 前缀末位必须是 hook 专用子命令，不与 MCP 宿主入口混用（CUA 门禁隔离）。
    assert.equal(prefix.at(-1), DRORA_PLUGIN_HOOK_COMMAND);
  });
});

await test("重写幂等：二次调用内容字节不变", () => {
  withManifest({ name: "obsidian", hooks: { PermissionRequest: [{ matcher: "Write|Edit", hooks: [structuredClone(HOOK_ENTRY)] }] } }, ({ rootPath, manifestPath }) => {
    writeOfficialPluginRuntimeManifest({ pluginName: "obsidian", rootPath });
    const first = readFileSync(manifestPath, "utf8");
    writeOfficialPluginRuntimeManifest({ pluginName: "obsidian", rootPath });
    assert.equal(readFileSync(manifestPath, "utf8"), first);
  });
});

await test("根外逃逸脚本参数保持原样（不被重写）", () => {
  withManifest(
    {
      name: "obsidian",
      hooks: { SessionStart: [{ hooks: [{ ...structuredClone(HOOK_ENTRY), args: ["${DRORA_PLUGIN_ROOT}/../../evil.mjs"] }] }] },
    },
    ({ rootPath, read }) => {
      writeOfficialPluginRuntimeManifest({ pluginName: "obsidian", rootPath });
      const entry = read().hooks.SessionStart[0].hooks[0];
      assert.equal(entry.command, "node");
      assert.equal(entry.env, undefined);
    },
  );
});

await test("非 node 命令与 command 型 hook 不参与重写", () => {
  withManifest(
    {
      name: "obsidian",
      hooks: {
        SessionStart: [
          {
            hooks: [
              { ...structuredClone(HOOK_ENTRY), command: "deno" },
              { type: "command", command: "node ./run.js", shell: true },
            ],
          },
        ],
      },
    },
    ({ rootPath, read }) => {
      writeOfficialPluginRuntimeManifest({ pluginName: "obsidian", rootPath });
      const hooks = read().hooks.SessionStart[0].hooks;
      assert.equal(hooks[0].command, "deno");
      assert.equal(hooks[1].type, "command");
      assert.equal(hooks[1].command, "node ./run.js");
    },
  );
});

await test("mcpServers 与 hooks 并存时两者都被重写（历史 MCP 行为不回归）", () => {
  withManifest(
    {
      name: "mixed",
      mcpServers: { srv: { command: "node", args: ["${DRORA_PLUGIN_ROOT}/dist/mcp/server.js"] } },
      hooks: { SessionStart: [{ hooks: [structuredClone(HOOK_ENTRY)] }] },
    },
    ({ rootPath, read }) => {
      writeOfficialPluginRuntimeManifest({ pluginName: "mixed", rootPath });
      const manifest = read();
      assert.equal(manifest.mcpServers.srv.command, process.execPath);
      assert.equal(manifest.mcpServers.srv.args.at(-1), resolve(rootPath, "dist/mcp/server.js"));
      assert.equal(manifest.mcpServers.srv.env.ELECTRON_RUN_AS_NODE, "1");
      const hook = manifest.hooks.SessionStart[0].hooks[0];
      assert.equal(hook.command, process.execPath);
      assert.equal(officialPluginHookPrefixArgs().at(-1), DRORA_PLUGIN_HOOK_COMMAND);
    },
  );
});

await test("skill-only manifest（无 mcpServers/hooks）文件保持不动", () => {
  withManifest({ name: "content", skills: "skills" }, ({ rootPath, manifestPath }) => {
    const before = readFileSync(manifestPath, "utf8");
    writeOfficialPluginRuntimeManifest({ pluginName: "content", rootPath });
    assert.equal(readFileSync(manifestPath, "utf8"), before);
  });
});

// ---- hook env overlay 合并（core） ----

await test("hook 配置 env 覆盖通用 overlay 键", () => {
  const input = { sessionId: "s1", cwd: "/w", hookEventName: "SessionStart" };
  const overlay = createPluginEnvOverlay(
    { id: "obsidian@drora-plugins-official", name: "obsidian", rootPath: "/p", dataPath: "/d" },
    input,
    "/w",
    { ELECTRON_RUN_AS_NODE: "1", DRORA_PLUGIN_ID: "authoritative" },
  );
  assert.equal(overlay.set.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(overlay.set.DRORA_PLUGIN_ID, "authoritative");
  assert.equal(overlay.set.DRORA_PLUGIN_DATA, "/d");
  const bare = createPluginEnvOverlay(undefined, input, "/w", { FOO: "1" });
  assert.equal(bare.set.FOO, "1");
});

// ---- __drora-plugin-hook runner（cli） ----

const fakeCtx = () => {
  const ctx = { output: "", stderr: { write: (s) => { ctx.output += s; } } };
  return ctx;
};

await test("runner：无参数 → 用法与 exit 1", async () => {
  const ctx = fakeCtx();
  assert.equal(await runPluginHookCommand(ctx, []), 1);
  assert.match(ctx.output, /Usage:/);
});

await test("runner：脚本不存在 → exit 1", async () => {
  const ctx = fakeCtx();
  assert.equal(await runPluginHookCommand(ctx, [join(tmpdir(), "definitely-missing.mjs")]), 1);
  assert.match(ctx.output, /does not exist/);
});

await test("runner：未导出 main() → exit 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drora-hook-runner-"));
  try {
    const script = join(dir, "no-main.mjs");
    writeFileSync(script, "export const x = 1;\n");
    const ctx = fakeCtx();
    assert.equal(await runPluginHookCommand(ctx, [script]), 1);
    assert.match(ctx.output, /does not export main\(\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("runner：合法脚本调用 main()，且不改写 process.argv（自启守卫不双跑）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drora-hook-runner-"));
  try {
    const marker = join(dir, "marker.txt");
    const script = join(dir, "ok.mjs");
    writeFileSync(script, `import { writeFileSync } from "node:fs";\nexport async function main() { writeFileSync(${JSON.stringify(marker)}, String(process.argv[1] ?? "")); }\n`);
    const argvBefore = [...process.argv];
    const ctx = fakeCtx();
    assert.equal(await runPluginHookCommand(ctx, [script]), 0);
    assert.deepEqual(process.argv, argvBefore);
    const markerArgv = readFileSync(marker, "utf8");
    assert.notEqual(markerArgv, resolve(script));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 真实 adapters 加载链消费 obsidian plugin.json（specs/obsidian-plugin.md 验收场景 12 的
//      发现面：manifest 内联 hooks 形状必须被公开 discoverPluginsSync 接受且无诊断错误） ----

const OBSIDIAN_PLUGIN_ROOT = resolve(import.meta.dirname, "../../obsidian-plugin");

await test("discoverPluginsSync：obsidian manifest 内联 hooks 被解析为三个事件", () => {
  const storageRoot = mkdtempSync(join(tmpdir(), "drora-hook-discover-"));
  try {
    const adapter = createNodePluginAdapter({ storageRoot });
    const outcome = adapter.discoverPluginsSync({
      config: {
        dirs: [OBSIDIAN_PLUGIN_ROOT],
        enabled: true,
        enabledPlugins: {},
        extraKnownMarketplaces: {},
        options: {},
        suppressedBuiltins: [],
      },
      storageRoot,
      workingDirectory: storageRoot,
    });
    const hookErrors = outcome.diagnostics.filter((d) =>
      d.pluginId?.startsWith("obsidian") && (d.code === "plugin_hook_invalid" || d.code === "plugin_hook_unsupported_event"),
    );
    assert.deepEqual(hookErrors, []);

    const events = outcome.hooks;
    assert.equal(events.SessionStart?.length, 1);
    assert.equal(events.SessionStart[0].matcher, undefined);
    assert.equal(events.UserPromptSubmit?.length, 1);
    assert.equal(events.PermissionRequest?.length, 1);
    assert.equal(events.PermissionRequest[0].matcher, "Write|Edit");

    for (const eventName of ["SessionStart", "UserPromptSubmit", "PermissionRequest"]) {
      const hook = events[eventName][0].hooks[0];
      assert.equal(hook.type, "process");
      assert.equal(hook.command, "node");
      assert.match(hook.args[0], /^\$\{DRORA_PLUGIN_ROOT\}\/dist\/hooks\/.+\.mjs$/u);
      // 插件上下文随解析被盖章：宿主重写与 env overlay 依赖它。
      assert.equal(hook.plugin?.name, "obsidian");
      assert.ok(hook.plugin?.dataPath);
    }

    const metadata = outcome.plugins.find((p) => p.id === "obsidian" || p.id.startsWith("obsidian@"));
    assert.ok(metadata, "obsidian plugin should be discovered");
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

process.exitCode = failures ? 1 : 0;
if (failures) console.error(`\n${failures} test(s) failed`);
