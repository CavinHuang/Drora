// Mate P4 第二棒验收（docs/mate-implementation-plan-2026-11-04/04-p4-detailed-design.md
// §3 汇报卡完整版 / §4 配额中心 UI / §5 验收 3·4 场景的 UI 侧）：真实 React 组件与仓库
// CSS；服务为 fixture 内存版 IAssistantTicketService（synthetic）。工件核验/汇总判定在
// host 侧（services reportCompletion/quotaCenter），renderer 夹具按同构语义模拟：
// - fixture-await-next：下一次终局进核验滞留（awaiting_output+按代成本投影），真实
//   「turn ended+只读核验」矩阵由 assistantP4Report.test.ts 单测锁定；
// - fixture-push-reports/inject-notice：超额聚合与 watchdog 通知区投影源；
// - 气泡闸（MatePetSync）走真实 admitDisturbance 判定通道（fixture 内存版）——
//   fail-closed 语义在本资产 MRP06 实测。
// 真实 Host 端到端（工件核验 git 链路、watchdog 定时轮、手机快照）随总闸联调验收
// （specs §14 P4 验收行）。P1-P3 资产（mate-observe-ui / mate-surface-ac /
// mate-source-pet）同 fixture 向后兼容，回归随本批实跑。
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
  "MRP01–07: quota strip, awaiting card + manual confirm, unconfirmed increment banner, per-generation cost + evidence full, digest card (notices + pending digest + receipt), bubble gate fail-closed, i18n",
  { timeout: 240000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "mate-p4-ui-"));
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: join(output, "vite-cache"),
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
      const page = await browser.newPage({ viewport: { width: 480, height: 900 } }),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const address = server.httpServer.address();
      await page.goto(`http://127.0.0.1:${address.port}/mate-ui-test`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByTestId("mate-side-pane").waitFor();

      // MRP01（04 §4 状态条配额行）：mode 徽标+计数之外补配额行（当日累计/生效配额/余量；
      // 手机宽 480 单列下 flex-wrap 折行呈现）。
      const strip = page.getByTestId("mate-status-strip");
      await strip.waitFor();
      const quotaLine = page.getByTestId("mate-status-quota");
      assert.match(await quotaLine.textContent(), /今日打扰 0\/5/);
      assert.match(await quotaLine.textContent(), /余 5/);

      // MRP02（04 §3 工件核验滞留面）：awaiting_output → 汇报卡核验滞留面（滞留提示+
      // 「人工确认交付」）；确认 → 快照推送收敛切 done 面（真实核验矩阵在 host 侧单测）。
      await page.getByTestId("mate-filter-all").click();
      await page.getByTestId("fixture-await-next").click();
      await page.getByTestId("fixture-inject-dispatch").click();
      await page.getByTestId("mate-decision-card").waitFor();
      await page.getByTestId("mate-decision-approve").click();
      const awaitingCard = page.getByTestId("mate-report-awaiting");
      await awaitingCard.waitFor({ timeout: 15000 });
      assert.match(await awaitingCard.textContent(), /产出待核验/);
      assert.match(await awaitingCard.textContent(), /人工确认交付/);
      assert.match(await awaitingCard.textContent(), /实耗 tokens 96\/300/);
      await page.getByTestId("mate-report-confirm-output").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-report-awaiting"]').length === 0,
      );
      assert.ok(
        (await page.getByTestId("mate-report-done").count()) >= 1,
        "confirmed awaiting card settles into done card",
      );

      // MRP03（04 §3 未确认增量行）：换代工单 done → 「第 2 代重启，第 1 代末尾改动
      // 未确认」横幅常驻 → 确认增量 → 横幅出清（列置位后不再出现）。
      await page.getByTestId("fixture-rollover-next").click();
      await page.getByTestId("fixture-inject-dispatch").click();
      await page.getByTestId("mate-decision-card").waitFor();
      await page.getByTestId("mate-decision-approve").click();
      const genCard = page.locator('[data-testid="mate-report-done"]', {
        has: page.getByTestId("mate-report-increment"),
      });
      await genCard.waitFor({ timeout: 15000 });
      assert.match(await page.getByTestId("mate-report-increment").textContent(), /第 2 代重启/);
      assert.match(await page.getByTestId("mate-report-increment").textContent(), /第 1 代末尾改动未确认/);
      await page.getByTestId("mate-report-increment-confirm").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-report-increment"]').length === 0,
      );

      // MRP04（04 §3 按代成本+证据页签全量）：详情成本页=分代行（第 1/第 2 代，Σ=合计）；
      // 证据页=brief 原文（全量）+ 工件（workspace 域诚实降级「无 git 工件」）。
      // 定位=带代际徽标的 done 卡（MRP03 的第 2 代工单；终态推进时序确定性靠徽标过滤）。
      const genDoneCard = page.locator('[data-testid="mate-report-done"]', {
        has: page.getByTestId("mate-report-generation"),
      });
      assert.equal(await genDoneCard.count(), 1);
      await genDoneCard.getByTestId("mate-report-detail").click();
      await page.getByTestId("mate-ticket-detail").waitFor();
      await page.getByTestId("mate-detail-tab-cost").click();
      const cost = page.getByTestId("mate-detail-cost");
      await page.getByTestId("mate-detail-cost-generations").waitFor();
      assert.match(await cost.textContent(), /第 1 代/);
      assert.match(await cost.textContent(), /第 2 代/);
      assert.match(await cost.textContent(), /64\/200/);
      assert.doesNotMatch(await cost.textContent(), /按代分解随 P4/);
      await page.getByTestId("mate-detail-tab-evidence").click();
      const evidence = page.getByTestId("mate-detail-evidence");
      assert.match(await evidence.textContent(), /brief 原文（全量）/);
      assert.match(await page.getByTestId("mate-detail-evidence-brief-full").textContent(), /Router 预填场景/);
      assert.match(await evidence.textContent(), /无 git 工件/);
      // 时间线含工件核验站的负例（done 工单 awaitingSinceMs 出清 → 站不渲染）。
      await page.getByTestId("mate-detail-tab-timeline").click();
      assert.equal(await page.getByTestId("mate-timeline-station-awaiting").count(), 0);
      await page.getByTestId("mate-detail-back").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-ticket-detail"]').length === 0,
      );

      // MRP05（04 §4 摘要卡）：watchdog 通知区（kind 徽标+工单号+摘要）+ 超额聚合的次日
      // 摘要（分节展示）→「标记已投递」回执 → 摘要分节出清。
      await page.getByTestId("fixture-inject-notice").click();
      await page.getByTestId("mate-digest-card").waitFor();
      assert.match(await page.getByTestId("mate-digest-card").textContent(), /运行停滞/);
      assert.match(await page.getByTestId("mate-digest-card").textContent(), /T-notice-1/);
      assert.match(await page.getByTestId("mate-digest-quota").textContent(), /今日打扰/);
      // 前 2 次已完成工单的气泡闸已计 2 次打扰，再推 4 条 report → 累计 6 > 5 → 第 6 条
      // 起聚合（04 §5 场景 4：第 6 次推送日非决策推送聚合次日摘要）。
      await page.getByTestId("fixture-push-reports").click();
      await page.getByTestId("mate-digest-pending").waitFor({ timeout: 15000 });
      assert.match(await page.getByTestId("mate-digest-pending").textContent(), /汇报推送：已完成 fixture 场景/);
      await page.getByTestId("mate-digest-delivered").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-digest-pending"]').length === 0,
      );

      // MRP06（04 §4 气泡闸，P3 注记兑现）：超额后再出新汇报 → 弹泡差分命中但
      // admitDisturbance 未放行 → 投影 bubble=null（fail-closed；汇报仍在速览行）。
      // 判定读点实时回填，等待 bubble admit 出现即闸确实判定过。
      await page.getByTestId("fixture-inject-dispatch").click();
      await page.getByTestId("mate-decision-card").waitFor();
      await page.getByTestId("mate-decision-approve").click();
      await page.waitForFunction(
        () => /^bubble:.+:false$/.test(
          document.querySelector('[data-testid="fixture-last-admit"]')?.textContent ?? "",
        ),
        { timeout: 20000 },
      );
      await page.waitForFunction(
        () => {
          const projection = document.querySelector('[data-testid="fixture-mate-pet-projection"]')
            ?.textContent ?? "";
          return projection.includes('"bubble":null') && projection.includes('"latestReport":{');
        },
        { timeout: 20000 },
      );
      const admit = await page.getByTestId("fixture-last-admit").textContent();
      assert.match(admit, /^bubble:.+:false$/);

      // MRP07（双语）：en 词典下配额行与摘要卡标题切换（键一次建齐+键守护）。
      await page.getByTestId("fixture-locale").click();
      await page.waitForFunction(
        () => /Disturbances/.test(
          document.querySelector('[data-testid="mate-status-quota"]')?.textContent ?? "",
        ),
      );
      assert.match(await page.getByTestId("mate-digest-card").textContent(), /Quiet-hours digest/);

      assert.deepEqual(errors, [], "no page errors");
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
