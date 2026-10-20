# ZCode v3.16.1 分段合并执行计划（S0 产出）

状态：S0 完成（2026-10-20）。执行器：`scripts/upstream/merge-dryrun.mjs`（base=/tmp/golden/base-transformed、theirs=/tmp/dryrun/theirs，重生成命令见文末）。逐路径机器可读清单：`/tmp/dryrun/inventory.json`（4546 条）与 `/tmp/dryrun/conflicts.json`。

## 结局总表（段×结局）

| 段                       | total | take-theirs | new | clean-merge | delete | conflict | 决策类 | zone-decision |
| ------------------------ | ----- | ----------- | --- | ----------- | ------ | -------- | ------ | ------------- |
| S1 根配置+shared/rpc     | 166   | 84          | 45  | 16          | 6      | 13       | 0      | 2             |
| S2 drora-cli             | 829   | 498         | 232 | 56          | 8      | 31       | 0      | 4             |
| S3 services/server/…     | 430   | 222         | 161 | 20          | 18     | 9        | 0      | 0             |
| S4 desktop               | 1129  | 487         | 583 | 14          | 24     | 18       | 3      | 0             |
| S5 ui/web                | 1594  | 784         | 477 | 28          | 274    | 24       | 7      | 0             |
| S6 cua/docs/scripts/资产 | 398   | 155         | 198 | 14          | 5      | 13       | 1      | 12            |

决策面 = conflict 108 + theirs-modify-ours-deleted 3 + delete-decision 8 + zone-decision 18 = **137 条**；其余 4409 条机械落地（take-theirs 2230 / new 1696 / clean-merge 148 / delete 335）。

## 裁定决策表（S0 核查三审定）

1. **forceUpdate 家族 3 条（S4 theirs-modify-ours-deleted）**：维持删除。上游改动已核实无移植价值（manifestUpdateProvider 仅断言收窄+注释前缀；forceUpdateGuard.test 纯换行；manifestUpdateProvider.test 删 2 断言）。
2. **S5 delete-decision 7 条**（WebRemoteControl{Dialog,MobileTaskHome,TaskIndexRow}.tsx、WorkspaceSidebarCollapsedRail、webRemoteControlTaskIndex.ts、workspace-grouped-tasks/task-row.tsx、v4ConversationDraftEmptyStateLogo.test）：随上游删除旧路径 + 把 Drora 增量移植到新模块（上游整删 -4526 行；Drora 增量证据 ead2fd306 自动开启闸门、7ced6f898 D 形水印→继任测试、team-ui 两提交）。新落点 project-sidebar/ 与 web-remote-control/ 模块（new 条目）。**必须与新模块 new 条目同批落地**。
3. **scripts/prepare-prebuilds.mjs（S6）**：保留 ours（Drora 深度自研：npmmirror node dist、browser-use-plugin、CUA 三方清单；desktop package.json `prepare:remote-assets` 仍引用）。上游删除系改用 prepare-runtime-assets 脚本族；**S4 合并 desktop/package.json 时不得整体 take-theirs**，须显式保留 prepare 脚本引用（跨段耦合对，见下）。
4. **zone-decision 18 条**：packages/zcode-cua 5 条按 R3 冻结 0.6.3（上游 0.6.5 仅登记）；third-party 7 条 Drora 拥有，其中 noto-sans-sc LICENSE 等 3 个上游新增做许可补齐甄别；zcode-cua-plugin 4 条 Drora 拥有+上游增量人工甄别；双 lockfile 2 条按段 `pnpm install` 重装不手并。
5. **conflict 108 条**：按段人工/代理三方合并；重灾区 WorkspaceShellLayout.tsx(40 hunks)、webRemoteControlManager.ts(7)、clientConfig.test.ts(4)、prepare-agent-node-bundle.mjs(4)、Root.tsx(6)、host/index.ts(4)。

## 跨段耦合对（落地顺序约束）

0. **已发生的 S6→S1 提前落地**（S1 核查三补记）：`patches/@radix-ui__react-collapsible@1.1.12.patch`（package.json patchedDependencies 引用，缺文件 pnpm install 必败）；`.oxlintrc.json`（max-lines 800 上限提前，还原区精细豁免保留、上游整目录 packages/zcode-cua 豁免不采纳）。S6 执行时此二项标记已落地。
1. S1 shared/web-remote-control.ts（V2 契约）↔ S4 webRemoteControlManager/windowRemoteConnectionRegistry ↔ S5 WebRemoteControl\* 删除族——R1 链，S5 七条必须与新模块同批。
2. S1 channels/clientConfig/validation ↔ S2 protocol-v4 handlers ↔ S5 SettingsPage 家族。
3. S3 services/index/node/droraTaskIndexSyncer ↔ S4 host/index.ts ↔ S5 webRemoteControlTaskIndex 删除族（task-index 契约链）。
4. S6 prepare-prebuilds（keep-ours）↔ S4 desktop/package.json（prepare 引用）。
5. S1 vitest.config.ts（R4 取上游）↔ 各段新增测试目录。

## S1 执行补记（核查后修复，4f814061 + fixup）

