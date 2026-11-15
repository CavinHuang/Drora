# v3.18.0 合并清单——上游改动 × Drora 关系逐文件定谳

- 日期：2026-11-12（当日晚间按 main 同步后基线 `4c9be763b` 复跑刷新）；上游 `b95ebaffea`（v3.18.0），基点 `a9fe401ee`（v3.17.2）
- 首版基线 `42bacc627`；并行会话推入 CUA W5 收官（`fb4110003`）与 Vault 抽离官方插件（`4c9be763b`）后 22 条桶位漂移（20 条 FAST-FORWARD→THREE-WAY，集中在 plugin-ui/plugins/mcp 面），已按新基线复跑全量
- 上游总变更 **5,847** 条（M 2,925 / A 2,171 / D 751，git 零 rename 配对）
- 机器可读明细：本目录 [01-merge-inventory.tsv](01-merge-inventory.tsv)（5,847 行 × 桶/上游路径/Drora 路径/两侧行数）

## 0. 方法与口径

逐文件分类器（`D:\workspace\tmp\upstream-v3.18.0\classify-inventory.mjs`，git 对象层）：

- 对上游每个变更文件，把 **v3.17.2 基线内容**按 `scripts/upstream/transform-upstream-tree.mjs` 的改名规则（specs/drora-rename.md 三区：normal 全变换 / cua-limited 仅 `@zcode/`→`@drora/` / verbatim 逐字）变换成「期望的 Drora 形态」，与 **Drora HEAD 实际内容**比较（BOM 剥离 + CRLF→LF 规范化）：
  - 期望==实际 → Drora 与 v3.17.2 **仅品牌差异**（可整文件替换）；
  - 不等 → **真分叉**（行数为「裁剪公共前后缀后中段 max 行数」近似口径，用于排序分层，非精确 diff 行数）。
- Drora 路径 = `mapRelPath(上游路径)`（`zcode-protocol→drora-protocol`、`zcode-agent→drora-agent`、`apps/zcode-cli→apps/drora-cli` 等目录改名自动命中；THREE-WAY 明细第 4 列即 Drora 侧路径）。

## 1. 总表：10 桶 × 处置

| 桶 | 数量 | 含义 | 处置 |
|---|---|---|---|
| **FAST-FORWARD** | **2,322** | 上游 M，Drora 与 v3.17.2 仅品牌差异 | 机械：整文件替换为 `transformContent(v3.18.0 版)` |
| **NEW-TEXT** | 2,159 | 上游 A，Drora 无对应 | 落位变换后新增（纯新增零撞名：NEW-COLLISION=0） |
| **DEL-FOLLOW** | **703** | 上游 D，Drora 侧仅品牌差异 | 跟随删除（上游 test 重组旧路径为主） |
| **THREE-WAY** | **532** | 上游 M × Drora 真分叉 | **人工逐个三方合并（核心工作面）** |
| **ALREADY** | 69 | 上游 M 但 Drora 现状已与 v3.18.0 变换后一致（上游多为空白级改动/本仓已提前同步） | 零动作（抽查过 documents-plugin skills、CLI e2e run.mjs 等，upstream 行数=0 居多） |
| **DEL-KEEP** | **47** | 上游 D 但 Drora 侧有真分叉内容 | 裁定：Drora 本地改动跟随迁移到上游新路径 or 退役（§4） |
| **NEW-VERBATIM** | 8 | 上游 A 落 third-party 等 verbatim 区 | 逐字新增 |
| **NEW-BINARY** | 4 | 二进制新增 | 逐字新增 |
| **DEL-ALREADY** | 1 | 上游 D 且 Drora 侧本就没有 | 零动作 |
| **MOD-ABSENT** | **2** | 上游 M 但 Drora 已删除该文件 | **裁决区冲突**（§5） |

**工作量结构：机械面 5,196 条（89%）vs 人工面 581 条（THREE-WAY 532 + DEL-KEEP 47 + MOD-ABSENT 2）。**

## 2. THREE-WAY 513 分层（核心人工面）

交叉分层（diverge=Drora 侧分叉行 / upstream=上游改动行，均为中段近似口径）：

