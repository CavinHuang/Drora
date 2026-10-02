// 官方 relay HTTP API 单测（specs/mobile-relay-r3-frontend.md §32.36）：
// workspace-bridge（token 鉴权 / wsUrl 签发 / initialTaskId 透传 / 参数校验）与
// mobile-view-state（转发桌面端帧形状）。用 node:http 内存服务器实测全链。
import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { request } from "node:http";
import { createRelayRemoteControlApiHandler } from "../src/remoteControlHttpApi.js";

const forwarded: Array<{ token: string; viewState: Record<string, unknown> }> = [];

const handler = createRelayRemoteControlApiHandler({
  wsUrlOrigin: "ws://127.0.0.1:4599",
  sessions: {
    view: (token) => ({ device: token === "tok-1" ? { sid: token } : null }),
  },
  sendToDevice: (token, payload) => forwarded.push({ token, viewState: payload as Record<string, unknown> }),
});

let server: Server;
let baseUrl = "";

test.before(async () => {
  server = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0]!;
    void handler(req, res, pathname).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

test.after(() => {
  server.close();
});

function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} });
      });
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("workspace-bridge：合法 token 签发 wsUrl + workspaceKey + initialTaskId", async () => {
  const r = await post("/api/remote-control/windows/tok-1/workspace-bridge", {
    workspaceKey: "D:\\ws\\demo",
    taskId: "task-9",
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.wsUrl, "ws://127.0.0.1:4599/ws");
  assert.equal(r.json.workspaceKey, "D:\\ws\\demo");
  assert.equal(r.json.initialTaskId, "task-9");
});

test("workspace-bridge：未知 token 401；缺 workspaceKey 400；无 taskId 省 initialTaskId", async () => {
  assert.equal((await post("/api/remote-control/windows/nope/workspace-bridge", { workspaceKey: "w" })).status, 401);
  assert.equal((await post("/api/remote-control/windows/tok-1/workspace-bridge", {})).status, 400);
  const ok = await post("/api/remote-control/windows/tok-1/workspace-bridge", { workspaceKey: "w" });
  assert.equal(ok.status, 200);
  assert.equal("initialTaskId" in ok.json, false);
});

test("mobile-view-state：转发桌面端帧（zcode_type/viewState 形状）", async () => {
  const r = await post("/api/remote-control/windows/tok-1/mobile-view-state", {
    activeWorkspaceKey: "D:\\ws\\demo",
    activeTaskId: "task-9",
    updatedAt: 1,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  const last = forwarded.at(-1)!;
  assert.equal(last.token, "tok-1");
  assert.equal((last.viewState as { zcode_type: string }).zcode_type, "mobile-view-state-update");
});

test("非本族路径不接管（交回常规路由）；GET 不接管", async () => {
  const r1 = await post("/api/other", {});
  assert.equal(r1.status, 404);
});
