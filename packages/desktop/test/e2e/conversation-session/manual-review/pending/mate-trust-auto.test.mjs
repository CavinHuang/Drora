// Mate P4 修复轮验收（docs/mate-implementation-plan-2026-11-04/04-p4-detailed-design.md
// §2 auto 信任门 + §5 验收场景 2 前半句 UI 半段）：「切 auto」唯一入口的完整交互链——
// 按钮出现（信任门达标投影）→ 全局确认框（名单与预算+不可逆提示）→ setMode → 成功臂
// （快照收敛 auto 徽标+入口消失）与失败臂（mate.auto.locked 专属文案）。真实统计与
// setMode 复核判定在 host 侧（services trustGate，assistantP4Host.test.ts 锁定），
// renderer 夹具只造「达标投影」与一次复核失败（诚实边界，不伪造判定链路）。
// 同 fixture（mate-browser.fixture.tsx）与 mate-p4-ui.test.mjs 先例：真实 React 组件+
// 仓库 CSS+vite dev server+chromium headless；P1-P4 资产共存（新控件不点不触发）。
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { default: tailwindcss } = await import(
  pathToFileURL(require.resolve("@tailwindcss/vite")).href
);

test(
  "MTA01–03: trust gate closed hides entry, confirm dialog lists allowlist+budget, setMode success arm converges to auto, mate.auto.locked failure arm",
  { timeout: 240000 },
  async () => {
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      // P10a-2 门禁轮（2026-11-07）：浏览器资产以单条 node --test <多资产> 并行执行，
      // 每跑一次的 mkdtemp 冷缓存在 N 路并行下首次依赖预构建互相挤兑（goto 60s
      // 全员撞线，实测复现）。缓存目录改稳定键=<资产名>-<仓库路径哈希>：跨
      // worktree 仍隔离（原 mkdtemp 缓存的隔离目的不变——不同 worktree 的
      // node_modules 版本不互染）、跨资产分目录（并行无写竞争）、重复运行复用
      // 热缓存（依赖变化由 vite 自身指纹失效，不需人工清理）。
      cacheDir: join(
        tmpdir(),
        "mate-ui-vite-cache",
        `trust-auto-${createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16)}`,
      ),
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
      // goto 放宽到 60s：新引入 ConfirmDialog（CodeBlock/shiki）后 vite 冷优化依赖图
      // 变大，30s 默认在本机冷启动下会撞线（实测一次 30s 超时，二跑 55s 内完成）。
      await page.goto(`http://127.0.0.1:${address.port}/mate-ui-test`, {
        waitUntil: "domcontentloaded",
        // P10a-2 门禁轮再放宽到 120s：多资产单条 node --test 并行冷优化挤兑
        // （60s 全员撞线，2026-11-07 实测）；配合上方稳定热缓存目录覆盖首冷+并行。
        timeout: 120_000,
      });
      await page.getByTestId("mate-side-pane").waitFor();
      // 页签真互斥（2026-11-07 UX 修复）：卡片/观察行/汇报卡在收件箱视图。
      await page.getByTestId("mate-secondary-tab-inbox").click();

      // 信任条在台账页签（2026-11-07 页签真互斥重构后归属）。
      await page.getByTestId("mate-secondary-tab-inventory").click();
      const trustBar = page.getByTestId("mate-trust-bar");
      await trustBar.waitFor();

      // MTA01（诚实降级负例）：信任门字段缺席（gateOpen 不携带）→ 入口不渲染、进度行
      // 不渲染（UI 不做第二判定，只有计数行）。
      assert.equal(await page.getByTestId("mate-auto-switch").count(), 0, "gate closed hides entry");
      assert.equal(await page.getByTestId("mate-trust-gate-progress").count(), 0);
      assert.match(await trustBar.textContent(), /未指名可接受/);

      // MTA02 前置（失败臂先跑——成功臂会把模式切到 auto，入口随之消失）：
      // fixture-trust-open → 达标投影 → 「切换 auto」出现+进度行（rate=80% 样本=15）。
      await page.getByTestId("fixture-trust-open").click();
      const autoSwitch = page.getByTestId("mate-auto-switch");
      await autoSwitch.waitFor();
      assert.match(await page.getByTestId("mate-trust-gate-progress").textContent(), /放行率 80%/);
      assert.match(await page.getByTestId("mate-trust-gate-progress").textContent(), /样本 15/);
      // MTA03（失败臂）：armed mate.auto.locked → 确认框 → 确认 → 专属失败文案
      // （role=alert），模式保持 observe（快照收敛，无本地乐观翻转）。
      await page.getByTestId("fixture-auto-locked-next").click();
      await autoSwitch.click();
      const confirmDialog = page.getByTestId("mate-auto-switch-confirm");
      await confirmDialog.waitFor();
      // 确认框列出当前名单与软预算（04 详设 §2 不可逆提示）。CodeBlock 正文在
      // Shadow DOM（[data-code] [data-content]，照 workspace-mcp-trust 先例穿根读取），
      // shiki 异步高亮——轮询等待名单/预算文本出现。
      const dialogCode = confirmDialog.getByTestId("confirm-dialog-code");
      await dialogCode.waitFor();
      await page.waitForFunction(
        () => {
          const block = document.querySelector('[data-testid="confirm-dialog-code"]');
          if (!block) return false;
          const roots = [block];
          while (roots.length) {
            const root = roots.shift();
            const code = root?.querySelector("[data-code] [data-content]");
            if (code?.textContent?.includes("名单：fixture/user-a")) return true;
            for (const element of root?.querySelectorAll("*") ?? []) {
              if (element.shadowRoot) roots.push(element.shadowRoot);
            }
          }
          return false;
        },
        undefined,
        { timeout: 20000 },
      );
      // 预算行同在正文（名单文本已进 DOM，此处直接断言完整文案）。
      const dialogCodeText = await page.evaluate(() => {
        const block = document.querySelector('[data-testid="confirm-dialog-code"]');
        const roots = [block];
        while (roots.length) {
          const root = roots.shift();
          const code = root?.querySelector("[data-code] [data-content]");
          if (code?.textContent) return code.textContent;
          for (const element of root?.querySelectorAll("*") ?? []) {
            if (element.shadowRoot) roots.push(element.shadowRoot);
          }
        }
        return "";
      });
      assert.match(dialogCodeText, /软预算：每 workspace 3 个活动工单/);
      // 不可逆提示（04 详设 §2：「本次切换不可在此弹窗中撤销」）。
      assert.match(await confirmDialog.textContent(), /不可在此弹窗中撤销/);
      await confirmDialog.getByTestId("confirm-dialog-confirm").click();
      const failure = page.getByTestId("mate-auto-switch-error");
      await failure.waitFor();
      assert.match(await failure.textContent(), /信任门未达标/);
      assert.match(await page.getByTestId("mate-status-mode").textContent(), /观察/);
      // Radix 关闭动画会保留一帧内容层（ConfirmDialog 文件内注释即对账点）——轮询等出清。
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-auto-switch-confirm"]').length === 0,
        undefined,
        { timeout: 15000 },
      );

      // MTA02（成功臂）：锁定开关已消费 → 再次确认 → setMode("auto") 成功 → 快照推送
      // 收敛：状态条徽标=自动、入口消失（auto 下不渲染切换入口）。
      await autoSwitch.click();
      await page.getByTestId("mate-auto-switch-confirm").waitFor();
      await page
        .getByTestId("mate-auto-switch-confirm")
        .getByTestId("confirm-dialog-confirm")
        .click();
      await page.waitForFunction(
        () => /自动/.test(
          document.querySelector('[data-testid="mate-status-mode"]')?.textContent ?? "",
        ),
        { timeout: 15000 },
      );
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mate-auto-switch"]').length === 0,
        { timeout: 15000 },
      );
      assert.equal(
        await page.getByTestId("mate-auto-switch-error").count(),
        0,
        "no failure line on success arm",
      );

      assert.deepEqual(errors, [], "no page errors");
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