| 层 | 数量 | 说明 |
|---|---|---|
| 难（双 >100 行） | **212** | 双侧大改，逐 hunk 人工合并 |
| 中（Drora 侧 ≤100 行） | 210 | 以上游为底、重放 Drora 小改 |
| 中（上游 ≤20 行） | 35 | 以 Drora 为底、捡上游小改 |
| 易（Drora≤10 且上游≤50） | 75 | 多为小 diff，快速过 |

按目录：packages/desktop 134 / apps/drora-cli 117 / packages/ui 78 / services 24 / shared 23 / docs 合计 ~72（testing 21+superpowers 21+ui 8+working-memory 6+其余）/ web 3 / server 3 / client 3 / drora-server-cli 4 / 根文件与 scripts ~12。

### 难层 Top 40（diverge | upstream | Drora 路径）

```
39592 | 65589 | THIRD-PARTY-NOTICES.md                    （生成物：licenses.mjs 重跑）
32035 | 33700 | third-party/inventory.json                （生成物：同上）
27641 | 14298 | scripts/architecture/upstream-snapshot.json（生成物：regenerate）
26143 | 25744 | pnpm-lock.yaml                            （重装收敛）
12741 |  7132 | apps/drora-cli/packages/core/tests/runtime-tool-loop.test.ts
 9550 |  9073 | packages/ui/src/i18n/locales/en-US.ts     （键全集合并+本仓键保留）
 8993 |  8589 | packages/ui/src/i18n/locales/zh-CN.ts     （同上，双语 parity）
 6527 |  7920 | packages/services/src/drora-agent/droraAgentService.ts
 6320 |  6962 | packages/ui/src/v4/SessionPane.tsx
 6027 |  6255 | apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/product-projection.ts
 5623 |  5744 | .agents/skills/feature-boundary-planner/references/drora-feature-graph.yaml
 5134 |  6024 | docs/conversation-session-case-catalog.md
 5025 |  6990 | docs/testing/conversation-session-e2e-coverage-matrix.md
 4992 |  4492 | packages/shared/src/drora-protocol/index.ts
 4736 |  5329 | packages/desktop/wdio.conf.ts
 4552 |  4439 | apps/drora-cli/packages/bootstrap/src/drora-protocol/server-operations.ts
 4196 |  4435 | packages/desktop/src/host/index.ts
 4178 |  3686 | apps/drora-cli/packages/core/tests/runtime-compact.test.ts
 3326 |  3633 | packages/services/src/node.ts
 3233 |  3184 | packages/ui/src/app-shell/WorkspaceShellLayout.tsx
 3206 |  3014 | packages/services/src/drora-agent/droraTaskServiceAdapter.ts
 2997 |  2982 | packages/ui/src/v4/ConversationComposer.tsx
 2951 |  2978 | apps/drora-cli/packages/adapters/src/plugins/marketplace.ts
 2872 |  2594 | docs/dynamic-workflow/launch.md
 2668 |  2635 | packages/desktop/src/main/index.ts
 2621 |  6403 | apps/drora-cli/packages/cli/tests/cli.unit.test.ts
 2501 |  2609 | apps/drora-cli/packages/bootstrap/tests/session-persistence.test.ts
 2434 |  2247 | packages/ui/src/v4/ConversationStatusPanel.tsx
 2356 |  2263 | packages/ui/src/SettingsPage.tsx
 2058 |  1272 | docs/dynamic-workflow/presentation.md
 2052 |  2266 | packages/ui/src/v4/ConversationTimeline.tsx
 1921 |  1840 | packages/desktop/src/main/autoUpdater.ts   （×本仓 update-feed-github 裁决区）
 1882 |  1925 | packages/desktop/test/e2e/fixtures/upstream/conversation-session/conversation-session-subagent-respond-to-coordinator.json
 1838 |  1911 | packages/ui/src/components/ai-elements/message.tsx
 1832 |  2337 | architecture-policy.yaml                    （12 新 managed 模块+adopt 重放）
 1822 |  1949 | packages/ui/src/lib/workspaceSidePane.ts
 1818 |  1911 | apps/drora-cli/packages/bootstrap/src/drora-protocol/v4-bridge.ts
 1780 |  1841 | packages/shared/src/validation.ts
 1759 |  1725 | packages/ui/src/v4/ConversationTurnGroup.tsx
 1693 |  2138 | packages/ui/src/hooks/useAppPanels.ts
```

（完整 212 条见 TSV 过滤 `$1=="THREE-WAY" && $5>100 && $6>100`；其余 309 条为中小层。）

