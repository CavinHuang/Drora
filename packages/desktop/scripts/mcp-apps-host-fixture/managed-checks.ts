import assert from "node:assert/strict";
import type { BrowserWindow } from "electron";
import type { managedEnvironment } from "./managed-environment.js";
import { checkModel } from "./managed-model-checks.js";
type Environment = Awaited<ReturnType<typeof managedEnvironment>>;
export async function checkManaged(
  env: Environment,
  win: BrowserWindow,
  scope: any,
  check: (name: string, run: () => Promise<void>) => Promise<void>,
) {
  const ui = (code: string) => win.webContents.executeJavaScript(code);
  const page = (code: string) => env.evalPage(win, code);
  const approval = (key: string) => env.agent.approvals.wait((r) => r.params.input?.key === key);
  const executed = (key: string) =>
    env.agent.events.history.filter((e) => e.type === "executed" && e.key === key).length;
  let updates = 0;
  async function notification() {
    env.agent.notify("managed", "fixture://state");
    await page(`window.waitResources(${++updates})`);
  }
  await check("resource subscriptions deduplicate through SDK, real Agent and MCP", async () => {
    await page("Promise.all([window.subscribeFixture(), window.subscribeFixture()])");
    assert.equal(
      env.agent.events.history.filter((e) => e.type === "resources/subscribe").length,
      1,
    );
    await notification();
    assert.deepEqual(await page("window.resourceEvents"), ["fixture://state"]);
  });
  await check(
    "pending approval survives React inline unmount and keeps real resource feed in sidebar",
    async () => {
      const guest = env.guests.get(win.webContents.id)!;
      const before = await ui("window.managedState()");
      await page("window.saveWidget({managed:7})");
      const result = page("window.callTool('managed-approval')");
      const request = await approval("managed-approval");
      for (let n = 0; n < 6; n++) {
        await ui(`window.setAnchors(true, ${n % 2 === 0})`);
        await notification();
      }
      await ui("window.setAnchors(false, true)");
      await notification();
      assert.equal((await ui("window.managedState()")).busy, true);
      await env.agent.respond(request, "allow");
      assert.ok((await result).result);
      assert.equal(executed("managed-approval"), 1);
      const after = await ui("window.managedState()");
      assert.equal(after.handle.sandboxId, before.handle.sandboxId);
      assert.equal(env.guests.get(win.webContents.id)!.id, guest.id);
      assert.deepEqual(after.widget, { managed: 7 });
      assert.equal(after.listeners.frame, 1);
      assert.equal(env.events.history.filter((e) => e.type === "subscribed").length, 1);
      assert.equal(env.agent.events.history.filter((e) => e.type === "read").length, 1);
    },
  );
  await check(
    "PDF and SVG resources cross the real SDK, Agent and MCP with MIME guards intact",
    async () => {
      const pdfUri = "fixture://document.pdf";
      const pdf = await page(`window.readResourceFixture(${JSON.stringify(pdfUri)})`);
      assert.deepEqual(
        pdf.result?.contents,
        [
          {
            uri: pdfUri,
            mimeType: "application/pdf",
            blob: Buffer.from("%PDF-1.7\n%%EOF\n").toString("base64"),
          },
        ],
        JSON.stringify(pdf),
      );
      const rejected = await page("window.readResourceFixture('fixture://unsupported.bin')");
      // 测试 IPC 的异常只保留 message，页面侧核对拒绝原因；结构化 reason 由 Agent 单测覆盖。
      assert.match(rejected.error ?? "", /application\/x-msdownload.*not allowed/);
      const svg = await page("window.readResourceFixture('fixture://vector.svg')");
      assert.deepEqual(
        svg.result?.contents,
        [
          {
            uri: "fixture://vector.svg",
            mimeType: "image/svg+xml",
            text: '<svg xmlns="http://www.w3.org/2000/svg"/>',
          },
        ],
        JSON.stringify(svg),
      );
      assert.equal((await ui("window.managedState()")).phase, "running");
      for (const uri of [pdfUri, "fixture://unsupported.bin", "fixture://vector.svg"]) {
        assert.equal(
          env.agent.events.history.filter((e) => e.type === "read" && e.uri === uri).length,
          1,
        );
      }
    },
  );
  await check(
    "all anchors unmounted plus expired retention keeps MCP guest and resource feed after completion",
    async () => {
      const step = (stage: string) => env.events.emit({ type: "retention-step", stage });
      const guest = env.guests.get(win.webContents.id)!;
      const result = page("window.callTool('managed-background', true)");
      await env.agent.respond(await approval("managed-background"), "allow");
      await env.agent.events.wait((e) => e.type === "executed" && e.key === "managed-background");
      step("tool-running");
      await ui("window.setAnchors(false, false)");
      step("anchors-unmounted");
      await notification();
      step("background-notification");
      await ui("window.expireOffscreen()");
      assert.equal(guest.isDestroyed(), false);
      assert.equal(env.countGuests(), 1);
      env.agent.release("managed", "managed-background");
      assert.ok((await result).result);
      step("tool-completed");
      assert.equal(await ui("window.suspendManaged()"), false);
      assert.equal(guest.isDestroyed(), false);
      await notification();
      step("idle-notification");
      assert.equal(env.countGuests(), 1);
      assert.equal(executed("managed-background"), 1);
    },
  );
  await check(
    "production owner retains snapshot and guest after idle and retry clears only widgetState",
    async () => {
      const retained = env.guests.get(win.webContents.id)!;
      await ui("window.setAnchors(true, false)");
      assert.notEqual(
        (await ui("window.managedState()")).actual?.phase,
        "error",
        JSON.stringify(await ui("window.managedState()")),
      );
      assert.equal(env.guests.get(win.webContents.id), retained);
      await page("window.fixtureReady");
      // guest 没有重建，初始化 hostContext 不会重发；保存快照仍由宿主内存 store 持有。
      assert.deepEqual((await ui("window.managedState()")).widget, { managed: 7 });
      await page("window.storageRoundTrip(true)");
      const old = env.guests.get(win.webContents.id)!;
      const offset = env.events.history.length;
      await ui("window.retryManaged()");
      await env.events.wait((e) => e.type === "phase" && e.phase === "running", offset);
      await page("window.fixtureReady");
      assert.equal(old.isDestroyed(), true);
      assert.equal(await page("window.readWidget()"), null);
      assert.deepEqual(await page("window.storageRoundTrip(false)"), { local: "42", indexed: 42 });
      assert.equal((await ui("window.managedState()")).listeners.ports, 1);
    },
  );
  await check(
    "inline page stays in the scrolling container without frame-delayed movement",
    async () => {
      await ui("window.setAnchors(true, false)");
      const samples = await ui(`(async () => {
      const scroller = document.querySelector('#inline-scroll');
      const view = document.querySelector('webview');
      if (!view.closest('[data-sandbox-page-container]')) throw new Error('page outside scroll tree');
      const initial = view.getBoundingClientRect().top + scroller.scrollTop;
      const errors = [];
      for (const offset of [0, 40, 180, 60, 260, 0]) {
        scroller.scrollTop = offset;
        errors.push(Math.abs(view.getBoundingClientRect().top + scroller.scrollTop - initial));
        await new Promise(requestAnimationFrame);
        errors.push(Math.abs(view.getBoundingClientRect().top + scroller.scrollTop - initial));
      }
      return errors;
    })()`);
      assert.ok(
        samples.every((error: number) => error < 1),
        JSON.stringify(samples),
      );
    },
  );
  await check(
    "real scroll observation removes inline visibility while sidebar remains protected",
    async () => {
      await ui(
        "document.querySelector('#inline-scroll').scrollTop = 900; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      assert.equal((await ui("window.managedState()")).visible, false);
      await ui("window.setAnchors(true, true)");
      assert.equal((await ui("window.managedState()")).visible, true);
      await ui("window.expireOffscreen()");
      assert.equal(env.countGuests(), 1);
    },
  );
  await checkModel(env, win, scope, check);
  await check(
    "g9 host action bridge round-trips three actions, capability gate and openWith delivery",
    async () => {
      // 能力宣告（声明与 handler 一一对应）：fixture 注入 handoff/navigate + 平台 selectDirectory，
      // 三动作都应宣告；g4 hostContext 只读键与标准位同源。
      const capabilities = (await page("window.hostActionCapability()")) as {
        actions?: string[];
      };
      assert.deepEqual(
        (capabilities?.actions ?? []).slice().sort(),
        ["navigate", "openConversationHandoff", "openDirectoryPicker"],
        JSON.stringify(capabilities),
      );
      const context = (await page("window.displayContext()")) as Record<string, unknown>;
      assert.equal(context["drora/theme"], context.theme);
      assert.equal(context["drora/locale"], context.locale);
      // 页面→宿主：handoff（composer 投递回调记录）+ directoryPicker（平台缺省实现）+ navigate。
      const handoffResult = await page("window.openConversationHandoff()");
      assert.ok(!(handoffResult as { error?: string }).error, JSON.stringify(handoffResult));
      const handoff = env.events.history.filter(
        (e) => (e as { type?: string; action?: string }).action === "openConversationHandoff",
      );
      assert.equal(handoff.length, 1, JSON.stringify(handoff));
      assert.deepEqual((handoff[0] as { payload?: unknown }).payload, {
        content: [{ type: "text", text: "handoff-fixture" }],
      });
      assert.deepEqual(await page("window.selectDirectory()"), {
        result: { path: "/fixture/vault" },
      });
      const navigateResult = await page("window.navigateFixture('vault')");
      assert.ok(!(navigateResult as { error?: string }).error, JSON.stringify(navigateResult));
      const navigated = env.events.history.filter(
        (e) => (e as { type?: string; action?: string }).action === "navigate",
      );
      assert.equal(navigated.length, 1, JSON.stringify(navigated));
      assert.deepEqual((navigated[0] as { target?: unknown }).target, {
        kind: "surface",
        surfaceId: "vault",
        payload: { receiptId: "vault-receipt" },
      });
      // 宿主→面板：openWith 通知经页面管理器定向投递，页面 onOpenWith 收到同一载荷。
      await ui("window.notifyOpenWith({receiptId:'citation-42'})");
      await page("window.waitOpenWith(1)");
      assert.deepEqual(await page("window.openWithEvents"), [{ receiptId: "citation-42" }]);
    },
  );
  await check(
    "runtime unavailable during approval releases page and rejects late permission",
    async () => {
      const guest = env.guests.get(win.webContents.id)!;
      const result = page("window.callTool('managed-runtime')").catch((error) => ({
        error: String(error),
      }));
      const request = await approval("managed-runtime");
      const stopped = new Promise<void>((resolve) => guest.once("destroyed", resolve));
      await ui("window.runtimeUnavailable()");
      await stopped;
      assert.ok((await result).error);
      await env.agent.respond(request, "allow");
      assert.equal(executed("managed-runtime"), 0);
      assert.equal((await ui("window.managedState()")).phase, "error");
      await assert.rejects(() =>
        env.agent.call("mcp/uiValidateInstance", {
          ...scope,
          instance: env.handles.get(win.webContents.id).instance,
        }),
      );
    },
  );
}
