// Mate UI 候选用例（docs/mate-implementation-plan-2026-11-04/01-p1-detailed-design.md §6
// 场景 1/2/3/4/5）：真实 React 组件与仓库 CSS；服务为 fixture 内存版
// IAssistantTicketService（synthetic），真实 Host/CLI 派发另有 PR-1A 服务侧测试。
// 状态流转由夹具定时器推进（dispatched→running→done，400ms/1400ms）；场景 5 的
// 断连 resync 以 fixture-resync 重推快照模拟（真实断连重订不在 renderer-only 夹具内）。
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
  "MOUI01–06: observe would-accept, dispatch flow, E-appendix, ignore, idempotent, auto-locked + resync",
  { timeout: 180000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "mate-observe-ui-"));
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      // 独立缓存避免并行 worktree 共用 node_modules 时复用其他版本的图标预构建。
      cacheDir: join(output, "vite-cache"),
      // 只扫描本用例入口，避免 legacy 手机壳 HTML 抢先选择它自己的旧版 lucide-react。
      optimizeDeps: { entries: ["packages/ui/test/fixtures/mate-browser.fixture.tsx"] },
      plugins: [
        tailwindcss(),
        {
          name: "mate-ui-fixture",
          configureServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url?.split("?")[0] !== "/mate-ui-test") return next();
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(
                '<!doctype html><html class="theme-zai-light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/packages/ui/test/fixtures/mate-browser.fixture.tsx"></script></body></html>',
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
      const page = await browser.newPage({ viewport: { width: 900, height: 1000 } }),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const address = server.httpServer.address();
      await page.goto(`http://127.0.0.1:${address.port}/mate-ui-test`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByTestId("mate-side-pane").waitFor();

      // MOUI01（01 §6 场景 1）：未指名触发 → MateObserveRow would-accept，零执行、trust 积累。
      // 默认过滤档是「待决策」（观察行不在此档渲染）——先断言不出现，再切「观察中」档断言出现。
      await page.getByTestId("mate-trigger-input").fill("帮我看看构建为什么红了");
      await page.getByTestId("mate-trigger-inferred").click();
      assert.equal(await page.getByTestId("mate-observe-row").count(), 0);
      await page.getByTestId("mate-filter-observe").click();
      await page.getByTestId("mate-observe-row").waitFor();
      assert.match(
        await page.getByTestId("mate-observe-row").textContent(),
        /帮我看看构建为什么红了/,
      );
      assert.match(await page.getByTestId("mate-trust-bar").textContent(), /未指名可接受 1 次/);
      assert.equal(await page.getByTestId("mate-decision-card").count(), 0);
      assert.equal(await page.getByTestId("mate-ticket-row").count(), 0);
      // 后续场景切「全部」档：决策卡/工单组/观察行同屏可见。
      await page.getByTestId("mate-filter-all").click();

      // MOUI02（01 §6 场景 2）：点名触发 → 决策卡（verbatim 原文 + P1 未隔离徽标）→ 放行 →
      // dispatched/running 状态灯 → done 汇报卡（实耗 + output_summary）→ 打开会话落点。
      await page.getByTestId("mate-trigger-input").fill("点名：修复登录页样式回归");
      await page.getByTestId("mate-trigger-explicit").click();
      const card = page.getByTestId("mate-decision-card");
      await card.waitFor();
      assert.match(await card.textContent(), /点名：修复登录页样式回归/);
      assert.match(await card.textContent(), /P1 未隔离/);
      assert.match(await card.textContent(), /build 档/);
      await page.getByTestId("mate-decision-approve").click();
      // 放行即出卡（decided_by=user 契约语义），工单行（dispatched/running 灯）顶上。
      await page.getByTestId("mate-ticket-row").waitFor();
      assert.equal(await page.getByTestId("mate-decision-card").count(), 0);
      await page.getByTestId("mate-report-done").waitFor({ timeout: 10000 });
      const report = await page.getByTestId("mate-report-done").textContent();
      assert.match(report, /完成：fixture 汇报首行摘要/);
      assert.match(report, /128\/456/);
      // 「打开会话」走挂载点 onOpenMateSession（fixture 捕获 sessionId；TR-1/TR-2 占 1、2，
      // 放行建票取 seq=3 → sess-3）。
      await page.getByTestId("mate-report-open-session").click();
      assert.equal(await page.getByTestId("fixture-open-session").textContent(), "sess-3");

      // MOUI03（01 §6 场景 4）：同 decision 二次放行幂等不二派（服务侧 dispatchIndex 语义）。
      await page.getByTestId("fixture-approve-again").click();
      await page.waitForTimeout(500);
      assert.equal(await page.getByTestId("mate-report-done").count(), 1);
      assert.equal(await page.getByTestId("mate-ticket-row").count(), 0);
      assert.equal(await page.getByTestId("mate-decision-card").count(), 0);

      // MOUI04（01 §6 场景 3）：E 追加说明后放行 → brief=原文+追加段两段（原文不改写）。
      await page.getByTestId("mate-trigger-input").fill("点名：E 改单场景");
      await page.getByTestId("mate-trigger-explicit").click();
      await page.getByTestId("mate-decision-card").waitFor();
      await page.getByTestId("mate-decision-edit").click();
      await page.getByTestId("mate-decision-appendix").fill("追加：移动端优先");
      await page.getByTestId("mate-decision-approve-appendix").click();
      await page.getByTestId("mate-report-done").nth(1).waitFor({ timeout: 10000 });
      const appendedBrief = await page.getByTestId("fixture-last-brief").textContent();
      assert.match(appendedBrief, /点名：E 改单场景/);
      assert.match(appendedBrief, /追加：移动端优先/);

      // MOUI05（01 §6 场景 2 的 N 分支）：忽略决策卡 → 记 rejected，不派发不建票。
      await page.getByTestId("mate-trigger-input").fill("点名：忽略分支场景");
      await page.getByTestId("mate-trigger-explicit").click();
      await page.getByTestId("mate-decision-card").waitFor();
      const reportsBeforeIgnore = await page.getByTestId("mate-report-done").count();
      await page.getByTestId("mate-decision-ignore").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-decision-card"]').length === 0,
      );
      assert.equal(await page.getByTestId("mate-report-done").count(), reportsBeforeIgnore);

      // MOUI06（01 §6 场景 5）：auto 恒禁用 + 达标 tooltip；快照 resync 重推后 UI 状态一致。
      assert.equal(await page.getByTestId("mate-mode-auto").isDisabled(), true);
      await page.getByTestId("mate-mode-auto-wrap").hover();
      // ControlHintTooltip 同时渲染可见内容与无障碍副本，strict mode 下取 first。
      // 文案随 P4 信任门落地更新（dfe8742ca：mate.config.mode.auto.locked 改为带口径
      // 提示），本资产断言同步对齐（修复：P4 第一棒改文案后未回归本资产）。
      await page.getByText("信任门达标后开放 auto（放行率与样本数）").first().waitFor();
      const doneCountBeforeResync = await page.getByTestId("mate-report-done").count();
      const observeCountBeforeResync = await page.getByTestId("mate-observe-row").count();
      await page.getByTestId("fixture-resync").click();
      await page.waitForTimeout(300);
      assert.equal(await page.getByTestId("mate-report-done").count(), doneCountBeforeResync);
      assert.equal(await page.getByTestId("mate-observe-row").count(), observeCountBeforeResync);

      assert.deepEqual(errors, []);
      console.log(`Mate UI evidence: ${output}`);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
