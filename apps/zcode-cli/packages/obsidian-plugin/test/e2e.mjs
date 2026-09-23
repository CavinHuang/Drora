// Obsidian 插件 MCP stdio E2E：spawn dist/mcp/server.js，走真实 JSON-RPC 协议，
// 验证 spec 验收场景 1/6/8（未配置→配置→门控→读写→列表→改名→删除→图片）。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const serverPath = join(packageRoot, "..", "dist", "mcp", "server.js");
const dataDir = mkdtempSync(join(tmpdir(), "obsidian-e2e-"));

const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const child = spawn(process.execPath, [serverPath], {
  env: { ...process.env, OBSIDIAN_PLUGIN_DATA: dataDir },
  stdio: ["pipe", "pipe", "pipe"],
});

const pending = new Map();
let nextId = 1;
let buffered = "";

child.stdout.setEncoding("utf-8");
child.stdout.on("data", (chunk) => {
  buffered += chunk;
  let newlineIndex;
  while ((newlineIndex = buffered.indexOf("\n")) >= 0) {
    const line = buffered.slice(0, newlineIndex).trim();
    buffered = buffered.slice(newlineIndex + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  }
});

let stderrText = "";
child.stderr.setEncoding("utf-8");
child.stderr.on("data", (chunk) => {
  stderrText += chunk;
});

function request(method, params) {
  const id = nextId++;
  const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(new Error(`timeout waiting for ${method}; stderr: ${stderrText}`));
    }, 15_000);
    pending.set(id, (message_) => {
      clearTimeout(timer);
      resolvePromise(message_);
    });
    child.stdin.write(message + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function textOf(result) {
  return result.content?.map((block) => block.text ?? "").join("\n") ?? "";
}

async function callTool(name, args, expectError = false) {
  const response = await request("tools/call", { name, arguments: args ?? {} });
  const result = response.result;
  assert.ok(result, `tools/call ${name} 缺少 result: ${JSON.stringify(response)}`);
  if (expectError) {
    assert.equal(result.isError, true, `${name} 应返回工具错误`);
    return { isError: true, text: textOf(result) };
  }
  assert.notEqual(result.isError, true, `${name} 不应报错: ${textOf(result)}`);
  return { isError: false, json: JSON.parse(textOf(result)), text: textOf(result) };
}

let passed = 0;
const failures = [];
async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

try {
  const initialized = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "obsidian-e2e", version: "0.0.0" },
  });
  assert.equal(initialized.result?.serverInfo?.name, "obsidian", "serverInfo.name 应为 obsidian");
  notify("notifications/initialized", {});

  await step("tools/list 包含全部 11 个工具", async () => {
    const response = await request("tools/list", {});
    const names = response.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "obsidian_configure_vault",
      "obsidian_create_folder",
      "obsidian_create_note",
      "obsidian_delete_file",
      "obsidian_list_files",
      "obsidian_read_file",
      "obsidian_rename_file",
      "obsidian_resolve_media",
      "obsidian_save_pasted_image",
      "obsidian_status",
      "obsidian_write_file",
    ]);
  });

  await step("验收1：未配置态 status 返回 null + 托管 Vault 路径", async () => {
    const status = await callTool("obsidian_status");
    assert.equal(status.json.configured, null);
    assert.ok(status.json.managedVaultPath.includes("managed-vault"));
  });

  await step("验收6a：allow_agent_writes=false 时写操作被门控拒绝", async () => {
    const configured = await callTool("obsidian_configure_vault", { managed: true });
    assert.equal(configured.json.configured.allowAgentWrites, false);
    const rejected = await callTool("obsidian_write_file", { relative_path: "a.md", content: "x" }, true);
    assert.match(rejected.text, /allow_agent_writes=true/);
    const rejectedNote = await callTool("obsidian_create_note", { content: "x" }, true);
    assert.match(rejectedNote.text, /allow_agent_writes=true/);
  });

  await step("验收6b：开启写入后 create/read/write/list 全链路可用", async () => {
    const reconfigured = await callTool("obsidian_configure_vault", { managed: true, allow_agent_writes: true });
    assert.equal(reconfigured.json.configured.allowAgentWrites, true);
    const created = await callTool("obsidian_create_note", { content: "# Hello" });
    assert.match(created.json.relativePath, /^Inbox\/Untitled \d{4}-\d{2}-\d{2}\.md$/);
    const notePath = created.json.relativePath;

    const read = await callTool("obsidian_read_file", { relative_path: notePath });
    assert.equal(read.json.content, "# Hello");

    const conflict = await callTool("obsidian_write_file", {
      relative_path: notePath,
      content: "wrong",
      expected_sha256: "0".repeat(64),
    });
    assert.equal(conflict.json.ok, false);
    assert.equal(conflict.json.reason, "conflict");

    const updated = await callTool("obsidian_write_file", {
      relative_path: notePath,
      content: "# Hello v2",
      expected_sha256: read.json.sha256,
    });
    assert.equal(updated.json.ok, true);

    const listed = await callTool("obsidian_list_files");
    const paths = listed.json.entries.map((entry) => entry.relativePath);
    assert.ok(paths.includes(notePath), `列表应包含 ${notePath}`);

    await step("验收7e2e：伪造 PNG 拒绝、真实 PNG 落盘 assets/", async () => {
      const fake = await callTool(
        "obsidian_save_pasted_image",
        { note_relative_path: notePath, mime_type: "image/png", base64: Buffer.from("junk").toString("base64") },
        true,
      );
      assert.match(fake.text, /图片数据非法/);
      const saved = await callTool("obsidian_save_pasted_image", {
        note_relative_path: notePath,
        mime_type: "image/png",
        base64: PNG_1X1_BASE64,
      });
      assert.ok(saved.json.src.startsWith("assets/pasted-image-"));
    });

    await step("改名与删除走通，删除后文件消失", async () => {
      const renamed = await callTool("obsidian_rename_file", {
        relative_path: notePath,
        name: "Renamed Note",
        expected_sha256: updated.json.sha256,
      });
      assert.ok(renamed.json.relativePath.endsWith("Renamed Note.md"));
      await callTool("obsidian_delete_file", { relative_path: renamed.json.relativePath });
      const after = await callTool("obsidian_list_files");
      assert.ok(!after.json.entries.some((entry) => entry.relativePath === renamed.json.relativePath));
    });
  });

  await step("验收2e2e：逃逸路径在工具面被拒绝", async () => {
    const rejected = await callTool("obsidian_read_file", { relative_path: "../../escape.md" }, true);
    assert.match(rejected.text, /上级目录|绝对路径/);
  });
} finally {
  child.kill();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (!existsSync(join(dataDir, "vault-config.json"))) {
  console.error("FAIL 配置文件未落盘");
  failures.push("config persisted");
}
rmSync(dataDir, { recursive: true, force: true });
if (failures.length > 0) process.exit(1);
