// hook 脚本 stdin/stdout E2E：spawn 构建产物，按运行时 JSON-over-stdin 契约断言输出。
// 对应 specs/obsidian-plugin.md「Proma 式原生访问重构」验收场景 9-11。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sessionStartScript = fileURLToPath(new URL("../dist/hooks/session-start.mjs", import.meta.url));
const permissionRequestScript = fileURLToPath(new URL("../dist/hooks/permission-request.mjs", import.meta.url));
const userPromptSubmitScript = fileURLToPath(new URL("../dist/hooks/user-prompt-submit.mjs", import.meta.url));

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL - ${name}`);
    console.error(`  ${error?.message ?? error}`);
  }
}

function makeEnv(overrides = {}) {
  const base = mkdtempSync(join(tmpdir(), "drora-obsidian-hooks-e2e-"));
  const vault = join(base, "vault");
  const dataDir = join(base, "data");
  mkdirSync(join(vault, "notes"), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(vault, "notes", "a.md"), "# A\n");
  writeFileSync(
    join(dataDir, "vault-config.json"),
    JSON.stringify({
      rootPath: vault,
      displayName: "E2E Vault",
      inboxPath: "Inbox",
      allowAgentWrites: true,
      configuredAt: Date.now(),
      ...overrides.config,
    }),
  );
  return { base, vault, dataDir, env: { ...process.env, DRORA_PLUGIN_DATA: dataDir } };
}

function runHook(script, stdin, env) {
  return spawnSync(process.execPath, [script], {
    input: typeof stdin === "string" ? stdin : `${JSON.stringify(stdin ?? {})}\n`,
    encoding: "utf-8",
    env,
    timeout: 15000,
  });
}

await test("SessionStart：已配置 → 输出含根路径的 additionalContext", () => {
  const { base, vault, env } = makeEnv();
  try {
    const result = runHook(sessionStartScript, { hookEventName: "SessionStart", source: "startup" }, env);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.additionalContext.includes(vault), true);
    assert.match(output.additionalContext, /## Obsidian Vault/);
    assert.match(output.additionalContext, /写授权已开启/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

await test("SessionStart：未配置 → 输出引导上下文", () => {
  const base = mkdtempSync(join(tmpdir(), "drora-obsidian-hooks-e2e-"));
  const dataDir = join(base, "data");
  mkdirSync(dataDir, { recursive: true });
  try {
    const result = runHook(sessionStartScript, {}, { ...process.env, DRORA_PLUGIN_DATA: dataDir });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.additionalContext, /尚未配置 Vault/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

await test("PermissionRequest：根内写入 + allowAgentWrites=true → allow 决策", () => {
  const { base, vault, env } = makeEnv();
  try {
    const result = runHook(
      permissionRequestScript,
      {
        hookEventName: "PermissionRequest",
        toolName: "Write",
        toolInput: { file_path: join(vault, "notes", "a.md") },
        cwd: vault,
      },
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

await test("PermissionRequest：allowAgentWrites=false → 静默（无决策，exit 0）", () => {
  const { base, env } = makeEnv({ config: { allowAgentWrites: false } });
  try {
    const result = runHook(
      permissionRequestScript,
      { toolName: "Write", toolInput: { file_path: join("notes", "a.md") } },
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

await test("PermissionRequest：根外路径 → 静默", () => {
  const { base, env } = makeEnv();
  try {
    const result = runHook(
      permissionRequestScript,
      { toolName: "Edit", toolInput: { file_path: join(base, "outside.md") }, cwd: base },
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

await test("PermissionRequest：`..` 穿越 → 静默，绝不 exit 2（deny 语义不可误触）", () => {
  const { base, vault, env } = makeEnv();
  try {
    const result = runHook(
      permissionRequestScript,
      { toolName: "Write", toolInput: { file_path: join("notes", "..", "..", "escape.md") }, cwd: vault },
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

await test("PermissionRequest：非法 stdin / 非目标工具 → 静默且 exit 0", () => {
  const { base, vault, env } = makeEnv();
  try {
    const garbage = runHook(permissionRequestScript, "{not-json", env);
    assert.equal(garbage.status, 0, garbage.stderr);
    assert.equal(garbage.stdout.trim(), "");

    const otherTool = runHook(
      permissionRequestScript,
      { toolName: "Bash", toolInput: { command: "echo hi" }, cwd: vault },
      env,
    );
    assert.equal(otherTool.status, 0, otherTool.stderr);
    assert.equal(otherTool.stdout.trim(), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

await test("UserPromptSubmit：面板焦点 → 注入 <user_vault_context>", () => {
  const { base, vault, dataDir, env } = makeEnv();
  try {
    writeFileSync(
      join(dataDir, "vault-focus.json"),
      `${JSON.stringify(
        {
          version: 1,
          sessions: {
            sess_e2e: {
              rootPath: realpathSync(vault),
              displayName: "E2E Vault",
              focus: { kind: "file", relativePath: "notes/a.md", sequence: 3 },
              openedAt: Date.now(),
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    const result = runHook(userPromptSubmitScript, { session_id: "sess_e2e" }, env);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.additionalContext, /<user_vault_context>/);
    assert.match(output.additionalContext, /工作线索，不是要求自动读取/);
    assert.match(output.additionalContext, /notes\/a\.md/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

await test("UserPromptSubmit：根切换/焦点清除/损坏文件 → 静默", () => {
  const { base, vault, dataDir, env } = makeEnv();
  try {
    const writeFocus = (sessions) =>
      writeFileSync(join(dataDir, "vault-focus.json"), `${JSON.stringify({ version: 1, sessions })}\n`);

    writeFocus({
      sess_e2e: {
        rootPath: "D:\\other-vault",
        displayName: "Other",
        focus: { kind: "file", relativePath: "notes/a.md", sequence: 1 },
        openedAt: Date.now(),
      },
    });
    const rootMismatch = runHook(userPromptSubmitScript, { session_id: "sess_e2e" }, env);
    assert.equal(rootMismatch.status, 0);
    assert.equal(rootMismatch.stdout.trim(), "");

    writeFocus({});
    const cleared = runHook(userPromptSubmitScript, { session_id: "sess_e2e" }, env);
    assert.equal(cleared.status, 0);
    assert.equal(cleared.stdout.trim(), "");

    writeFileSync(join(dataDir, "vault-focus.json"), "{broken");
    const broken = runHook(userPromptSubmitScript, { session_id: "sess_e2e" }, env);
    assert.equal(broken.status, 0);
    assert.equal(broken.stdout.trim(), "");

    assert.ok(vault && base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

process.exitCode = failures ? 1 : 0;
if (failures) console.error(`\n${failures} test(s) failed`);
