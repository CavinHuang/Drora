// ATUI01–11：真实 React 组件与仓库 CSS；历史 ACK 为 synthetic，journal 数据另有 core 集成测试。
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { default: tailwindcss } = await import(
  pathToFileURL(require.resolve("@tailwindcss/vite")).href
);

test(
  "ATUI01–11 conversation-first navigation, saved history, stale ACKs and responsive states",
  { timeout: 180000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "agents-team-ui-"));
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      // 独立缓存避免并行 worktree 共用 node_modules 时复用其他版本的图标预构建。
      cacheDir: join(output, "vite-cache"),
      // 只扫描本用例入口，避免 legacy 手机壳 HTML 抢先选择它自己的旧版 lucide-react。
      optimizeDeps: { entries: ["packages/ui/test/fixtures/agents-team-browser.fixture.tsx"] },
      plugins: [
        tailwindcss(),
        {
          name: "team-ui-fixture",
          configureServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url?.split("?")[0] !== "/team-ui-test") return next();
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(
                '<!doctype html><html class="theme-zai-light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}.fixture-layout{display:grid;grid-template-columns:190px minmax(0,1fr) 340px;min-height:700px}@media(max-width:700px){.fixture-layout{grid-template-columns:minmax(0,1fr)}}</style></head><body><div id="root"></div><script type="module" src="/packages/ui/test/fixtures/agents-team-browser.fixture.tsx"></script></body></html>',
              );
            });
          },
        },
      ],
      resolve: { alias: { "@": join(process.cwd(), "packages/ui/src") } },
      esbuild: { jsx: "automatic" },
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "error",
    });
    await server.listen();
    let browser;
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
      const page = await browser.newPage({ viewport: { width: 1060, height: 1000 } }),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && /cannot.*(?:descendant|nested)/.test(message.text()))
          errors.push(message.text());
      });
      const address = server.httpServer.address();
      await page.goto(`http://127.0.0.1:${address.port}/team-ui-test`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByTestId("team-session-line").waitFor();
      await page.getByTestId("team-session-line").click();
      const navigation = JSON.parse(await page.getByTestId("fixture-navigation").textContent());
      assert.deepEqual(navigation, {
        workspacePath: "/same-path",
        workspaceIdentity: "host-a/workspace-id",
        remoteSessionId: "remote-attachment",
        parentSessionId: "lead-session",
      });
      assert.match(await page.getByTestId("team-conversation-summary").textContent(), /2\/5/);
      assert.equal(
        await page.getByTestId("team-view-overview").getAttribute("aria-pressed"),
        "true",
      );
      await page.getByTestId("team-session-members-toggle").click();
      await page.getByTestId("team-session-member").filter({ hasText: "Frontend" }).click();
      assert.match(await page.getByTestId("team-selection-details").textContent(), /Frontend/);
      assert.deepEqual(JSON.parse(await page.getByTestId("fixture-navigation").textContent()), {
        ...navigation,
        focus: { teamId: "team-ui", kind: "member", id: "a" },
      });
      await page
        .getByTestId("team-selection-details")
        .getByRole("button", { name: "T3 · 团队任务板" })
        .click();
      await page.getByTestId("team-task-dependency").click();
      assert.match(await page.getByTestId("team-selection-details").textContent(), /方案审查/);
      await page.getByTestId("team-details-back").click();
      await page.getByTestId("team-open-message").last().click();
      assert.match(await page.getByTestId("team-selection-details").textContent(), /attempt-a2/);
      await page.getByTestId("team-message-task").click();
      assert.match(await page.getByTestId("team-selection-details").textContent(), /团队任务板/);
      await page.getByTestId("team-details-back").click();
      await page.getByTestId("team-view-process").click();
      await page.getByTestId("team-history-entry").first().waitFor();
      assert.equal(await page.getByTestId("team-history-entry").count(), 20);
      assert.match(await page.getByTestId("team-history-entry").first().textContent(), /#26/);
      await page
        .getByTestId("team-history-entry")
        .filter({ hasText: "#44" })
        .locator("summary")
        .click();
      assert.match(
        await page.getByTestId("team-history-entry").filter({ hasText: "#44" }).textContent(),
        /saved-message-team-ui/,
      );
      await page.getByTestId("team-history-older").click();
      await page.getByTestId("team-history-entry").filter({ hasText: "#6" }).first().waitFor();
      assert.match(await page.getByTestId("team-history-entry").first().textContent(), /#6/);
      await page.getByTestId("team-history-older").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="team-history-entry"]').length === 5,
      );
      assert.equal(await page.getByTestId("team-history-older").count(), 0);
      await page.getByTestId("fixture-history-error").click();
      await page.getByTestId("team-history-error").waitFor();
      await page.getByTestId("fixture-history-ok").click();
      await page.getByTestId("team-history-entry").first().waitFor();
      const beforeReopen = Number(await page.getByTestId("fixture-history-queries").textContent());
      await page.getByTestId("fixture-reopen").click();
      assert.equal(await page.getByTestId("team-workspace-views").count(), 0);
      await page.getByTestId("fixture-reopen").click();
      await page.getByTestId("team-view-process").click();
      await page.getByTestId("team-history-entry").first().waitFor();
      assert.ok(
        Number(await page.getByTestId("fixture-history-queries").textContent()) > beforeReopen,
      );
      await page.getByTestId("fixture-history-deferred").click();
      await page.getByRole("status").filter({ hasText: "正在加载" }).waitFor();
      await page.getByTestId("fixture-next-team").click();
      await page.getByTestId("team-view-process").click();
      await page.getByTestId("team-history-entry").first().waitFor();
      await page.getByTestId("fixture-history-release").click();
      await page.getByTestId("team-history-entry").first().locator("summary").click();
      assert.match(
        await page.getByTestId("team-history-entry").first().textContent(),
        /saved-team-ui-next/,
      );
      await page.getByTestId("fixture-active").click();
      await page.getByTestId("team-view-collaboration").click();
      const evidence = page.getByTestId("team-relation-evidence");
      assert.match(await evidence.textContent(), /待投递/);
      assert.match(await evidence.textContent(), /attempt-a2/);
      await page.getByTestId("team-layer-dependencies").click();
      await page
        .getByTestId("team-relation-row")
        .filter({ hasText: "团队任务板 → 联调验收" })
        .click();
      assert.match(await evidence.textContent(), /等待前置/);
      await page.getByTestId("fixture-failed").click();
      assert.match(await evidence.textContent(), /等待前置/);
      await page.getByTestId("team-layer-messages").click();
      await evidence.getByRole("button", { name: "查看成员", exact: true }).click();
      await page.getByTestId("team-transcript-open").click();
      assert.match(await page.getByTestId("fixture-member").textContent(), /Frontend/);
      await page.getByTestId("fixture-member-back").click();
      await page.getByTestId("team-details-back").click();
      assert.equal(
        await page.getByTestId("team-layer-messages").getAttribute("aria-pressed"),
        "true",
      );
      await page.getByTestId("team-layer-handoffs").click();
      assert.match(await page.getByTestId("team-relations-empty").textContent(), /尚未提供/);
      await page.getByTestId("fixture-active").click();
      await page.getByTestId("team-layer-messages").click();
      for (const width of [1024, 736, 390])
        for (const dark of [false, true]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((d) => {
            document.documentElement.className = d ? "theme-zai-dark dark" : "theme-zai-light";
          }, dark);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            true,
          );
          const bounds = await page.getByTestId("team-relation-graph").boundingBox();
          assert.ok(bounds.width > 200);
          await page.screenshot({
            path: join(output, `${width}-${dark ? "dark" : "light"}.png`),
            fullPage: true,
          });
          await page.getByTestId("team-view-overview").click();
          await page.screenshot({
            path: join(output, `overview-${width}-${dark ? "dark" : "light"}.png`),
            fullPage: true,
          });
          await page.getByTestId("team-view-collaboration").click();
        }
      await page.getByTestId("team-view-overview").click();
      await page.getByTestId("team-board-toggle").click();
      assert.ok((await page.getByTestId("team-member-card").count()) > 0);
      await page.getByRole("button", { name: "任务", exact: true }).click();
      await page.getByTestId("fixture-readonly").click();
      const summary = page.getByTestId("team-conversation-summary");
      await summary.getByRole("button", { name: "查看协作详情", exact: true }).click();
      assert.equal(await summary.getByTestId("team-overview").isVisible(), true);
      assert.equal(await summary.getByTestId("team-board-toggle").count(), 0);
      await summary.getByRole("button", { name: "查看协作详情", exact: true }).click();
      const touch = await browser.newPage({
        viewport: { width: 352, height: 1000 },
        isMobile: true,
        hasTouch: true,
      });
      await touch.goto(page.url());
      await touch.getByTestId("team-view-collaboration").click();
      await touch.getByTestId("team-layer-messages").waitFor();
      assert.ok((await touch.getByTestId("team-layer-messages").boundingBox()).height >= 44);
      await touch.close();
      await page.getByTestId("fixture-idle").click();
      assert.match(await page.getByTestId("team-conversation-summary").textContent(), /空闲/);
      assert.match(await page.getByTestId("team-conversation-summary").textContent(), /5\/5/);
      await page.getByTestId("fixture-staged").click();
      assert.equal(await page.getByTestId("team-collaboration").count(), 0);
      assert.match(await page.getByTestId("team-conversation-summary").textContent(), /拟定成员/);
      await page.getByTestId("fixture-locale").click();
      assert.match(
        await page.getByTestId("team-conversation-summary").textContent(),
        /planned members/,
      );
      // ATUI11：真实远控入口 + 当前服务代理；不是直接给 Summary 注入假的 connection。
      await page.goto(`http://127.0.0.1:${address.port}/team-ui-test?remote`, {
        waitUntil: "domcontentloaded",
      });
      const remoteSummary = page.getByTestId("team-conversation-summary");
      await page.getByTestId("remote-task-row").waitFor();
      assert.equal(await page.getByTestId("remote-task-row").locator("button").count(), 0);
      await page.getByTestId("remote-task-row").click();
      assert.equal(await page.getByTestId("remote-opened").textContent(), "1");
      await remoteSummary.getByRole("button", { name: "查看协作详情", exact: true }).click();
      assert.equal(await remoteSummary.getByTestId("team-board-toggle").count(), 0);
      await remoteSummary.getByTestId("team-view-process").click();
      await remoteSummary.getByTestId("team-history-error").waitFor();
      await page.getByTestId("remote-recover").click();
      await remoteSummary.getByRole("button", { name: "重试", exact: true }).click();
      await remoteSummary.getByTestId("team-history-entry").waitFor();
      await remoteSummary.locator("summary").click();
      assert.match(
        await remoteSummary.getByTestId("team-history-entry").textContent(),
        /Saved scope a/,
      );
      const requests = JSON.parse(await page.getByTestId("remote-requests").textContent());
      assert.equal(requests.length, 2);
      assert.ok(
        requests.every(
          (request) =>
            request.workspacePath === "/same-path" &&
            request.workspaceIdentity === "host-a/team-workspace" &&
            request.envelope.sessionId === "lead-a" &&
            request.envelope.type === "getTeamHistory",
        ),
      );
      await page.getByTestId("remote-delay").click();
      await remoteSummary.getByRole("button", { name: "最近记录", exact: true }).click();
      await remoteSummary.getByRole("status").waitFor();
      await page.getByTestId("remote-switch").click();
      await remoteSummary.getByRole("button", { name: "查看协作详情", exact: true }).click();
      await remoteSummary.getByTestId("team-view-process").click();
      await remoteSummary.getByTestId("team-history-entry").waitFor();
      await remoteSummary.locator("summary").click();
      await page.getByTestId("remote-release").click();
      assert.match(
        await remoteSummary.getByTestId("team-history-entry").textContent(),
        /Saved scope b/,
      );
      const lastRequest = JSON.parse(await page.getByTestId("remote-requests").textContent()).at(
        -1,
      );
      assert.equal(lastRequest.workspaceIdentity, "host-b/team-workspace");
      assert.equal(lastRequest.envelope.sessionId, "lead-b");
      assert.deepEqual(errors, []);
      console.log(`Team UI evidence: ${output}`);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