### 中小层 309 条的目录主题（配合报告 §3 归因）

- `packages/desktop` 130 条：main/host/preload 契约文件 + electron-builder/installer.nsh/打包脚本 + scripts E2E 基建
- `apps/drora-cli` 110 条：core/bootstrap/adapters 的 runtime·executor·plugins 热区（上轮 model-capabilities 接线区）+ tests
- `packages/ui` 78 条：v4 会话面组件 + settings 三件套 + i18n 双语 + browser-use + plugin-ui 面（Vault 抽离新分叉）
- `shared/services` 46 条：drora-protocol 双目录、channels、node、bots、drora-agent 双件

## 3. FAST-FORWARD 2,341 / DEL-FOLLOW 704 / NEW 2,171（机械面）

- FAST-FORWARD：合并引擎（apply-segment）按「变换 theirs 整文件写入」处理；**含全部 desktop test 重组的 524 移动+修改对与 134 纯移动**——Drora 侧内容与 v3.17.2 仅品牌差异的文件，上游新路径版本直接落位。
- DEL-FOLLOW 704：上游删除且 Drora 无本地实质改动（test 重组旧路径绝大多数）——机械跟随删除，与 658 迁移映射对账。
- NEW 2,171：四个新包/新模块/design-plugin 361 资产/新测试/fixtures——变换落位（第三区 verbatim 8 条逐字、二进制 4 条逐字）。**上游新增与 Drora 现有路径零撞名**（v3.17.2 的 47 例 new-collision 本次为 0）。

## 4. DEL-KEEP 46（上游删除 × Drora 本地有改动）——逐个裁定

45 条为 desktop/web test 重组旧路径 + 2 条 CLI dist-types（.d.ts.map，直接跟随删除；其中 server.d.ts.map 因 CUA 战役本地改动转为 KEEP）。按 Drora 分叉行数分两档：

- **品牌级/微改（diverge ≤15 行，约 20 条）**：如 `conversation-session-plugin-mcp-skill-workspace-inherited`(2)、`v4-input-control`(3)、`browser-empty-state-deferred-guest`(3)——按 FAST-FORWARD 语义处理（跟随迁移删除，本地微改如有价值挑拣进新路径）。
- **本地大改（diverge >100 行，约 15 条）**：`conversation-session-chat-loading-live-tail`(689)、`anthropic-reasoning-history-replay`(631)、`goal-run-cases`(619)、`e2ecase-regression`(545)、`git-commit-dialog-ui-flow`(444)、`compact-auto`(448)、`automation-cron-create`(364)、`tool-cross-product`(321) 等——这些是 Drora 在 v3.17.2 后实质演进的测试，上游已把场景搬到新目录（§3.2 的 658 映射）但**未包含 Drora 本地改动**：需把 Drora 改动逐个重放到新路径版本，无法重放的退役并在 spec 登记。

## 5. MOD-ABSENT 2 —— v3.17.2 裁决删除区再冲突

| Drora 状态 | 上游 v3.18.0 改动 | 裁定项 |
|---|---|---|
| `packages/desktop/src/main/forceUpdateGuard.ts` **已按 update-feed-github 裁决删除** | M +176 行 | 继续保删除（登记分歧台账）或恢复采纳上游新版 |
| `packages/desktop/src/main/manifestUpdateProvider.ts` **同上已删** | M +232 行 | 同上；注意上游本版还给它加了 `zcodejwttoken` 鉴权头与 logger |

关联：`autoUpdater.ts`（THREE-WAY 难层，上游行为反转：全平台 `autoInstallOnAppQuit=false`+删 before-quit 安装）也属发行通道域——建议 D5 裁定时三文件一起看。

## 6. 与 99-final-report 的关系

- 本清单是报告 §2「2,490 冲突候选（路径级近似）」的**内容级精确替代**：路径级交集 2,490 → 内容级真分叉 513（其余 1,977 条经品牌变换归一后落入 FAST-FORWARD/DEL-FOLLOW 机械桶）。
- 报告 §3 的模块分析（功能主题、契约字面量、架构判断）适用于本清单所有桶的语义理解；§6 D1-D10 裁定项仍是方案前置。
- 三方合并建议切分（沿用报告 §7 S1-S8）：本清单 TSV 可按桶+目录直接喂给 apply-segment/merge-dryrun 分段清单。
