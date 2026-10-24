# browser-use / visualize 字节级对齐回退（2026-10-24）

状态：**已实施**。本文记录把 browser-use-plugin 与 visualize-plugin 的我方注释/文档增写
迁移回官方形态的决策与知识去向；与
`specs/official-plugin-sync-2026-10.md`（office/cua 同步）和
`specs/cua-standalone-assessment.md`（producer 重切段）同属 2026-10 官方 packages
对齐批次。

## 背景

插件对照轮（docs 见工作流 dwfrun-d3fa2b6a）判定 browser-use-plugin 0.5.1 与官方
0.5.1 的 13 个差异文件中，除 zcode→drora 改名（`specs/drora-rename.md` 规则 0–8，
保留）外，另有我方在 0.5.14 时代还原/修复过程中留下的注释与措辞增写——**零代码行为
差异**（逐行核实：代码级增删 0 行）。对齐原则：可字节对齐的回退到官方形态，归因
知识迁入本文，不丢失。

## browser-use-plugin 回退清单（2026-10-24 实施）

**构建链更正（实施时发现）**：`scripts/browser-client.mjs` 是 gitignore 的构建产物
（该包 `.gitignore:2`），真实链路为 `packages/core/src/browser-client/*.ts` → core
dist（`tsc`）→ 插件 `scripts/build.mjs`（esbuild 打包 `../core/dist/browser-client/*`
并注入 `nodeRequireBanner`）。故注释增写的**源头**在
`apps/drora-cli/packages/core/src/browser-client/documentation.ts`（6 处）与
`facade.ts:928`（1 处）；回退作用于源头 + 插件侧手动同步产物，随后 core→插件全链
重建，产物 `scripts/browser-client.mjs` 与官方 diff 残余 14 行 **100% 为改名**
（`__zcodeCreateRequire`→`__droraCreateRequire`、`Symbol` 键、品牌词），「修复原因/
Codex」残留 0。

`core/src/browser-client/documentation.ts`（6 处，全部为注释）：

1. `:578` 原注释前缀「修复原因：」移除——原注释本身（fresh kernel 不诱导复用 global
   binding）已是官方原文，前缀是我方还原期标注。
2. `:583` 同上，另移除句尾「（用户工单反馈）」——出处：还原期用户工单报告模型对同站
   URL 反复 `tabs.new()` 填满 IAB 标签页，修复即官方 0.5.1 该行约束本身。
3. `:586` 整行移除：「修复原因：Codex 的模型轨迹会在新 URL 的 goto 后显式确认
   DOMContentLoaded；fallback 也必须保留同一顺序。」——约束已由官方该函数体的
   await 顺序承载，注释是还原期对照 Codex 轨迹的取证记录。
4. `:590`、`:592`、`:710` 「修复原因：」前缀移除（祖先卡片点击/两套 tab 查询合流/
   wrapper 每调用销毁，均为官方原文注释）。
5. `:2013` 整行移除：JSDoc「Codex-compatible runtime browser identity；不能用
   backend type 代替。」——语义（identity 与 backend type 正交）由官方相邻代码与
   `:2011` 附近的官方注释承载。

`scripts/build.mjs`：`:9` 整行移除「修复原因（2026-07-27，node_repl MCP server 整体
连不上）：」——该注释解释 `nodeRequireBanner`（CJS 依赖在 ESM bundle 里的 require
垫片）为何存在：2026-07-27 事故中 node_repl MCP server 整体连不上，根因是打包后
`require("sharp")` 等运行时裸 require 在 ESM 产物中无 require 可用；banner 注入
`createRequire`。该知识另由 node-repl-host `test/bundle-smoke.test.ts` 的
"injects a real require into both ESM bundles" 用例机器守护，注释移除不损失防线。

`docs/overview.md` `:37`、`docs/playwright.md` `:50/:54/:56`、`docs/workflow.md`
`:40`、`skills/control-browser/SKILL.md` `:152/:163/:169/:173`、`docs/api.json`
（playwright 描述）：移除「Codex-compatible / Codex's / matching Codex IAB /
matching the current Codex runtime / follows the current Codex client」措辞插入，
恢复官方原文。这些措辞是还原期对照 Codex 桌面行为时的标注；对应的**行为约束本身**
（3000ms 失败预算、networkidle 不支持、expectNavigation 先启动 load-state waiter、
IAB file chooser 不支持、goto 后确认 DOMContentLoaded）全部是官方 0.5.1 文档/代码
原生内容，一字未动。

**保留不改**（有意分歧）：

- 全部 zcode→drora 改名（含 `Symbol("drora.playwright.locatorDetails")` 与
  `Symbol.for("drora.node-repl.browser-control-bridge")` 注册表键——两侧契约一致，
  `specs/drora-rename.md` 规则 1–8）。
- `docs/api.json` 的数组展开排版：我方格式化工具链产物，与官方紧凑排版语义等价
  （JSON 解析后仅改名与已回退的措辞差异）；为字节对齐而改排版会与本仓 fmt 工具链
  冲突，不做。

## visualize-plugin 回退清单

`skills/visualize/assets/vendor/lucide-1.17.0.js`：移除尾部
`//# sourceMappingURL=lucide.js.map` 注释行（指向包内不存在的 map 文件；官方无此行，
系我方 vendoring 时未剥离 npm 原始注释）。移除后与官方 CRLF 归一逐字节一致。
vendor 其余 8 文件的行尾差（官方 CRLF/我方 LF）属仓库行尾策略，不动。

## 验收（2026-10-24 实测）

- browser-use 回退后逐文件 diff（CRLF/BOM 归一）vs 官方 0.5.1：`docs/playwright.md`、
  `docs/workflow.md` 与官方**逐字节一致**（0 差异行）；其余 11 文件残余差异行 **100% 为
  zcode→drora 改名等价替换**（ZCode→Drora / ZCODE_PLUGIN_ROOT→DRORA_PLUGIN_ROOT /
  @zcode→@drora / zcode.playwright→drora.playwright / 注册表键），零内容级残留。
- `docs/api.json`：JSON 树深度比对**语义等价（modulo 改名）**——键集、数组长度、
  全部字符串值逐点相等；残余 60 行字节差全部为数组展开排版（我方格式化工具链产物，
  见「保留不改」）。
- `node --check scripts/browser-client.mjs` 语法通过；`pnpm --filter
  @drora/browser-use-plugin test` → 3 文件 / 3 用例全绿；core→插件全链重建
  （`pnpm --filter @drora/core build` + 插件 `pnpm build`）后复核产物干净。
  备注：core 构建 exit 2 为**既有**跨包 dist 陈旧问题（`src/agent/*`、`src/mcp/*` 报
  `@drora/contracts` 缺 `ModelCallWrapper` 等导出，browser-client 相关 0 条错误；
  与本批纯注释改动无关；tsc 照常产出 browser-client dist，故插件链路不受影响）——
  待 contracts dist 重建轮处理，不在本 spec 范围。
- 根门禁：`pnpm typecheck` exit 0；`pnpm lint` exit 0（421 warnings 为基线，0 errors）。
- visualize：`lucide-1.17.0.js` 移除 sourceMappingURL 尾行后（601,645 bytes）与官方
  **CRLF 归一逐字节一致**。
