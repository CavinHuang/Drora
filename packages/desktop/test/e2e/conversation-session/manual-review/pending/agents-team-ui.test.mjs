// ATUI01–03：真实 React 组件与仓库 CSS；renderer-only，不代表 Host/恢复 E2E。
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
  "ATUI01–03 collaboration evidence, navigation scope, responsive themes and states",
  { timeout: 180000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "agents-team-ui-"));
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      plugins: [
        tailwindcss(),
        {
          name: "team-ui-fixture",
          configureServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url !== "/team-ui-test") return next();
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
      const address = server.httpServer.address();
      await page.goto(`http://127.0.0.1:${address.port}/team-ui-test`);
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
      await evidence.getByRole("button").click();
      assert.match(await page.getByTestId("fixture-member").textContent(), /Frontend/);
      await page.getByTestId("fixture-member-back").click();
      assert.equal(
        await page.getByTestId("team-layer-messages").getAttribute("aria-pressed"),
        "true",
      );
      await page.getByTestId("team-layer-handoffs").click();
      assert.match(await page.getByTestId("team-relations-empty").textContent(), /尚未提供/);
      await page.getByTestId("fixture-active").click();
      await page.getByTestId("team-layer-messages").click();
      for (const width of [1060, 352])
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
        }
      await page.getByTestId("fixture-readonly").click();
      const summary = page.getByTestId("team-conversation-summary");
      await summary.getByRole("button", { name: "查看协作详情", exact: true }).click();
      assert.equal(await summary.getByTestId("team-collaboration").isVisible(), true);
      await summary.getByRole("button", { name: "查看协作详情", exact: true }).click();
      const touch = await browser.newPage({
        viewport: { width: 352, height: 1000 },
        isMobile: true,
        hasTouch: true,
      });
      await touch.goto(page.url());
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
      assert.deepEqual(errors, []);
      console.log(`Team UI evidence: ${output}`);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