- 决策：`build:web-remote-control`/:v3/:v4 三脚本随上游删除（部署已走 server-cli `prepare:remote-assets`，docker 独立脚本不存在，仅 docs/web-remote-control/\*.md 文档引用——S6 文档段更新）。
- 恢复：`packages/rpc/test/network-telemetry-middleware.test.ts`（自研模块测试，上游删其测试但 Drora 保留模块源码与 services 消费方）。
- 清理：desktop/src/scheduler/schedulerProtocol.{js,js.map}（typecheck 构建污染；.d.ts/.d.ts.map 系 780721e7 既有跟踪产物，非污染）。
- 待办登记：R2 `build-drora.mjs` 注入 `__DRORA_MIN_COMPATIBLE_VERSION__`（当前 fallback=DRORA_VERSION，S7 前实现）；`workflowBlocked` \_meta 键是否归敛 shared/contracts 常量（S2/S3 评估）；全仓 fmt 基线 729 文件未过，S7 统一 `pnpm fmt`。
- 已知跨段破坏（S1 契约先行）：全仓 typecheck 426 error（ui 401/web 16/services 8/client 1），清单 /tmp/dryrun/s1-cross-breakage.txt，S3/S5 收口。

## S2 执行补记

- zone 决策 4 条全部**保 ours**：`zcode-cua-plugin/{.zcode-plugin/plugin.json,package.json}`（上游 0.6.4→0.6.5+MIT→Apache-2.0；本仓冻结 0.6.3 字节不随动，license 变化登记不应用——还原保真优先）；`scripts/sync-cache.mjs`（上游注释改 monorepo 路径，Drora producer 链仍走仓库 clone 形态）；`scripts/resolve-pnpm-invocation.mjs`（上游删除系其 monorepo 迁移；本仓 bump-zcode-cua-producer.mjs 活跃引用，保留）。
- 31 冲突逐案解决（代理执行+typecheck 七包过）：要点=protocol-v4 handlers import 统一 session-execution 聚合入口、session-flow highspeed 分支保留 W03 证据守卫（有意分歧）、server-operations 并集（team 目录失效+resume 失败回收）、contracts tools 并集（vault-search+tool-search）、official-plugin-definitions computer-use 钉 0.6.3（与冻结资产对齐）、package.json 版本保 0.0.1。
- 依赖包 dist 重建教训：合并后先 `pnpm --filter <pkg>... exec tsc` 重建再 noEmit，跨包报错多为陈旧 dist。
- 失败收口（c62b2c32）：12 失败根因分类——S03 有意分歧适配 7 / mcp-runtime 洞 1a 分歧 1 / S2 冲突遗留 turn-errors 1 / 上游新机制集成 2（vault-search shouldDefer、census 22→23）/ obsidian realpath 真 bug 1 / 产物与依赖 3（office dist、tui bundle、office-runtime lockfile、v4-gateway 超时）/ team 白名单测试 1。终态 `pnpm test:upstream-cli` 19 包 0 失败。本轮核查收尾：evidence-session-wiring 守卫位置同步（verifyEvidenceOrThrow 前移至 fork-edit-retry rewind 前、guide 降级归 session-flow 原始发送裁决，用例改走新守卫入口）、backup 测试产物清理（git rm adapters/backup 下 4 个误提交文件 + apps/drora-cli/.gitignore 忽略 `backup/`）。

## S4 执行补记

- **R1 决策修订（登记）**：Relay V2 **主干落地**于 S4（9a5a6c1a：webRemoteControlManager/transport/protocol V2、JWT 注册+一次性连接 token、V1 认证/传输删除，覆盖客户端/桌面/契约三侧）；**自建 `packages/relay-server`（A 类保护区，S4 零触碰）的 V2 wire 契约适配转为后续任务**（合并外独立任务，登记在案），适配完成前 V2 端点以官方云 relay 为准、与官方端互为可替换的验收顺延。此条修订 R1 原文「relay-server 适配作为合并内任务」的口径，不影响 R1 采纳 V2 本体。
- **S5 阻塞项**：`packages/desktop/src/renderer/src/sourceSettingsServicePortBridge.ts`（+ 同名 test）消费 `@drora/ui` 的 `registerSourceSettingsServices` 导出与 `InternalChannels.SourceSettingsServicePort` 契约。S5 合并 ui SettingsPage/删除族时必须保持该导出与通道契约兼容，落地时以 desktop typecheck（tsconfig.main/renderer）+ `sourceSettingsServicePortBridge.test` 验证，否则 desktop renderer 源设置桥断裂。
- 已知跨段破坏（S4 后）：全仓 typecheck 134 error（ui 116 / web 18，较 S3 508 降 374），清单 /tmp/dryrun/s4-cross-breakage.txt，S5 收口。

## 段表补记（回写 spec 的枚举）

S3 = packages/{services,server,provider,provider-node,client,drora-server-cli,model-option-map,android,formal-proof,share-ui,web-share,stream-animate,e2e-report} + harness/ + config/；S5 = packages/{ui,web,mobile-web} + public/。

## 重生成命令

```sh
node scripts/upstream/transform-upstream-tree.mjs --ref aac4755666d09fdcd70272fcf063c077a639015f --out /tmp/golden/base-transformed
node scripts/upstream/merge-dryrun.mjs   # theirs 树缓存在 /tmp/dryrun/theirs
```

黄金校验终态：445 differ / 194 Drora 独有 / 11 上游独有（较首版 473 修复：/zcode-cua/ 占位收紧为 assets/zcode-cua/、zcode/electron/releases 恢复保护——依据 HEAD 11d92f9be 与核查二）。

### S4 环境预存失败登记（核查二）

- desktopPetLibrary「upgrade preparation」：macOS `/var` vs `/private/var` realpath 环境差（测试与实现 S4 零 diff）——S7 复核是否需与 obsidian realpathLongestExistingPrefix 同法修复。
- desktopMobileLanRelayHost「内嵌宿主生命周期」：断言 dist 含 3.15.1 资源路径，本地 dist 为 dev 构建（零 diff）——S7 构建后复跑。
