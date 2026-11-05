// Mate P2 Surface 验收（docs/mate-implementation-plan-2026-11-04/02-p2-detailed-design.md
// §1.4 Surface A / §7 Surface C）：真实 React 组件与仓库 CSS；服务为 fixture 内存版
// IAssistantTicketService（synthetic）。Router 评估本体在 host 侧（services
// routerEvaluation），renderer 夹具只验收 Surface 呈现与预填放行传参——注入按钮直造
// 带建议的决策卡（mate-browser.fixture.tsx P2 扩展控件）。真实 Host 端到端（候选卡→
// 建议→人放行、换代重派、双链路）随总闸联调验收（specs §14 P2 验收行）。
// MSA10 为 P2 审查修复批追加（specs §9 W2 兜底：W1 worktree 配置区开关）。
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
  "MSA01–10: Surface A status strip, Router suggestion prefill (dispatch/attach/failed/hold), team action, queued notice, Surface C tabs, generation badge, session-line, W1 worktree toggle",
  { timeout: 180000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "mate-surface-ac-"));
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

      // MSA01（02 §1.4）：大副会话状态条——mode 徽标（观察）+ 活动/排队/待决策计数；
      // 打扰配额 P2 无事实源不渲染（specs §11.1 落地注记）。
      const strip = page.getByTestId("mate-status-strip");
      await strip.waitFor();
      assert.match(await page.getByTestId("mate-status-mode").textContent(), /观察/);
      assert.match(await page.getByTestId("mate-status-line").textContent(), /活动 0\/3/);
      assert.match(await page.getByTestId("mate-status-line").textContent(), /排队 0 · 待决策 0/);

      // MSA02（02 §1.3 预填）：dispatch 建议 → 建议区（建议/目标/理由/证据 verbatim）→
      // 放行携带预填参（target=建议目标、mode=A、tier=build）。
      await page.getByTestId("fixture-inject-dispatch").click();
      const card = page.getByTestId("mate-decision-card");
      await card.waitFor();
      const suggestion = page.getByTestId("mate-decision-router-suggestion");
      await suggestion.waitFor();
      assert.match(await suggestion.textContent(), /建议：独立工单/);
      assert.match(await suggestion.textContent(), /fixture\/workspace-b/);
      assert.match(await suggestion.textContent(), /原文提到『修一下构建』/);
      assert.equal(await page.getByTestId("mate-decision-router-evidence").count(), 1);
      // 切「全部」档：放行后的工单行需要工单入组渲染（decision 档无工单，P1 同款前置）。
      await page.getByTestId("mate-filter-all").click();
      await page.getByTestId("mate-decision-approve").click();
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-testid="fixture-approve-input"]')?.textContent ?? "")
            .length > 0,
      );
      const approveInput = await page.getByTestId("fixture-approve-input").textContent();
      assert.match(approveInput, /mode=A/);
      assert.match(approveInput, /target=fixture\/workspace-b/);
      assert.match(approveInput, /tier=build/);
      // 放行即卡折叠（decided_by=user），工单行顶上（dispatched 灯档）。
      await page.getByTestId("mate-ticket-row").waitFor();
      assert.equal(await page.getByTestId("mate-decision-card").count(), 0);

      // MSA03（02 §2 Tier 预填）：attach 建议 → 建议区含会话 id → 放行携带 attachToSessionId。
      await page.getByTestId("fixture-inject-attach").click();
      const attachCard = page.getByTestId("mate-decision-card");
      await attachCard.waitFor();
      const attachSuggestion = page.getByTestId("mate-decision-router-suggestion");
      assert.match(await attachSuggestion.textContent(), /建议：附着既有会话/);
      assert.match(await attachSuggestion.textContent(), /sess-attach-9/);
      await page.getByTestId("mate-decision-approve").click();
      await page.waitForFunction(
        () => /attach=sess-attach-9/.test(
          document.querySelector('[data-testid="fixture-approve-input"]')?.textContent ?? "",
        ),
      );
      const attachInput = await page.getByTestId("fixture-approve-input").textContent();
      assert.match(attachInput, /target=fixture\/workspace/);

      // MSA04（02 §1.2 降级）：failed Router → 降级行诚实展示（不重试模型），建队捷径
      // 不渲染（hold/reject/failed 不提供建队），普通放行仍可用（人工终审）。
      await page.getByTestId("fixture-inject-failed").click();
      await page.getByTestId("mate-decision-card").waitFor();
      const failedLine = page.getByTestId("mate-decision-router-failed");
      assert.match(await failedLine.textContent(), /大副评估失败，已转人工决策/);
      assert.match(await failedLine.textContent(), /router evaluation schema mismatch/);
      assert.equal(await page.getByTestId("mate-decision-approve-team").count(), 0);
      await page.getByTestId("mate-decision-approve").click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="mate-decision-card"]').length === 0,
      );

      // MSA05（specs §7 Mode B）：dispatch 建议卡第二放行动作=建队 → mode=B 传参。
      await page.getByTestId("fixture-inject-dispatch").click();
      await page.getByTestId("mate-decision-card").waitFor();
      await page.getByTestId("mate-decision-approve-team").click();
      await page.waitForFunction(
        () => /mode=B/.test(
          document.querySelector('[data-testid="fixture-approve-input"]')?.textContent ?? "",
        ),
      );

      // MSA06（specs §9 软预算）：排队开关下放行 → 卡内告知行为即时反馈（快照推送后
      // 卡片折叠，瞬态不可靠），持续告知断言按稳定事实：工单行排队灯档 + 状态条计数。
      await page.getByTestId("fixture-queue-next").click();
      await page.getByTestId("fixture-inject-dispatch").click();
      await page.getByTestId("mate-decision-card").waitFor();
      await page.getByTestId("mate-decision-approve").click();
      await page.getByTestId("mate-ticket-queued").waitFor();
      assert.match(await page.getByTestId("mate-ticket-queued").textContent(), /排队/);
      assert.match(await page.getByTestId("mate-status-line").textContent(), /排队 1/);

      // MSA07（02 §7 Surface C）：queued 工单行点击下钻详情 → 四页签。时间线=代际站
      // （排队站带 queuedReason、派发站、锚站「尚未投递」、当前代）；证据=decisionId
      // 关联决策卡（触发 verbatim+Router 证据）；成本=合计+按代分解随 P4 说明。
      // 定位用排队徽标（组内按 updatedAt 倒序，序号定位会随终态推进漂移）。
      const queuedRow = page.locator('[data-testid="mate-ticket-row"]', {
        has: page.getByTestId("mate-ticket-queued"),
      });
      assert.equal(await queuedRow.count(), 1);
      await queuedRow.click();
      const detail = page.getByTestId("mate-ticket-detail");
      await detail.waitFor();
      await page.getByTestId("mate-detail-tab-timeline").click();
      const timelineStations = page.getByTestId("mate-detail-timeline");
      await timelineStations.waitFor();
      const queuedStation = page.getByTestId("mate-timeline-station-queued");
      assert.match(await queuedStation.textContent(), /排队中/);
      assert.match(await queuedStation.textContent(), /已达软预算/);
      const anchorStation = page.getByTestId("mate-timeline-station-anchor");
      assert.match(await anchorStation.textContent(), /尚未投递/);
      const currentStation = page.getByTestId("mate-timeline-station-current");
      assert.match(await currentStation.textContent(), /当前（第 1 代）/);
      await page.getByTestId("mate-detail-tab-report").click();
      assert.match(
        await page.getByTestId("mate-detail-report").textContent(),
        /尚无汇报/,
      );
      await page.getByTestId("mate-detail-tab-evidence").click();
      const evidence = page.getByTestId("mate-detail-evidence");
      await evidence.waitFor();
      assert.match(await evidence.textContent(), /触发原文/);
      assert.match(await evidence.textContent(), /原文提到『修一下构建』/);
      await page.getByTestId("mate-detail-tab-cost").click();
      const cost = page.getByTestId("mate-detail-cost");
      assert.match(await cost.textContent(), /0\/0/);
      assert.match(await cost.textContent(), /按代分解随 P4/);
      // 返回按钮回列表（详情消失、面板回到滚动区）。
      await page.getByTestId("mate-detail-back").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-ticket-detail"]').length === 0,
      );

      // MSA07b：done 汇报卡的 [详情] 入口（点首张 done 卡——终态推进时序不定，断言按
      // 通用关联语义：触发 verbatim+锚站 sessionId 格式，不绑定具体工单）。
      const doneDetailButton = page.getByTestId("mate-report-detail").first();
      await doneDetailButton.waitFor({ timeout: 15000 });
      await doneDetailButton.click();
      await page.getByTestId("mate-ticket-detail").waitFor();
      await page.getByTestId("mate-detail-tab-timeline").click();
      const doneAnchor = page.getByTestId("mate-timeline-station-anchor");
      assert.match(await doneAnchor.textContent(), /T-\d+-1/);
      await page.getByTestId("mate-detail-tab-evidence").click();
      const doneEvidence = page.getByTestId("mate-detail-evidence");
      await doneEvidence.waitFor();
      assert.match(await doneEvidence.textContent(), /触发原文/);
      assert.match(await doneEvidence.textContent(), /点名：Router 预填场景/);
      await page.getByTestId("mate-detail-back").click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-ticket-detail"]').length === 0,
      );

      // MSA08（specs §8 换代）：rollover 开关下放行 → 工单行「第 2 代」徽标 → 行点击
      // 详情时间线当前代站=第 2 代（mate-trace 轨渲染）。
      await page.getByTestId("fixture-rollover-next").click();
      await page.getByTestId("fixture-inject-dispatch").click();
      await page.getByTestId("mate-decision-card").waitFor();
      await page.getByTestId("mate-decision-approve").click();
      const generationBadge = page.getByTestId("mate-ticket-generation").first();
      await generationBadge.waitFor();
      assert.match(await generationBadge.textContent(), /第 2 代/);
      const rolloverRow = page.locator('[data-testid="mate-ticket-row"]', {
        has: page.getByTestId("mate-ticket-generation"),
      });
      await rolloverRow.click();
      await page.getByTestId("mate-ticket-detail").waitFor();
      await page.getByTestId("mate-detail-tab-timeline").click();
      const rolloverCurrent = page.getByTestId("mate-timeline-station-current");
      assert.match(await rolloverCurrent.textContent(), /当前（第 2 代）/);
      const anchorDone = page.getByTestId("mate-timeline-station-anchor");
      assert.match(await anchorDone.textContent(), /T-\d+-1/);
      await page.getByTestId("mate-detail-back").click();

      // MSA09（specs §11.4 session-line）：MateSessionLine 两态——带摘要渲染计数徽标，
      // 缺席（旧帧）渲染 null。
      const lineWith = page.getByTestId("fixture-session-line-with");
      await page.getByTestId("mate-session-line").first().waitFor();
      assert.match(await lineWith.textContent(), /2 活动/);
      assert.match(await lineWith.textContent(), /3 待决策/);
      assert.equal(await page.getByTestId("fixture-session-line-absent").textContent(), "");

      // MSA10（specs §9 W2 兜底，P2 审查修复补交互入口）：配置区 W1 worktree 开关——
      // 初始开（快照投影），点击关 → setWorktreeDisabled 事务落库 → 快照回填状态行
      // 「关——声明写域」；再点回开恢复（开关只发动作，无本地副本）。
      const worktreeState = page.getByTestId("mate-worktree-state");
      await worktreeState.waitFor();
      assert.match(await worktreeState.textContent(), /每张工单派发进独立 worktree/);
      await page.getByTestId("mate-worktree-switch").click();
      await page.waitForFunction(
        () =>
          /声明写域/.test(
            document.querySelector('[data-testid="mate-worktree-state"]')?.textContent ?? "",
          ),
      );
      await page.getByTestId("mate-worktree-switch").click();
      await page.waitForFunction(
        () =>
          /每张工单派发进独立 worktree/.test(
            document.querySelector('[data-testid="mate-worktree-state"]')?.textContent ?? "",
          ),
      );

      assert.deepEqual(errors, []);
      console.log(`Mate Surface evidence: ${output}`);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
