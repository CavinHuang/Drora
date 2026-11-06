// Mate P3 Source/桌宠接缝验收（docs/mate-implementation-plan-2026-11-04/03-p3-detailed-design.md
// §7 场景 5 + spec §11 P3 落地注记）：真实 React 组件与仓库 CSS；服务为 fixture 内存版
// IAssistantTicketService（synthetic，03 详设 §7 落地注记——场景 1-4 的服务侧链路已由
// assistantSourceIngest/assistantSourceRegistry 单测锁定，本资产验收接缝批 UI 面与桌宠
// 投影发布链路）。真实 Electron 桌宠窗口（badge/tray 点击）随总闸联调验收。
// MSP01-06：来源徽标（决策卡/观察行）、通道绑定站（直通）、手机直通不建新卡、
// 桌宠投影发布（MatePetSync→publishMatePet 捕获）、气泡差分（首报登记/次报弹）、双语。
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
  "MSP01–06: Source badges, channel-binding station, phone direct-through, pet projection publish, bubble diff, i18n",
  { timeout: 180000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "mate-source-pet-"));
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
      const page = await browser.newPage({ viewport: { width: 900, height: 1000 } }),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const address = server.httpServer.address();
      await page.goto(`http://127.0.0.1:${address.port}/mate-ui-test`, {
        waitUntil: "domcontentloaded",
        // P4 修复轮放宽：fixture 增挂 ConfirmDialogHost（CodeBlock/shiki）后冷优化依赖图变重，
        // 30s 默认在冷机首跑会撞线（mate-trust-auto.test.mjs 同因由）。
        timeout: 60_000,
      });
      await page.getByTestId("mate-side-pane").waitFor();

      // MSP01（spec §11 落地注记）：手机点名 → 决策卡渲染来源徽标（phone）+ 触发者身份；
      // 观察行（未指名 local 触发）同样带来源徽标。
      await page.getByTestId("fixture-inject-phone").click();
      const card = page.getByTestId("mate-decision-card");
      await card.waitFor();
      const badge = page.getByTestId("mate-source-badge");
      await badge.waitFor();
      assert.equal(await badge.getAttribute("data-source-kind"), "phone");
      assert.match(await badge.textContent(), /手机/);

      // MSP02（03 §5 Thread 直通绑定 + §7 场景 4 UI 侧）：放行手机卡 → trigger.channel_ref
      // 回填 ticket.channel_ref；同通道追加消息在工单未终态窗口内直通（ingest 读点
      // direct:<ticketId>:<原文>，不产生新决策卡）；详情时间线「通道绑定（直通）」站
      // 显示串接值本身。
      await page.getByTestId("mate-filter-all").click();
      await page.getByTestId("mate-decision-approve").click();
      await page.getByTestId("mate-ticket-row").waitFor();
      await page.getByTestId("fixture-phone-followup").click();
      await page.waitForFunction(
        () =>
          /^direct:T-\d+:补充：横屏复现$/.test(
            document.querySelector('[data-testid="fixture-last-ingest"]')?.textContent ?? "",
          ),
      );
      assert.equal(await page.getByTestId("mate-decision-card").count(), 0);
      const row = page.getByTestId("mate-ticket-row").first();
      await row.click();
      await page.getByTestId("mate-ticket-detail").waitFor();
      await page.getByTestId("mate-detail-tab-timeline").click();
      const channelStation = page.getByTestId("mate-timeline-station-channel");
      await channelStation.waitFor();
      assert.match(await channelStation.textContent(), /通道绑定（直通）/);
      assert.match(await channelStation.textContent(), /phone:session:rs-phone-1/);
      await page.getByTestId("mate-detail-back").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-ticket-detail"]').length === 0,
      );

      // MSP03（03 §7 场景 5 UI 投影侧）：MatePetSync 经 publishMatePet 发布投影——
      // 放行后待决策出清、投影读点持续跟随（进行中/汇报断言归 MSP04 的终态帧）。
      const projectionBox = page.getByTestId("fixture-mate-pet-projection");
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-testid="fixture-mate-pet-projection"]')?.textContent ?? "")
            .length > 0,
      );
      const projection = JSON.parse(await projectionBox.textContent());
      assert.deepEqual(projection.pendingDecisions, []);

      // MSP04（气泡差分）：挂载帧（服务空台账）登记 {key:null}，会话期内首个终态汇报
      // 即弹泡（bubble=latestReport 同帧同票）；第二张工单终态 → 弹泡推进到新票。
      // 「挂载时已有旧汇报只登记不弹」由 petProjection 单测锁定（deriveMatePetBubble
      // previous=null 分支）——renderer 夹具起于空台账，无法复现冷启动帧。
      await page.waitForFunction(
        () =>
          /"bubble":\{"ticketId":"T-\d+"/.test(
            document.querySelector('[data-testid="fixture-mate-pet-projection"]')?.textContent ?? "",
          ),
        { timeout: 15000 },
      );
      const firstBubble = JSON.parse(await projectionBox.textContent());
      assert.equal(firstBubble.bubble.ticketId, firstBubble.latestReport.ticketId);
      assert.equal(firstBubble.latestReport.status, "done");
      assert.match(firstBubble.latestReport.summary, /fixture 汇报首行摘要/);
      await page.getByTestId("fixture-inject-dispatch").click();
      await page.getByTestId("mate-decision-card").waitFor();
      await page.getByTestId("mate-decision-approve").click();
      await page.waitForFunction(
        (previousTicketId) => {
          const raw = document.querySelector('[data-testid="fixture-mate-pet-projection"]')
            ?.textContent;
          if (!raw) return false;
          const parsed = JSON.parse(raw);
          return (
            parsed.bubble !== null &&
            parsed.bubble.ticketId !== previousTicketId &&
            parsed.latestReport.ticketId === parsed.bubble.ticketId
          );
        },
        firstBubble.bubble.ticketId,
        { timeout: 15000 },
      );
      const rebubbled = JSON.parse(await projectionBox.textContent());
      assert.notEqual(rebubbled.bubble.ticketId, firstBubble.bubble.ticketId);

      // MSP07（P6 桌宠工作面板，07 号详设 §2）：第二张工单终态后投影含工作历史
      // recentTickets（两条 done 倒序，最新在前且与 latestReport 同源）与活动行
      // updatedAtMs/mode 增强字段（本帧活动已清空——增强断言归 seam/petProjection
      // 单测，此处锁发布链端到端携带）。
      await page.waitForFunction(
        () => {
          const raw = document.querySelector('[data-testid="fixture-mate-pet-projection"]')
            ?.textContent;
          if (!raw) return false;
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed.recentTickets) && parsed.recentTickets.length >= 2;
        },
        { timeout: 15000 },
      );
      const withRecent = JSON.parse(await projectionBox.textContent());
      assert.equal(withRecent.recentTickets[0].ticketId, withRecent.latestReport.ticketId);
      assert.equal(withRecent.recentTickets[0].status, "done");
      assert.ok(
        withRecent.recentTickets[0].updatedAtMs >= withRecent.recentTickets[1].updatedAtMs,
      );
      assert.match(withRecent.recentTickets[0].summary, /fixture 汇报首行摘要|完成/);

      // MSP05（观察行来源徽标）：未指名本地触发 → would-accept 观察行带 local 徽标
      // （默认「待决策」档不渲染观察行——先切「观察中」档）。
      await page.getByTestId("mate-trigger-input").fill("帮我看看构建为什么红了");
      await page.getByTestId("mate-trigger-inferred").click();
      await page.getByTestId("mate-filter-observe").click();
      const observeRow = page.getByTestId("mate-observe-row");
      await observeRow.waitFor();
      const observeBadge = observeRow.getByTestId("mate-source-badge");
      assert.equal(await observeBadge.getAttribute("data-source-kind"), "local");
      assert.match(await observeBadge.textContent(), /本地/);

      // MSP06（双语键守护）：切 en——来源徽标文案随语言切换（键一次建齐，zh/en 键集一致
      // 由 i18n 键守护单测锁定；此处验收运行时渲染）。
      await page.getByTestId("fixture-locale").click();
      await page.getByTestId("mate-side-pane").waitFor();
      const enBadge = page
        .locator('[data-testid="mate-observe-row"]')
        .getByTestId("mate-source-badge");
      await enBadge.waitFor();
      assert.equal(await enBadge.getAttribute("data-source-kind"), "local");
      assert.match(await enBadge.textContent(), /Local/);

      assert.deepEqual(errors, []);
      console.log(`Mate source-pet evidence: ${output}`);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
