// CUA producer 工具层（上游 0.6.3 切段）端到端冒烟：
// 假 helper（NDJSON 42 项协议）验证三条硬契约——
//   1. SDK 工具名 → broker 协议方法翻译（list_apps → list_applications）；
//   2. 连接握手顺序（authenticate → broker_info claim → authenticate → 业务方法）；
//   3. helper 响应 → MCP envelope（content 数组）且应用数据透传。
// 管道名必须匹配 producer peer-check 的 zcode-cua-helper-<hex≥8|default> 命名空间
// （与 services 铸造 helper 管道的 WINDOWS_PIPE_PREFIX 同形，未改名、豁免正确）。
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
// 切段里的 require("express") 在裸 ESM 加载时走全局 require；
// 宿主 esbuild 打包时则被静态解析内联（两条路都通）。
globalThis.require ??= createRequire(import.meta.url);
const { createComputerUseRuntime } = await import("../upstream/zcode-cua-0.6.3.index.js");

const socketPath =
  process.platform === "win32"
    ? `\\\\.\\pipe\\zcode-cua-helper-${randomUUID().replace(/-/g, "")}`
    : join(tmpdir(), `zcode-cua-helper-${randomUUID().replace(/-/g, "")}.sock`);

const received = [];
const server = createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      received.push(msg.method);
      const result =
        msg.method === "list_applications"
          ? { apps: [{ app_key: "app:mock-1", name: "Mock App", pid: 4242 }] }
          : { ok: true };
      socket.write(`${JSON.stringify({ id: msg.id, ok: true, result })}\n`);
    }
  });
  socket.on("error", () => {});
});

await new Promise((resolve, reject) => {
  server.listen(socketPath, () => resolve());
  server.on("error", reject);
});

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed += 1;
};

try {
  const runtime = createComputerUseRuntime({ brokerSocketPath: socketPath, env: {} });
  const result = await runtime.execute({
    toolName: "list_apps",
    arguments: {},
    context: { sessionId: "smoke-session", workspaceKey: "smoke-workspace" },
    signal: undefined,
  });
  check("translate list_apps -> list_applications", received.includes("list_applications"));
  check(
    "handshake order authenticate -> broker_info",
    received[0] === "authenticate" && received.includes("broker_info"),
  );
  check("MCP envelope content array", Array.isArray(result?.content) && result.content.length > 0);
  check("mock app surfaced in result", JSON.stringify(result).includes("app:mock-1"));
} catch (error) {
  check(`execute throws: ${error?.message}`, false);
} finally {
  server.close();
}
if (failed > 0) process.exit(1);
console.log("cua tool-layer smoke passed");
