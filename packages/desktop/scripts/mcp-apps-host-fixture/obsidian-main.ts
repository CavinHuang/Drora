import { app, protocol } from "electron";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PLUGIN_SANDBOX_PRIVILEGED_SCHEME } from "../../src/main/pluginSandbox/index.js";
import { managedEnvironment } from "./managed-environment.js";

/**
 * P5 沙箱页面 e2e（specs/obsidian-vault-phase2-true-extraction.md §10-P5 附加 gate：
 * launcher / display modes / 后台回收草稿保护）：真实 knowledge server
 * （obsidian-plugin dist/mcp/server.js，DRORA_OBSIDIAN_SERVER 注入）+ 真实构建面板
 * （dist/ui/panel.html）过真实 agent/bridge/沙箱链（managed fixture，showcase 同款）。
 *
 * 只读面验收（D13 保守缺省）：浏览（树+正文分段读取经 resources/read 无审批）、
 * N1 lookup + g9 handoff、fullscreen-only display mode、backgroundRetention 草稿保护。
 */
const [root, profile, node, cli, serverScript] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
];
app.setPath("userData", profile);
protocol.registerSchemesAsPrivileged([PLUGIN_SANDBOX_PRIVILEGED_SCHEME]);
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(async () => {
    const env = await managedEnvironment(root, node, cli);
    const checks: string[] = [];
    const check = async (name: string, run: () => Promise<void>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          run(),
          new Promise<never>((_, reject) => {
            // lookup 首跑含冷索引（bge 模型不下载、FTS 建库），放宽到 120s。
            timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 120_000);
          }),
        ]);
        checks.push(name);
        process.stdout.write(`PASS Obsidian ${name}\n`);
      } finally {
        clearTimeout(timer!);
      }
    };

    // fixture vault：两篇互链笔记（wikilink 跳转 + lookup 候选）+ P8 第三篇唯一句笔记。
    // 数据隔离：startAgent 把 agent-data 设为 DRORA_DATA_BASE_DIR，knowledge server
    // 由 agent 作为会话级 MCP 拉起并继承该 env → 旧路径库与插件数据目录都落在
    // agent-data 内（resolveKnowledgeDataPlan 同一事实源推导，零真实 HOME 触碰）。
    const vaultDir = join(root, "obsidian-vault");
    mkdirSync(join(vaultDir, "notes"), { recursive: true });
    writeFileSync(
      join(vaultDir, "notes", "alpha.md"),
      "# Alpha\n\n参见 [[notes/beta]]。Alpha 笔记正文：Drora 面板端到端验收样例 A。\n",
    );
    writeFileSync(
      join(vaultDir, "notes", "beta.md"),
      "# Beta\n\n参见 [[alpha]]。Beta 笔记正文：Drora 面板端到端验收样例 B。\n",
    );
    // P8（spec §10-P8 E2E 重写）：gamma 是旧 r1-first-use G02 / G58 夹具的等价物——
    // 唯一中文句在第 3 行（bigram 全库唯一、不含分词虚词表用字，与旧 R1 夹具同构），
    // 服务 R1 索引计数（3 文件）、唯一句检索行号核对与 citation openWith 三态场景。
    const GAMMA_NOTE = "notes/gamma.md";
    const GAMMA_QUERY = "琥珀庭院琉璃灯影第七夜熄灭";
    writeFileSync(
      join(vaultDir, GAMMA_NOTE),
      ["# 琉璃灯影信标笔记", "", `${GAMMA_QUERY}，此句全库唯一。`, "后续段落不含检索词元，仅用于占据行位。", ""].join(
        "\n",
      ),
    );
    const pluginDataDir = join(root, "agent-data", ".drora", "cli", "data", "obsidian@drora-plugins-official");
    mkdirSync(pluginDataDir, { recursive: true });
    writeFileSync(
      join(pluginDataDir, "vault-config.json"),
      JSON.stringify({
        rootPath: vaultDir,
        displayName: "P5 E2E Vault",
        inboxPath: "Inbox",
        allowAgentWrites: true,
        configuredAt: Date.now(),
      }),
    );

    try {
      const scope = await env.agent.session(join(root, "obsidian-workspace"), "obsidian", "obsidian", undefined, {
        serverScript,
        resourceUri: "ui://obsidian/panel.html",
        // knowledge server 只讲 modern era（serveStdio legacy:"reject"），pin 2026-07-28。
        protocolVersion: "2026-07-28",
      });
      await env.agent.call("session/setModel", {
        sessionId: scope.sessionId,
        model: env.model.selection,
      });
      const win = await env.createWindow(scope);
      // createWindow 对非 background 模式缺省隐藏（show:false）——macOS 隐藏窗口不派发
      // animation frame，renderer 的 setAnchors/layout 双 rAF 会永挂（Linux 注记同源问题）。
      // obsidian 检查全部依赖锚点编排，显式显示。
      win.show();
      const ui = (code: string) =>
        // 有界兜底：宿主页 executeJavaScript 理论不挂，真挂时给出可定位错误而非整体超时。
        Promise.race([
          win.webContents.executeJavaScript(code),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`ui() timed out: ${code.slice(0, 80)}`)), 20_000),
          ),
        ]);
      const page = (code: string) => env.evalPage(win, code);
      const waitText = async (selector: string, pattern: RegExp) =>
        Promise.race([
          page(`new Promise(resolve => {
      const check=()=>{const node=document.querySelector(${JSON.stringify(selector)});
        if(node&&${pattern.toString()}.test(node.textContent))return resolve(node.textContent);};
      const observer=new MutationObserver(check);observer.observe(document.body,{attributes:true,childList:true,subtree:true});check();
    })`),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `waitText timeout: ${selector}; body=${typeof document !== "undefined" ? "" : ""}`,
                  ),
                ),
              60_000,
            ),
          ),
        ]).catch(async (error: unknown) => {
          const dump = await page(
            `document.body.innerText.slice(0,500) + ' ||| href=' + location.href`,
          ).catch(() => "<dump failed>");
          throw new Error(`${String((error as Error).message).split(";")[0]}
DOM: ${dump}`);
        });

      await check("launcher：真实面板经 agent/bridge 启动并呈现 vault 概要（resources/read 无审批）", async () => {
        // 有界等 phase=running（超时转储 phases/guest 状态，防挂死不可诊断）。
        const deadlinePhase = Date.now() + 60_000;
        for (;;) {
          const state = await ui("window.managedState()");
          if (state.phase === "running") break;
          if (state.phase === "error")
            throw new Error(`panel phase=error: ${state.actual?.error ?? state.handle ?? ""}`);
          if (Date.now() > deadlinePhase)
            throw new Error(`panel phase stuck: ${JSON.stringify(state).slice(0, 600)}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        assert.equal(
          env.handles.get(win.webContents.id).resourceMeta?.backgroundRetention,
          true,
          "面板资源 _meta.ui.backgroundRetention 应到达宿主 handle",
        );
        // 默认 inline 锚点 + fullscreen-only：先切侧栏锚点让 guest 可见（display mode 断言见下一组）。
        await ui("window.setAnchors(false,true)");
        await ui("window.waitManagedPhase('running')");
        assert.match(await waitText('[data-vault="header-title"]', /P5 E2E Vault/), /P5 E2E Vault/);
      });

      await check("display modes：fullscreen-only——侧栏可见（page visible），inline 槽只给卡片入口", async () => {
        // 侧栏（fullscreen）锚点：页面进入展示态，guest 挂在侧栏锚点下且非隐藏。
        await ui("window.setAnchors(false,true)");
        await ui("window.waitManagedPhase('running')");
        assert.equal((await ui("window.managedState()")).visible, true, "fullscreen 锚点下页面应可见");
        assert.equal((await ui("window.managedState()")).views, 1, "应恰有一个 guest webview");
        // inline-only 锚点：fullscreen-only 页面不在对话内联展示（display modes spec：
        // 对话显示图标/名称/状态和打开按钮），页面退回非展示态（保留后台面）。
        await ui("window.setAnchors(true,false)");
        assert.equal(
          (await ui("window.managedState()")).visible,
          false,
          "inline 锚点下 fullscreen-only 页面应非展示态",
        );
        // 产物卡（TID_PLUGIN_UI_CARD）在场承载 fullscreen-only 的打开入口（具体按钮
        // 文案归 display-modes 组件，此处断言卡片级挂载不越组件细节）。
        assert.ok(
          (await ui("document.querySelectorAll('[data-testid=plugin-ui-card]').length >= 1")) === true,
          "inline 槽应渲染插件卡（fullscreen-only 的打开入口载体）",
        );
        await ui("window.setAnchors(false,true)");
        await ui("window.waitManagedPhase('running')");
      });

      await check("notes 浏览：树加载（缺省折叠→展开）+ 正文分段读取 + wikilink 渲染", async () => {
        // 树缺省全折叠（HEAD getInitialVaultExpandedFolders 语义）：先等文件夹行、点开、
        // 再等文件条目；有界等待 + DOM 转储防挂死不可诊断。
        const bounded = (js: string, what: string) =>
          Promise.race([
            page(js),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`page() timeout: ${what}`)), 45_000),
            ),
          ]).catch(async (error: unknown) => {
            const dump = await page(
              `document.body.innerText.slice(0,500) + ' ||| href=' + location.href`,
            ).catch(() => "<dump failed>");
            throw new Error(`${(error as Error).message}\nDOM: ${dump}`);
          });
        await bounded(
          `new Promise(resolve => {
      const check=()=>{const node=document.querySelector('.vault-folder');if(node)return resolve(true);};
      const observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true});check();
    })`,
          "树应渲染文件夹行",
        );
        await page(`document.querySelector('.vault-folder').click()`);
        await bounded(
          `new Promise(resolve => {
      const check=()=>{const node=document.querySelector('[data-vault="note-item"][data-path="notes/alpha.md"]');
        if(node)return resolve(true);};
      const observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true});check();
    })`,
          "展开后应列出 notes/alpha.md",
        );
        await page(`document.querySelector('[data-vault="note-item"][data-path="notes/alpha.md"]').click()`);
        await waitText('[data-vault="note-body"]', /参见/);
        const lines = await page(`document.querySelectorAll('[data-vault="note-body"] [data-line]').length`);
        assert.ok(Number(lines) >= 3, `正文应有行元素（实际 ${lines}）`);
        const wikilinks = await page(`document.querySelectorAll('.vault-wikilink').length`);
        assert.ok(Number(wikilinks) >= 1, "正文中 [[wikilink]] 应渲染为可点击目标");
      });

      await check("N1 lookup + g9 handoff：检索候选并投递 composer（真实 host-action 桥）", async () => {
        await page(`document.querySelector('[data-vault-tab="ask"]').click()`);
        // React 受控输入：原生 setter 走 value 修改 + input 事件。
        await page(`(function(){
      const input=document.querySelector('[data-vault="ask-input"]');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input,'Beta 笔记正文 验收样例');
      input.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
        await page(`document.querySelector('[data-vault="ask-submit"]').click()`);
        // 冷索引首跑（autoIndex 延迟触发）+ FTS 建库，等候选出现（有界）。
        await page(`new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('lookup candidates timeout')),100000);
      const check=()=>{if(document.querySelector('.vault-candidate')){clearTimeout(timer);resolve(true);}};
      const observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true});check();
    })`);
        await page(`document.querySelector('[data-vault="ask-handoff"]').click()`);
        const event = await env.events.wait(
          (e: { type?: string; action?: string }) =>
            e.type === "host-action" && e.action === "openConversationHandoff",
        );
        const payload = (event as { payload?: { content?: Array<{ text?: string }> } }).payload;
        const text = payload?.content?.[0]?.text ?? "";
        assert.match(text, /notes\/(alpha|beta)\.md/, "handoff 文本应携带来源路径");
      });



      await check("后台回收草稿保护：retained 页隐藏+期限到期不销毁，草稿宿主内存可恢复面在位", async () => {
        // 草稿已在上一组键入；等防抖落宿主内存 store（ui/set-widget-state）。
        await new Promise((resolve) => setTimeout(resolve, 900));
        const widget = (await ui("window.managedState()")).widget as { queryDraft?: string } | undefined;
        assert.equal(widget?.queryDraft, "Beta 笔记正文 验收样例", "草稿应写入宿主 widgetState");
        // retained 页语义（CONTRACT.md:17 / pluginUiBackgroundRetention.canRecycle）：单页
        // 后台声明不逐出——逐出仅发生在 >4 后台页的容量压力下（平台基线
        // “five retained MCP pages evict one after thirty minutes” 覆盖该路径）。隐藏 +
        // 期限到期（expireOffscreen 冲刷 5/30 分钟两档假定时器）后 guest 存活、页面态不丢。
        const oldGuest = env.guests.get(win.webContents.id)!;
        await ui("window.setAnchors(false,false)");
        await ui("window.expireOffscreen()");
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const hiddenState = await ui("window.managedState()");
        assert.equal(hiddenState.phase, "running", "retained 页隐藏后应保持运行（不回收）");
        assert.equal(env.guests.get(win.webContents.id), oldGuest, "guest 不应被销毁重建");
        // 重开侧栏：同一 guest（原子语义：无重建），页面内草稿原样保留。
        await ui("window.setAnchors(false,true)");
        await ui("window.waitManagedPhase('running')");
        assert.equal(env.guests.get(win.webContents.id), oldGuest, "重开应复用同一 guest");
        await Promise.race([
          page(`document.querySelector('[data-vault-tab="ask"]').click()`),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("page() click timed out")), 30_000),
          ),
        ]);
        const draft = await Promise.race([
          page(
            `new Promise(resolve=>{
      const check=()=>{const node=document.querySelector('[data-vault="ask-input"]');
        if(node)return resolve(node.value);};
      const observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true});check();
      setTimeout(()=>resolve(null),8000);
    })`,
          ),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000)),
        ]);
        assert.equal(draft, "Beta 笔记正文 验收样例", "隐藏→期限→重开后草稿应原样在位");
        // widgetState 落宿主内存（回收重建时的恢复面）：store 内草稿仍在。
        const widgetAfter = (await ui("window.managedState()")).widget as
          | { queryDraft?: string }
          | undefined;
        assert.equal(widgetAfter?.queryDraft, "Beta 笔记正文 验收样例");
      });

      // ── P8 收尾验收（specs/obsidian-vault-phase2-true-extraction.md §10-P8「E2E 重写：
      //    webview 形态 r1-r9/G 系列等价场景 + obsidian-knowledge-positive」）。旧 WDIO
      //    r1-r9/G 系列对象是本体 VaultView + Composer evidence 链（已按 §1-C3/C5b/C6
      //    拆除）；以下按 webview+插件 server 形态重写仍存在的可感知行为，已收窄面按
      //    §9 差异清单（⑤evidenceRefs wire 收窄、⑦面板写审批、⑧常驻首发）在 spec 呈现，
      //    不在本 e2e 里伪造等价。工具调用经 mcp/uiCallTool 真实审批面（D7 保守缺省
      //    逐次 ask）——knowledge 工具按名精确匹配审批请求后 allow。──

      // P8 工具面通道（裁定留证）：mcp/uiCallTool 需要 App connection（namespaced
      // server 归属），fixture 会话直挂名不匹配——首跑实证挂起（无审批请求到达，
      // 事件流仅 telemetry）。改走独立 MCP client stdio 直连 knowledge server
      // （P6 升级冒烟同款已验证路径；多实例并存是 g8 受支持场景，DB 级 fence 仲裁
      // 写竞争——本场景只做 status/createRun/search/prepare_evidence，副本 autoIndex
      // 若触发 reconcile 被 fence 拒绝属结构化降级不影响断言）。
      let knowledgeClient: Client | null = null;
      const knowledgeCall = async <T>(toolName: string, args: Record<string, unknown>): Promise<T> => {
        if (knowledgeClient === null) {
          const dataBase = join(root, "agent-data");
          const transport = new StdioClientTransport({
            command: process.execPath,
            args: [serverScript],
            env: {
              DRORA_DATA_BASE_DIR: dataBase,
              DRORA_PLUGIN_DATA: join(dataBase, ".drora", "cli", "data", "obsidian@drora-plugins-official"),
            },
            stderr: "pipe",
          });
          knowledgeClient = new Client(
            { name: "p8-fixture-e2e", version: "0.4.0" },
            { versionNegotiation: { mode: { pin: "2026-07-28" } } },
          );
          await knowledgeClient.connect(transport);
        }
        const result = await knowledgeClient.callTool({ name: toolName, arguments: args });
        const text = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0]?.text;
        if (result.isError) throw new Error(`knowledge tool ${toolName} error: ${text ?? "no text"}`);
        return (text !== undefined ? (JSON.parse(text) as T) : (result as unknown as T));
      };

      await check("R1-G01 等价：索引任务真实完成且覆盖文件数精确等于夹具数（3）", async () => {
        type IndexStatus = {
          configured: boolean;
          coverage: { indexedFiles: number };
          job: { status: string; indexedFiles: number } | null;
        };
        // 冷索引由 autoIndex 延迟触发（§5b.8 两触发点语义），有界轮询任务终态。
        const deadline = Date.now() + 180_000;
        let status: IndexStatus | undefined;
        for (;;) {
          status = await knowledgeCall<IndexStatus>("knowledge_index_get_status", {});
          if (status.job?.status === "completed" && status.coverage.indexedFiles >= 3) break;
          if (status.job && ["failed", "cancelled"].includes(status.job.status))
            throw new Error(`index job ended as ${status.job.status}`);
          if (Date.now() > deadline)
            throw new Error(`index not completed: ${JSON.stringify(status).slice(0, 400)}`);
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        assert.equal(status.configured, true, "旧 R1-G01：configured=true");
        assert.equal(status.coverage.indexedFiles, 3, "覆盖文件数应精确等于夹具 3 篇");
        assert.equal(status.job?.status, "completed", "索引任务终态 completed");
        assert.equal(status.job?.indexedFiles, 3, "任务口径覆盖数同为 3");
      });

      await check("R1-G02/G58+R2 加严等价：唯一句检索——路径/行号/摘录真实 + 定位原文 + handoff 携带行号与摘录", async () => {
        await page(`document.querySelector('[data-vault-tab="ask"]').click()`);
        await page(`(function(){
      const input=document.querySelector('[data-vault="ask-input"]');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input,${JSON.stringify(GAMMA_QUERY)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
        await page(`document.querySelector('[data-vault="ask-submit"]').click()`);
        // 候选出现（索引已就绪，秒级；有界防挂）。
        await page(`new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('unique-sentence candidates timeout')),60_000);
      const check=()=>{if(document.querySelector('.vault-candidate')){clearTimeout(timer);resolve(true);}};
      const observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true});check();
    })`);
        // 路径按钮携带相对路径 + 唯一句真实行号（旧 R1-G02 判据：quote 行区间覆盖唯一句
        // 的真实行号；lookup 候选的 quote 是 matched chunk 级区间（chunk 含标题行），
        // 判据 = 区间覆盖第 3 行而非以 L3 起始）。
        const pathText = await waitText(".vault-candidate-path", /gamma\.md/);
        assert.match(pathText, /notes\/gamma\.md/, "候选应为唯一句所在笔记");
        const lines = String(pathText).match(/L(\d+)-L(\d+)/);
        assert.ok(lines, `候选应呈现行区间（实际 ${pathText}）`);
        const startLine = Number(lines[1]);
        const endLine = Number(lines[2]);
        assert.ok(
          startLine <= 3 && 3 <= endLine,
          `候选行区间 L${startLine}-L${endLine} 应覆盖唯一句第 3 行`,
        );
        // 摘录来自真实原文（G58「verified quote 可回原文」的检索侧判据）。
        const excerpt = await page(`document.querySelector('.vault-candidate-excerpt').textContent`);
        assert.ok(String(excerpt).includes(GAMMA_QUERY.slice(0, 6)), "摘录应含唯一句原文片段");
        // 定位跳转：跳到原文（R9 定位语义 + G58 verified → original Markdown read）。
        await page(
          `document.querySelector('.vault-candidate-actions button').click()`,
        );
        await waitText('[data-vault="note-body"]', new RegExp(GAMMA_QUERY.slice(0, 6)));
        const targetLine = await page(`document.querySelector('[data-vault="note-body"] [data-line="3"]') !== null`);
        assert.equal(targetLine, true, "notes 视图应打开 gamma 且第 3 行元素在场（定位目标行）");
        // R2 等价（handoff 桥，P5 基础上加严）：回 ask 点「交给 Agent」，来源清单文本
        // 应携带路径与行号（formatHandoffText 语义，vaultPanelModel 测试锁定的输出面）。
        await page(`document.querySelector('[data-vault-tab="ask"]').click()`);
        await page(`document.querySelector('[data-vault="ask-handoff"]').click()`);
        const event = await env.events.wait(
          (e: { type?: string; action?: string }) =>
            e.type === "host-action" && e.action === "openConversationHandoff",
          // events.wait(after) 取本场景的新事件（此前 P5 已投递过一次）。
          env.events.history.length - 1,
        );
        const text =
          (event as { payload?: { content?: Array<{ text?: string }> } }).payload?.content?.[0]?.text ?? "";
        assert.match(text, /notes\/gamma\.md/, "handoff 文本应携带来源路径");
        // 行号同候选 chunk 级区间判据：覆盖第 3 行即可（formatHandoffText 的 L{start}-L{end}）。
        const handoffLines = text.match(/L(\d+)-L(\d+)/);
        assert.ok(handoffLines, `handoff 文本应携带行区间（实际 ${text.slice(0, 160)}）`);
        assert.ok(
          Number(handoffLines?.[1]) <= 3 && 3 <= Number(handoffLines?.[2]),
          `handoff 行区间 L${handoffLines?.[1]}-L${handoffLines?.[2]} 应覆盖第 3 行`,
        );
        assert.ok(text.includes(GAMMA_QUERY.slice(0, 6)), "handoff 文本应携带已核验摘录");
      });

      await check("R3/R9/G28 等价：citation openWith——current 定位 / stale 拒绝 / missing / 未知 receipt", async () => {
        // 真实 receipt：createRun → search（终态）→ prepare_evidence（与旧 R2 面同链路，
        // 现全部经插件 MCP 工具面；receipt 隔离语义由 knowledgeReceiptIsolation 单测锁定）。
        const run = await knowledgeCall<{ runId: string }>("knowledge_query_create_run", {
          query: GAMMA_QUERY,
          clientRequestId: "p8-receipt-run",
        });
        type RunView = { status: string; reason?: string | null; candidates?: Array<{ articleId: string }> };
        let runView: RunView | undefined;
        const deadline = Date.now() + 60_000;
        for (;;) {
          runView = await knowledgeCall<RunView>("knowledge_query_search", { runId: run.runId });
          if (runView.status && runView.status !== "running" && runView.status !== "pending") break;
          if (Date.now() > deadline) throw new Error(`search run not settled: ${JSON.stringify(runView).slice(0, 300)}`);
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        const candidate = runView.candidates?.[0];
        if (!candidate) throw new Error(`no candidate for receipt run: ${JSON.stringify(runView).slice(0, 300)}`);
        const receipt = await knowledgeCall<{
          status: string;
          receipt?: { receiptId?: string };
          receiptId?: string;
        }>("knowledge_query_prepare_evidence", {
          runId: run.runId,
          articleId: candidate.articleId,
        });
        // 返回形态 = {status:"current", receipt:{receiptId…}}（prepareEvidence 服务封套）。
        const receiptId = receipt?.receipt?.receiptId ?? receipt?.receiptId;
        if (!receiptId) throw new Error(`prepare_evidence returned no receiptId: ${JSON.stringify(receipt)}`);

        // current：宿主 openWith → 面板解析 → 切 notes 定位原文（旧 R3 正向 / G28 chip 打开链）。
        const bannerText = async (): Promise<string> =>
          String(await page(`document.querySelector('.vault-banner')?.textContent ?? "<no-banner>"`));
        const waitBanner = async (pattern: RegExp, what: string): Promise<void> => {
          const deadline = Date.now() + 45_000;
          for (;;) {
            const current = await bannerText();
            if (pattern.test(current)) return;
            if (Date.now() > deadline)
              throw new Error(`banner ${what} not reached; last banner: ${current.slice(0, 200)}`);
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        };
        await ui(`window.notifyOpenWith(${JSON.stringify({ kind: "citation", receiptId })})`);
        await waitBanner(/已定位|Located/, "current");
        await waitText('[data-vault="note-body"]', new RegExp(GAMMA_QUERY.slice(0, 6)));

        // stale：摘录窗口外修改原文（追加行）→ 同 receipt 复验 fileSha256 失配 → 结构化
        // 过期提示、零导航（旧 G05/R9-G47「SHA-256 校验拒绝」的 webview 等价面）。
        await import("node:fs/promises").then((fs) =>
          fs.appendFile(join(vaultDir, GAMMA_NOTE), "\n事后追加段：使旧 receipt 过期。\n"),
        );
        await ui(`window.notifyOpenWith(${JSON.stringify({ kind: "citation", receiptId })})`);
        await waitBanner(/引用已过期|stale/i, "stale");
        // missing：删除原文 → 引用原文不可达（旧 G06 语义）。
        await import("node:fs/promises").then((fs) => fs.rm(join(vaultDir, GAMMA_NOTE), { force: true }));
        await ui(`window.notifyOpenWith(${JSON.stringify({ kind: "citation", receiptId })})`);
        await waitBanner(/引用原文已不存在|no longer exists/i, "missing");
        // G28/G29 错误态：未知 receiptId → 服务端 {status:"forbidden",reason:"unknown_receipt"}
        //（evidenceRegistry 结构化落空）→ 面板 missing 分支呈现，不崩溃不导航；unavailable
        // 横幅属资源读链故障面（端点封套 !ok），不在本场景构造。
        await ui(`window.notifyOpenWith(${JSON.stringify({ kind: "citation", receiptId: "rcp_p8_nonexistent" })})`);
        await waitBanner(/引用原文已不存在|no longer exists/i, "unknown-receipt");
      });

      await check("R7-G31 只读等价：审核视图呈现 L2 写路径门（默认关）且提案浏览只读可用", async () => {
        // L2 writePathEnabled 门随 review 栈迁插件 server（write-gate 端点只读呈现）；
        // approve/apply 按降级提示处理（D13 保守缺省），与旧 G31「L2 默认关、纯查看可用」
        // 的只读面等价——真实写边界的 fail-closed 语义由 knowledgeReviewWritePath 单测锁定。
        await page(`document.querySelector('[data-vault-tab="review"]').click()`);
        await waitText(".vault-review-gate-label", /.+/);
        const gateText = await page(`document.querySelector('.vault-review-gate').textContent`);
        assert.match(String(gateText), /已关闭|Disabled/, "L2 写路径门应呈现为默认关闭");
      });

      await env.close();
      process.exit(0);
    } catch (error) {
      await env.close().catch(() => undefined);
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(
          join(root, "obsidian-failure.json"),
          JSON.stringify({ error: String(error), checks }, null, 2),
        ),
      );
      throw error;
    }
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
