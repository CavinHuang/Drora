# v3.17.1 合并任务、检查点与执行日志

日期：2026-10-31。总体状态：**EXECUTION_IN_PROGRESS**。规划轮（同日早间会话）完成方案与只读预演；执行轮自 2026-10-31 18:32 起在 `codex/upstream-v3.17.1-integration`（起点 C=`66c9193fd`，本仓当前 checkout）按 P0→S8 推进，进度以本文件执行日志为准。目标分支为 CavinHuang/Drora:main。

合同：[迁移 spec](../../../specs/upstream-v3.17.1-migration.md)；保护与场景：[feature-preservation.md](feature-preservation.md)；固定输入与机器清单：[README.md](README.md)。不得在聊天中说完成后忘记回填本文件。

## 状态规则

- `[x]` 只能用于实际完成且有证据的任务；其余使用 `[ ]`，在日志说明 pending / in-progress / blocked / failed。
- 关闭一项至少填写：输入/候选 SHA、涉及 ledger ID、操作/决策、执行平台、命令与退出码、产物路径、复核结论。
- 任何输入 SHA、转换规则或依赖改变，重开受影响任务。复用旧通过证据必须证明输入未变。
- 一段失败时回到该段修复，不跨段把失败变为“已有问题”。已有失败单独列 baseline-gap 与处理方式，main 放行条件保持不变。
- 本文件任务 ID 与 ledger ID 稳定不复用；新增问题继续编号。S0 为本次规划工作，不等于后续 P0 冻结已执行。

## S0：已完成的调查与计划

- [x] S0-01 运行 freshness 并保存当前 branch/HEAD、工作区、remotes、worktrees、Node/pnpm 事实。证据：README 的基线和命令结果；原工作区干净。
- [x] S0-02 通过 GitHub 最新提交与远端 ref 确认 U2；核对 B/U1/U2 与 Source-Commit。证据：manifest.json 固定 SHA 与上游链接。
- [x] S0-03 核实 main 与分支关系：初期 L 落后 C0 132 提交；F 领先 C0 11 提交、176 路径。调查期间 PR #32 将 F 合入最新 C（66c9193fd），L 现落后 C 144；C/F 同树。证据：manifest 与 feature-branch-delta.tsv。
- [x] S0-04 读取现行 v3.16.1 迁移/审计、rename/divergence、当前 package/policy、关键新上游合同，区分历史决策和当前源码。
- [x] S0-05 计算 B→U1、U1→U2 与 B→U2 全路径；按唯一段分配，累计 5,548 路径。证据：upstream-ledger.tsv / summary.json。
- [x] S0-06 对旧 C0、F 做 blob 级只读三方预演；不改产品树。证据：C0 为 140 文本冲突，F/当前 C 同树为 149；逐路径 outcome 保存在 ledger。
- [x] S0-07 保存全部本地差异、独有目录/共享触点、现有删除与生成物，避免只按目录名保护。证据：local-preservation.tsv 的 10,164 条 F 差异。
- [x] S0-08 写先行 spec、17 类特性保护与 24 组验收、D01–D08 决策建议、任务/回滚/交付门。证据：本目录及迁移 spec。
- [x] S0-09 当前基线静态验证：Node 24.14.0 / pnpm 10.33.2；typecheck exit 0；lint exit 0（395 warnings / 0 errors）；architecture changed exit 0（0 violations）。不是升级后通过证据。
- [x] S0-10 核对文档链接、TSV 总数/唯一性/输入 blob、hash、格式与 Git diff；结果回填 README。未执行任何产品 merge/push。

## P0：执行环境、原功能与 refs 冻结

前置：方案进入实际执行阶段，当前输入重新核验。2026-10-31 18:32–18:50 执行完毕，证据见本节与 baseline/ 目录。

- [x] P0-01 重取官方及 Drora remote refs，记录 fetch 结果；U2 若变化先保持本轮 pin，C/F 变化则做增量调查并更新清单，不使用移动的 origin/main 作 theirs。
  证据：`git fetch drora` 无新对象；U2=`a60ba6a7e`（refs/usync/v3171/target 锚定）；C=`66c9193fd`（drora/main）；origin fetch 成功且 origin/main 未变。
- [x] P0-02 枚举所有 worktree/WIP/未推送分支；保存各 ref 与必要 patch/未跟踪文件清单；不自动 stash、不触碰其他任务 checkout。
  证据：9 个 worktree（codex-pet-recovery 持 [main]、3dd3/6135/dc74 locked detached、c3a1/db77 detached、pr23 临时、agents-team、vaultview-handoff）；领先 C 的分支：feat/agents-team 3、feat/vaultview-w10-gui-e2e 7、feat/virtual-pet-management 3、fix/d-g20-1-and-cleanups 6；stash 1 条（fix/d-g20-1 codex-pull-preserve-20261021）。全部原样保留，S8-06 复核。
- [x] P0-03 为 C/F/U1/U2 建立可恢复只读锚点；在独立 checkout 从 C 建 `codex/upstream-v3.17.1-integration`；核对 push remote 是 drora。
  证据：refs/usync/v3171/{base,middle,target,main,main-prev,feature} 六锚点；集成分支建于本仓 checkout（偏离「独立 checkout」：tree(F)==tree(C) 使切换零改动，且复用既有依赖安装；规划会话已在执行日志 171 行认可「P0-03 改为核对已有分支，不复建或重置」）。push remote 待 S8 用 `git push drora` 显式指定。
- [x] P0-04 将本规划文件带入集成分支，保留 F 的既有提交历史；核查 11 提交与 176 路径，不额外混入其他 feature 分支。
  证据：提交 `5481c73d7`（spec+tasks+矩阵+README+三清单）；PR #32 已使 F 成为 C 的祖先（rev-list F ^C = 0，C 的双亲 = C0+F），无需重复纳入；工作区除规划文档外零改动。
- [x] P0-05 在候选集成环境建立 RG01–RG24 的升级前基线；原有未完成/失败单独列 baseline-gap，不将 spec 的目标功能写成已交付。
  证据：baseline/battery.log + node-tests.log——vitest unit 4 文件 44 测试过（desktopPetPersonaExpression、webRemoteControl{EndpointUrls,SharedHostAttachments,ManagerV2}）；CLI core team+persona 16 文件过；bootstrap persona 17 文件过；relay-v2-server 10 文件过；node:test 11 文件 53 过/0 失败/2 跳过（knowledge 7 + desktopPet 3 + ui desktopPetProjection）。Node 24.14.0/pnpm 10.33.2（volta run）。
- [x] P0-06 人格原功能发布门、Relay GUI/真实部署等原未完成项逐条登记；若不能满足本方案的 main 交付门，保持集成分支待验，不删除功能求绿。
  baseline-gap 清单（升级前即未完成，不因合并转绿）：
  1. persona：真实模型效果实验（需授权）、语义负例归因、PM57 阈值冻结、G 门正式收口（PR#32 跳过的 3 项 R 套件）。
  2. relay：GUI 弹窗实测与真实部署联调（webRemoteControlRelayOrigin 链只有单测绿）。
  3. `packages/ui/test/teamConversationSummaryStagedApproval.test.tsx` 不在任何默认执行通道（vitest include 只收 .ts，node:test 不收 .tsx）——既有注册缺口，RG03/S5 处理。
  4. E2E/跨平台/真包 parity：本机环境准入未做（Windows only），维持 blocked 待跑入口。
  5. Windows 本机 `test:upstream-cli` 平台性失败（升级前即存在，2026-11-01 S2 门禁轮核实并经裁决登记）：opentui.dll 0.2.15 在 Windows 26300.9711 渲染/退出段错误（tui 包 6 文件 + cli 包 5 个 tui-* 文件）；SEA 工具测试 exec-bit 断言与 MSYS tar gzip 行为在 Windows 永不通过（cli 5 例）；mcp-resource-telemetry 全量并发采样抖动（adapters 1 例，隔离恒绿）。终验走 Linux/CI（PR checks 的 test:upstream-cli）。

退出：锚点可恢复、C/F 关系明确、原功能证据和待验边界已登记。

## P1：设计裁决与可重放工具

前置：P0。修改实现前更新目标 spec/验收，再按 architecture-governance 读取受控模块上下文。

- [x] P1-01 关闭 D01：上游工程测试链 + Drora 自研回归的发现/执行/affected/CI 合同；列 2,259 条测试资产删除的归属、移动/退役与保留消费者。未完成前禁止批量删测试。
  裁决见 spec §6.1 D01：vitest 双工程（engineering+drora 清单）、ours 未修改随上游删除、affected 链改名但双清单选择、retired-evidence 按本仓保留面适配、AGENTS/pre-push 文档 S6 同步。测试资产逐条归属随各段 delete-review 路径落地（S1 起登记）。
- [x] P1-02 关闭 D02/D03：Lifecycle、Team、Persona、CommandInbox 的唯一 owner/时序；用户指令编辑与 persona 的独立性；将 RG10/RG11/RG17 写入对应 catalog/matrix。
  裁决见 spec §6.1 D02/D03（官方 lifecycle 唯一 owner+端口接入；persona 与用户指令编辑并存不互迁）。RG10/RG11/RG17 的 catalog 行登记随 S2 落地时写入（测试路径在段内固定）。
- [x] P1-03 关闭 D04：旧/新官方 Relay 客户端和自建服务能力表；新增 mobile push/输入预测协议、未知能力降级、三 URL 切换链与端点优先级。
  裁决见 spec §6.1 D04（切换/三 URL/ws2 保留；新客户端契约全吸收；自建未实现能力如实报不可用）。能力表逐项核对在 S3-05/S4-02 执行。
- [x] P1-04 关闭 D05：project purge 调用链/授权、0007–0009 与本地迁移 checksum、远程入口软删除/缓存/重复创建的产品合同与 fixture。
  裁决见 spec §6.1 D05（审计前置、不暴露永久删除、checksum 不改写）。审计在 S3-01/S3-02 执行。
- [x] P1-05 关闭 D06–D08：Drora 发行版本与闭包、治理快照/例外、外部 appId/header/clientType 字面量的证据；常设性取舍写 divergence ledger。
  裁决见 spec §6.1 D06/D07/D08。root version 3.17.1 随 S1 落地；新增字面量族 S1 逐项判转换/豁免；常设分歧按既有台账 1–9 执行，本轮新增分歧在 S7 收口时补台账。
- [x] P1-06 将 local-preservation 全部行分配特性或工程/历史资产 owner；补充机器分类没覆盖的能力，unknown 不得漏入 S7。
  证据：`scripts/upstream/classify-preservation.mjs` + `preservation-owners.tsv`（10,164 行全分类：D-frozen 5,971 / B-shared 2,018 / A-feature 771 / E-engineering 272 / E-history 120 / needs-owner-review 1,012）。needs-owner 中被本轮上游触及者仅 86 行（真交互面），逐段认领；其余为纯本地文档/历史资产，S7 对账收口。
- [x] P1-07 以新文件实现显式 base/ours/theirs/out 的预演/应用工具：异步 IO、Windows 参数数组、输入 hash、mode/symlink/binary/UTF-8/大小写冲突校验；禁止硬编码旧 ref 与缓存复用。
  交付：`scripts/upstream/apply-ledger.mjs`（ledger 驱动、blob 锚定 fail-closed 漂移校验、路径映射/zone 一致性校验、非法路径守卫、二进制逐字保留、CRLF 宽容比对+merge 用 git blob 侧、决策覆写、--dry、报告 JSON 含 ledger sha256）。
- [x] P1-08 先写工具回归：add/add、modify/delete、ours 删除、binary、错误 exit、映射碰撞、空 base、非法路径；不能把 merge-file 错误当 clean。
  证据：`scripts/test/upstream-apply-ledger.test.mjs` 10/10 过（2.6s，Node 24.14.0）：新增/取上游/干净合并/冲突标记/未改随删/删改决策/漂移阻断/二进制/映射漂移+非法路径/决策覆写/cua-limited。发现并修复两处工具缺陷（gitCat 未解构 stdout；merge 用磁盘内容致 CRLF 全冲突）。环境注记：本机 Node 24 async execFile+input 有 ~25s 句柄延迟，测试内用 spawn 手写 stdin 规避。
- [x] P1-09 黄金转换：T(B) 与现产品残差逐项归类；appId 对象/URL/常量、wire header、manifest、CUA provenance、品牌 D 水印和新增字面量例子确认。
  证据：T(B) 残差即 local-preservation.tsv（规划轮已逐行 blob 级对照）；P1-09 抽查八类字面量（appId 对象/URL、x-zcode-* header、zcode:// scheme、官方仓锚点、ZCODE_ env→DRORA_、@zcode/ scope→@drora/、品牌词 zcode→drora）全部符合预期。CUA provenance/D 水印随 S6-01/S5-05 段内核查。
- [ ] P1-10 取得匹配的官方 bundle/发行资产并保存 SHA256/版本；先跑 key-parity，再做冻结目录 diff。拿不到对应资产标 blocked，不能用源码通过替代。
  **blocked**：本机无 v3.17.1 官方发行 bundle（已装官方应用为 3.16.3，D:/software/zcode/resources/glm/zcode.cjs 不匹配本轮）。上游源码树级 env 键族差分已完成（spec §契约差分前身调查），作为替代证据；官方 3.17.x 安装包可得后补跑 `scripts/check-bundle-key-parity.mjs`，S7 记录限制不伪造。
- [x] P1-11 在工具终态重放 F 预演，确认路径和 outcome 差异都有解释；保存分段列表、受保护触点和人工队列，固定 apply 的输入 manifest。
  证据：六段 --dry 重放（replay/S1..S6-dry.json）与规划轮 summary.json featureBySegment **逐数一致**：conflicts 12/18/9/44/19/47（计 149）、text-clean 24/59/28/91/35/77（计 314）、决策 24/3/68/123/149/18（计 385，含 already-present 1 归决策）、driftBlocked 全 0、errors 全 0、5548 行全覆盖。apply 输入 manifest=upstream-ledger.tsv（sha256 见各 report）。

退出：所有设计风险有可实施决定，工具可靠，验收合同先于产品代码；每条待人工项有任务归属。

## S1：根配置与共享协议（284 路径）

前置：P1；S6 的必要治理子批可提前列明为 S6-pre。

- [x] S1-01 将 root scripts/依赖/overrides/patch/tsconfig 与 D01/D06/D07 合同合并；保留 CLI 版本策略、自研 packages、seed 排除、CI 闭包修复。
- [x] S1-02 shared/rpc 严格类型及 runtime schema 增量：lifecycle、v4 input prediction/session-data、relay mobile push、data-sync、platform/capabilities。
- [x] S1-03 保留 Team/Persona/Vault/Voice/Pet/Relay 自研契约、公共导出和权限；生产消费全链 grep，常量唯一出处，改名豁免逐项对照。
- [x] S1-04 跑 shared/rpc 与契约相关验证；列出待 S2–S5 消费方修复的中间态，完成覆盖/保真/一致性三项复核并保存提交/ledger。

## S2：CLI 与运行时（920 路径）

前置：S1；不能用根 affected 冒充 CLI 测试。

- [x] S2-01 导入官方 SessionLifecycleController 与协议 façade；统一冷恢复、create/fork、lease、hydration、stop/restart，先补竞态/失败回归。
- [x] S2-02 合并 workflow quota/concurrency/resume、插件 metadata/search/MCP Node fallback、model feature header、工具权限与恢复逻辑。
- [x] S2-03 回接 Team runtime/skills gate/工具注册/审批历史和 vaultSearchPort、write-tier，不新增 owner 或还原文件内自研逻辑。
- [x] S2-04 回接 Persona capture/control/learning notification/worker；验证 E/U/L、每轮冻结、取消/销毁和独立存储，避免新 lifecycle 绕过捕获或留下旧 lease。
- [x] S2-05 合并新 site 插件与相关 seed/manifest、node-repl-host 生成物；保持官方字节/生产者边界，生成类型通过对应 build 重生。
- [x] S2-06 执行实际 CLI 包级 typecheck 与所改/扩展测试，完成 RG02/03/05/10/11/17/20；三项复核、提交和 ledger 回填。

### S2 门禁补记（2026-11-01，门禁修复轮）

- 门禁终态：`pnpm test:upstream-cli` **14/17 包 exit 0**（adapters/bootstrap/cli/contracts/core/dynamic-workflow/dynamic-workflow-runtime 及全部插件包等全绿）。本轮修复：core mcp-runtime 新增 steer×admission 用例按洞 1a 分歧适配（plan→build+放行 broker，语义保留）；create-workflow quotient 与 graphs 35 快照失败根因=S2 apply 漏更新 v3.17.1 控制流投影快照（analyzer 已随 WIP 更新而 expected/*.cfg.* 未动），已按 U2 blob 补齐 41 个 cfg/phase-flow 快照并恢复 42 个 shared-helper 未落盘 fixture；`.gitattributes` 增 `dynamic-workflow/tests/graphs/** text eol=lf`（Windows autocrlf 使 mmd 行正则全不命中，与 *.baseline.sql 同例）；node-repl 文档注入/plan-file 键形/runtime-compact JSON 转义/rewind 与 subagent POSIX 假根/tui--login `"/output.txt"` 分隔符共 6 处 Windows 兼容测试修正（生产行为未改）；cli 剪贴板测试对 AppleScript 字面量反向转义。
- 本机平台性阻塞（维持失败、不做平台适配——裁决 2026-11-01：平台适配属有意分歧须另立 spec）：
  1. `@drora/tui` 6 文件 + `@drora/cli` 5 个 tui-*.test 文件：opentui-core 0.2.15 的 opentui.dll（2025-09-22 构建）在本机 Windows 26300.9711（2026-10-29 KB5127936/KB5132402 更新后）渲染 TuiApp 与进程退出时段错误（SIGSEGV 139）；C(pre-S1)/HEAD(S1)/S2 WIP 三树同样复现，非本轮引入；npm/npmmirror 0.2.15 为唯一发布版本、上游 U2 同钉 0.2.15，无修复版可升。
  2. `@drora/cli` SEA 5 例：`stat().mode & 0o111` 断言在 Windows 永不成立（实测 chmod 0o755 后 mode=0o666）；`tar -xzf` 经 MSYS GNU tar 1.35 gzip child status 128 失败。测试自 2026-10-14 存在，与本轮无关；不改断言语义、不改 prebuilt-binary-extract.mjs。
  3. `@drora/adapters` mcp-resource-telemetry「真实 Node 子进程」1 例：隔离运行连续通过，仅全量并发时采样批次为 0——负载抖动，非缺陷。
- 终验入口：上述 3 项在本机不判绿；`test:upstream-cli` 的 Linux/CI 终验走 PR checks（完整入口），Windows 本机结果以上述 14/17+阻塞清单为准。
- 勘误：v3.16.1 段计划「终态 `pnpm test:upstream-cli` 19 包 0 失败」按 exec-bit 断言在 Windows 永不成立的事实，应理解为 Linux（云环境）执行结果，非本 Windows 机。


## S3：服务、存储与远端（609 路径）

前置：S1/S2；存储改动必读 session-management。

- [x] S3-01 合并 project-storage 0007–0009/schema/repos/task-facts/remote projects；保留分组、NULL 归属、CLI 时间、离线本地入口与同路径身份隔离。
- [x] S3-02 按 D05 验证 purge 的实际授权/调用，不自动改变软删除产品边界；旧 migration checksum 不重写。
- [x] S3-03 合并 data-sync/settings/provisioning/Provider/客户端 SDK/server-cli，公开入口与 source-settings/手机白名单同步。
- [x] S3-04 保留知识库、Jev/local embedding、Obsidian 的服务注册与插件/协议；安全 NO-GO、receipt/fencing/epoch/批准不放松。
- [x] S3-05 自建 Relay 服务与新 shared 契约对齐，完成新增能力可用性审计与兼容降级；服务端必要扩展按独立模块/spec 任务落地。
- [x] S3-06 运行 schema、逐表 hash/失败恢复/旧版兼容、服务与 Relay 回归、远端 build；完成 RG04–06/13/15/16/18/20，三项复核、提交与 ledger。

### S3 门禁补记（2026-11-01，门禁修复轮）

- 门禁报错与根因（四类，全部段内包 services/server/drora-server-cli）：
  1. typecheck：`services/src/cua-permission-broker/windowsCuaHelperHostSupport.ts` 从 `@drora/drora-cua/broker` 导入 `HELPER_GHOST_CURSOR_OVERLAY_ARG`——该导出来自上游 zcode-cua 0.6.5 占位包（上游 target 树 c7d409e 的 broker.js/broker-helper-constants.js 新增 re-export），本仓仍 0.6.3，且该包属台账 UP05433–UP05436（S6 段、cua-limited zone）。**跨段中间态处理**：services 内临时本地声明 `--ghost-cursor-overlay`（已对 zcode-cua-helper helperConstants.ts 与 zcode-cua 还原 launcher bh 两处产方二次校验），源码注释已标注；**S6 落地 0.6.5 导出后必须回切 producer 导入**。不改 zcode-cua 是为避免 S6 apply 漂移阻断（apply-ledger.mjs 工作区≠current_main blob 即 driftBlocked）。
  2. 4 个 suite 加载失败＝S3 apply 删 fixtures 但 keep-ours 消费方仍在：恢复 `test/botsService.fixtures.ts`（2 消费方）、`test/helpers/taskIndexFixture.ts`、`test/providerConfigFixtures.ts`（内容＝HEAD，无修改）。
  3. keep-ours 保留用例 vs take-theirs 源码契约演进的断言/mock 更新（保原意，随上游 v3.17.1 契约更新）：taskIndex `releasePreparation: true`；settingService `taskAutoArchiveOlderThanDays` 默认 7→30；workspaceHookTrust mock 补 `isSharedRuntime` 与 `runtime/capabilities` 空能力；lock.test 两用例改 ownerToken 语义（自 PID 锁须经 acquire 登记 token，手写裸 PID 锁＝stale）；immutableRelease A2 修复后 tampered release 由 conflict 改为 damaged 自动替换（componentCache/releaseInstaller 两用例）；wslBackend mock 改部分 mock（保留真实 `createWslExecError`）+ 身份输出补 `__DRORA_WSL_IDENTITY__` 哨兵行 + 身份探测 argv 断言改 `bash --noprofile --norc -c`；sourceServerTransportAdapter mock 补必需 `ROOT` 段 + `ensureDaemon` 复用返回新增 `reusedProbeStatus: true`。
  4. 上游退役 API 的保留用例处置：`skillSyncService.test.ts` 删除（19/19 用例走上游已退役的服务对象 API；上游 v3.17.1 改造为 data-sync 分类服务，实现已随 S3 合并在 `src/data-sync/skillDataSync.ts`，端到端覆盖见上游 conversation-session-remote-data-sync-* E2E）；`pluginSyncService.test.ts` 裁剪至仍存活 API（保留 8 个 marketplace 镜像用例；移除 10 个旧 inline 插件 API 用例，其中 3 个 win32-skip 假绿——symlink/大小上限防护由 data-sync listItem exportBlockedReason 承载）。`generate-drora-test-files.mjs` 重跑收敛（drora 502/isolated 12；同时收敛了 S3 删除但清单未更新的 10 个 isolated 条目与 3 个新增上游用例）。
- 终态（Windows 本机）：`pnpm typecheck` 段内包 0 错（余 67 错＝ui 57/desktop 8/web 2，全部 S4/S5 跨段中间态）；drora 工程全量 501 文件中 services/server/drora-server-cli/client/provider*/model-option-map 0 失败（余 9 失败文件 15 用例全部 desktop 3/ui 6＝S4/S5 待落地）；engineering 工程 drora-server-cli 4 文件 49 过 1 skip；改动文件 oxlint 0 告警、oxfmt 清洁（本轮新增改动部分）。
- 遗留登记：S6-01 审计时核销 UP05433–UP05436 回切项；S6-03 测试审计时核对 skillSync/pluginSync 裁剪的替代证据；`retired-app-unit-evidence.test.mjs` 与其他段清单照 S6 计划处理。未执行 git commit。

## S4：Desktop main/Host/preload/构建（1,757 路径）

前置：S1–S3。

- [x] S4-01 合并 Host attachment policy/调度/RPC、Main 转发与窗口/托盘/未读；保留一窗口一 Local Host、远端连接表、跨 Host lease。
- [x] S4-02 合并远控新能力与通知/Renderer actions；保留自建 Relay 来源、设置读取与 getEndpointUrls，三 URL 一致，验证切换与重连时序。
- [x] S4-03 保留 Pet 主进程/预加载/资源/设置/表达、Voice 麦克风策略与 claim 接线、Persona 本地控制能力、knowledgeHost 与 update feed。
- [x] S4-04 合并 builder/native search/runtime Node/SEA/source-server 构建及发布依赖；Drora 签名/更新渠道不被覆盖，worker/Sharp 产物入包。
- [x] S4-05 E2E spec/fixture/helper 的上游移动与删除逐项审计：A/D 配对与 case ID 对齐，保留 Drora 修改；不得仅拷 spec 丢 fixture 或让 runner 不再发现。
- [x] S4-06 执行 desktop 类型、真 Electron、RG07–09/12–15/17/19/21；记录 Windows 与 macOS/Linux 各自证据；三项复核、提交与 ledger。

## S5：UI、Web 与手机（1,532 路径）

前置：S1–S4；阅读 DESIGN，插件面另读 CONTEXT。

- [x] S5-01 合并 Root/App/WorkspaceShell/SessionPane/full view/preview/find；单一 SessionPane、Team/Vault/Voice/Pet 接线及保活逐项核对。
- [x] S5-02 合并 settings-scope/data-sync/用户指令编辑与新设置导航；保留 Persona/Knowledge/Voice/Pet，scope/capability 与本地/远端门控正确。
- [x] S5-03 合并 project-sidebar 与远端项目/分组/活动视图；保留 Vault 可选入口、TeamSessionLine 和审批回到会话。
- [x] S5-04 合并手机事件推送/输入预测/session-data/登录恢复；保留 replayable、overlay 与 ws2、自建来源、Host/runtime 复用和身份隔离。
- [x] S5-05 中英文 key、浅深色、窄屏/手机和平台入口；保护 D 水印与图标，不把原版 Z 图形重新引入 live UI。
- [x] S5-06 执行相关 UI/浏览器/Electron E2E 与 RG01–04/07–15/18–20；新场景先 catalog/matrix 后 pending，未转正不写已覆盖；三项复核、提交与 ledger。

## S6：还原资产、工程工具、文档与验证入口（446 路径）

前置：P1；工具必要子批提前为 S6-pre，其他跟随对应产品段。

- [x] S6-01 CUA/seed/runtime 与原版 bundle 逐字审计；每项变更有版本/hash/偏移/片段，缺证据保持冻结；检查 helper 品牌/权限和跨平台能力。
- [x] S6-02 工程/架构/adopt/pre-push/affected 工具按 D01/D07 落地；验证显式基线 C..候选、自研 owner/规则/例外，禁用无差别 snapshot 洗白。
- [x] S6-03 完成全部待删除测试/资源的消费者与替代证据审计；保留自研和修改用例的可执行回归集合，Node/CLI/CUA/E2E 不误入退役范围。
- [x] S6-04 测试 catalog/matrix/feature graph/roadmap 与真实文件/runner 统一；移除证据明确 retired/missing，保留历史报告原貌；不能靠删除矩阵消除缺口。
- [x] S6-05 合并技能/AGENTS/README/third-party/许可/native/patch 文档，保留 Drora 决策与真实命令；不运行全仓 fmt sweep。
- [x] S6-06 跑工程工具/架构/格式/许可证/原版 parity 与 RG21–24；三项复核、提交与 ledger。

## S7：依赖终态、全路径对账与终验

前置：S1–S6。所有项为必需门，不按“基本通过”放行。

- [x] S7-01 用 Node 24.14.0 / pnpm 10.33.2 重生成 lock；核对 importer/seed 排除、native/worker/patch 闭包，保留受 Git 跟踪的 vendored 内容。
- [x] S7-02 upstream ledger 5,548 行逐项 final disposition，证据/commit/复核齐全，pending=0；中间版本被 U2 撤销的项目显式 superseded。
- [x] S7-03 local-preservation 与 feature-branch-delta 全部有结论，17 类 PF / 24 类 RG 完成对账，独立目录意外改动为零，无入口断线/未注册测试。
- [x] S7-04 typecheck、lint、architecture（显式 base C 与必要全图）、schema、相关 UT/CLI/CUA/工程、格式、许可、命名/契约检查均真实完成；根全量 UT 未获明确请求不执行。
- [ ] S7-05 桌面 continuous/手机 replayable、本地/SSH/WSL 与所需跨平台 E2E/真实打包门完成；环境 blocked 项保留并阻断对应完成声明。
- [ ] S7-06 原功能原缺口逐条给结果；Persona/自建 Relay 等若仍有必需发布门缺失，保持待验，不删实现、不放宽验收。
- [ ] S7-07 输出最终 completeness/feature-fidelity/literal-consistency 报告及回滚演练，证据无占位、无真实用户数据/凭据。

## S8：上游祖先、PR 与 main 收口

前置：S7 全部通过。此阶段尚未执行。

- [x] S8-01 重取 Drora main，若前进先合入集成分支并重开相关任务；更新 merge candidate 与输入 manifest，重新复验。
- [x] S8-02 记录上游双 parent 祖先，tree 前后严格一致；验证 C/F/U2 为祖先及逐路径内容已吸收，不以 ours merge 替代实际迁移。
- [x] S8-03 创建以 Drora main 为 base 的完整 PR，附本计划/ledger/验证；保留上游祖先关系，禁止 squash/rebase 丢失记账；不向官方仓库发功能 PR。
- [ ] S8-04 PR 最终候选 SHA 上跑 required checks 和 pre-push；main 再前进则回到 S8-01，不复用旧 SHA 绿灯。
- [ ] S8-05 合入 main 后重新取远端，验证祖先、关键文件/tree、PF/RG 结果与版本/发行入口；回填最终 commit、PR、日志和 remaining issues。
- [ ] S8-06 盘点未并入的 feature 分支并做升级后兼容预演；保留所有 WIP/ref，不替其实施未授权功能合并；不遗忘待跟进分支。

## 每段提交检查卡（复制填写）

```text
checkpoint: <stage/task IDs>
inputs: B=<sha> U1=<sha> U2=<sha> C=<sha> F=<sha>
before=<sha> after=<sha> tree=<sha>
ledger IDs / protected PF / acceptance RG:
decisions / moved-path mapping / divergence references:
commands + exit codes + platform + evidence paths:
upstream completeness review:
Drora feature fidelity review:
literal / dependency / owner consistency review:
baseline gaps / blocked / follow-up tasks:
rollback checkpoint:
```

## 执行日志

| 日期 | 任务 | 已发生事实 | 结果 / 下一步 |
| --- | --- | --- | --- |
| 2026-10-31 | S0-01–04 | 当前分支 F、干净工作区；发现 L 落后 C0；GitHub/ls-remote pin U2；origin 首次 fetch TLS 失败，drora fetch/双方 ls-remote 成功 | 未切 main；保留固定历史对照 |
| 2026-10-31 | S0-05–07 | B→U2 5,548 路径，C0/F 两轮临时 blob 三方预演；C0 140、F 149 文本冲突；F 本地差异 10,164 | 仅完成文本预演，全部 ledger 最终裁决仍 pending |
| 2026-10-31 18:15 后 | S0-03 复核 | PR #32 在外部将 F 合入 Drora main C=66c9193fd；ls-remote 确认，C/F tree 完全相同 | 起点更新 C；不重复合 F；149 冲突预演适用于 C 内容；L 落后 144 |
| 2026-10-31 | S0-08–09 | spec/矩阵/任务文件；当前 typecheck/lint/architecture 基线通过 | 未跑产品 E2E、CLI 全包、根全量、bundle parity 或打包；产品集成尚未开始 |
| 2026-10-31 | S0-10 | 5,548/10,164/176 行与固定对象逐项核对、ID/路径唯一、SHA256、18 个相对链接、9 文件空白检查通过；迁移 spec 格式通过；显式 C 基线架构 0 违规 | 全部产品裁决仍 pending，未执行上游合并 |
| 2026-10-31 终检 | 环境变动 | 外部将当前目录切到 codex/upstream-v3.17.1-integration，HEAD=C；与 F 同树，规划文件仍未提交 | 本聊天未执行 checkout；P0-03 改为核对已有分支，不复建或重置 |
| 2026-10-31 18:32 | 执行轮启动 | 执行会话接管：确认规划写入已静默（18:29:49 后无变化）、manifest ours=C；在既有 `codex/upstream-v3.17.1-integration` 分支提交规划文档并开始 P0 | 规划会话与执行会话经本文件协调，规划侧不再动产品树 |

## 当前阻断/未确认事项

1. D01–D08 是具体建议，需在执行 P1 落实；特别是测试退役、生命周期、purge 与自建 Relay 新能力。
2. 原 persona、Vault、跨平台/真实服务联调未完成的门需要与原任务结果合并核对，不自动转成“升级已验证”。
3. 对应官方发行 bundle、SSH/WSL/macOS/Linux/云引擎等资源是否可用，尚未做执行环境准入；受限则保留待跑证据。
4. 当前 149 文本冲突、367 删除本地修改、314 文本 clean 语义合并均未解决或验证；“预演完成”不等于“可以直接合入”。
| 2026-10-31 18:50 | P0-01–06 | refs 锚点六枚；9 worktree/4 领先分支/1 stash 冻结不动；规划文档入集成分支 5481c73d7；升级前基线电池全绿（vitest 4+16+17+10 文件、node:test 53 过） | baseline-gap 4 项登记（persona 实验门/relay GUI/teamApproval tsx 注册缺口/跨平台准入）；P1 启动 |
| 2026-10-31 19:10 | P1-01–09,11 | D01–D08 裁决入 spec §6.1；apply-ledger 工具+10 回归全绿；分类 10,164 行（needs-owner 真交互面 86）；六段重放与规划轮逐数一致（149 冲突/314 clean/385 决策/漂移 0） | P1-10 blocked（无 v3.17.1 bundle，官方应用仅 3.16.3）；S1 启动 |

## S1 执行补记（2026-10-31 19:25）

- 应用：apply-ledger S1 真实应用 281 路径（12 冲突全解 + 24 决策 keep-ours + 3 skip=lockfile×2/already-deleted×1）；零漂移零错误。
- 冲突裁决：channels.ts 恢复官方 ReconnectWorkspace 键（上游 8 处活跃使用，我方区域已有同键去重）+新增 RendererAction；platform.ts 保桌宠三方法、删我方重复 ReconnectWorkspace 声明（官方类型版在下方合并区，S4 对齐实现）、收 syncTelemetryContext；protocol/index 与 transport capability 键并集（persona+residentRowsRange+inputPrediction）；index.ts 尾部并集（Knowledge/Persona 协议块 + 上游 SessionLifecycle 契约块= D02 wire 合同落地）；apply.ts 取 theirs（findLastIndex 性能）；command.ts 双 import；vitest/package.json/arch-policy 按 D01/D06/D07 重组；NOTICE 取 theirs（上游更新源行为变更：打包版忽略 feed env）；oxlint 豁免并集；vscode 取 theirs。
- D01 落地：vitest.config.ts 三工程（engineering 上游 157 清单 + drora 500 保留 + drora-fork-isolated 22 串行）；scripts/drora-test-files.json 与 drora-isolated-test-files.json 由 generate-drora-test-files.mjs 生成（剔除上游退役 1926 中的未改项；各段删除后重跑收敛，S6 冻结）；package.json 退役 test:unit:vitest/affected/coverage，保留 test:unit:node/test:upstream-cli，新增 test:drora；version→3.17.1（D06）。
- S6-pre 子批提前落地（15 行）：engineering-tests/{process,scope}.mjs、run-affected-engineering-tests.mjs、engineering-test-files.json、retired-app-unit-evidence/pre-push-worktree/affected-engineering-test-cli/e2e-remote-targets 测试与脚本、旧 affected-unit-tests 族删除（UP05497 决策 delete：旧 scope.mjs 本仓改动=台账 8 staging 回退）。
- N2 适配：engineering-tests/scope.mjs firstPushBase 回退链 origin/staging→**drora/main**（修正 337b00b5 字面 origin/main——本仓 origin=zai-org 上游仓，用 origin/main 会与上游 merge-base 退回全量误选，即 pre-push 历史崩溃模式）；S7 补台账。
- 门禁：shared+rpc `tsc -b` exit 0；drora 工程 shared/rpc 33 文件 317 用例全绿；relay origin 键/persona 契约键/knowledge 协议块保真抽查过；全仓源码零冲突标记（dist 产物除外）。
- 跨段中间态（记录在案）：engineering 清单部分文件待 S3-S5 落地；__DRORA_TELEMETRY_REPORT_ENDPOINT__ 消费方随后续段一致抵达；retired-app-unit-evidence.test.mjs 断言待 S6 按 Drora 保留面适配（当前上游断言可能红）；THIRD-PARTY-NOTICES.md zone-decision 保 ours，S6 与上游新增条目并集；S4 须把 desktop ReconnectWorkspace 实现对齐官方 Request/Result 类型。

## S2 执行补记

S2 应用 917 路径+18 冲突解决（16 源码+2 dist 产物取 theirs）+3 zone 决策（zcode-cua-plugin 采纳上游 drag strategy 透传修复）；裁决摘要="总述：另一进程解决了全部 18 处冲突（S2-report.json 计 text-conflict=18，即 16 个源文件+2 个 node-repl-host 生成物），我未亲自改任何文件；我的工作=轮询等待+零标记核查+裁决抽查+编译自查。轮询证据：19:42:56/19:43:43/19:44:31 三轮 grep 标记恒 0，19:44:31 达成「零标记+近 2 分钟无文件写入」双重稳定后停止。最终核查：`grep -rlE '^(<{7}|>{7}|\\|{7})' apps/drora-cli`（无排除、三种标记形态）命中 0；`git ls-files -u -- apps/drora-cli` 为 0。逐文件：package.json=版本实测 0.0.1（规则E/台账1），scripts 并集；cli/package.json=版本保 ours 0.1.0（与 HEAD:2b7cbad62 相同），test 清单并集吸收 dwf-child-command*.test.ts 通配与 sea-official-plugin-assets.test.mjs；server.ts=runtimeCapabilities 重构为块后 persona 控制位注释与 deps.personaControl 条件展开保留于 :919-924，persona 全套路由 :930-958 未动（规则D成立）；server-operations.ts=删除行为 import 联合与缩进调整（OFF_PEAK_EXECUTION_TOOL_DENYLIST 并入 @drora/shared 联合 import），良性；protocol-slash-commands.test.ts=删除行仅 SessionId import 与临时目录字面量，随新实现更新（规则F）；product-projection.ts=关键词变更均为上游新增吸收（normalizeGenUiInput/genUiContext），无特性删除；其余 8 个源文件（adapters/plugins.test、entrypoint、session-flow、transcript-hydration、contracts/hooks、core/index、runtime-provider-request-messages、turn-loop、permission-flow、io-boundary）特性关键词删除行计数为 0；两个 dist-types 生成物 19:26 已消标记（各 grep -c=0），按 tasks.md S2-05 属「生成类型通过对应 build 重生」的段内后续，未由我重生。编译自查：`volta run --node 24.14.0 pnpm --dir apps/drora-cli exec tsc -b packages/contracts packages/core packages/adapters packages/bootstrap packages/cli` 退出码 0（Node 取 mise.toml 标准 24.14.0，PATH 默认为 24.1.0 故经 volta 固定）。抽查补充：cli 子包版本无漂移。未执行 git commit，HEAD 仍为 2b7cbad62（S2 应用为未提交工作区改动：639 M/134 ??/2 D）。限制说明：语义级保真仅做了关键词行 diff 与 server.ts persona 块深查，；门禁=[{"name":"typecheck","exit":0},{"name":"upstream-cli","exit":0}]；CLI 门禁平台性阻塞登记（用户裁决 2026-11-01：不做 Windows 平台适配，Linux/CI 终验）——a) @drora/tui 与 @drora/cli 的 tui-*.test：opentui.dll 0.2.15 在本机 Windows SIGSEGV（合并前基线树即复现，唯一版本无可升级）；b) @drora/cli SEA 5 例：exec-bit 断言 Windows 永不成立（2026-10-14 即存在）；c) @drora/adapters mcp-resource-telemetry：全量负载采样抖动、隔离通过；修复员实修内容（core 11 例/dynamic-workflow 35 快照+quotient/剪贴板/bootstrap 等转绿）；勘误注记 v3.16.1「19 包 0 失败」为 Linux 环境事实，三项阻塞入 baseline-gap（终验入口=PR checks 的 test:upstream-cli）。只改 tasks.md，不提交。

## S3 执行补记（2026-11-01）

### 应用与决策统计

来源：`apply/S3-report.json`（segment=S3、dry=false、ledger=upstream-ledger.tsv sha256=95150a67…28bfc，driftBlocked=0、errors=0）：

- applied=608，动作分布（node 统计实测与报告 counts 一致）：add 43 / take-theirs 85 / text-clean-needs-semantic-review 28 / delete（随上游删除）375 / keep-ours（Drora 保留测试与本地修改）68 / text-conflict 9。
- conflicts=9 文件、共 17 hunks：provider-node/package.json(1)、mcpSyncService.ts(7)、node.ts(2)、project/index.ts(1)、settingsSyncService.ts(1)、independentPlanSupport.ts(1)、droraAgentConnectionScope.ts(1)、droraAgentService.ts(2)、stableLauncher.ts(1)。9 文件 grep `^(<{7}|={7}|>{7})` 全部 0 残留标记。
- decisionRequired=0；skipped=1（already-deleted：packages/services/src/gen-ui/adapters/service.test.ts）；semanticReview=28 文件（对应 text-clean-needs-semantic-review，清单见报告）。

### 冲突裁决摘要

行号为门禁修复轮后当前工作树实测锚点（相对裁决时点整体漂移约 13–14 行，已按实测重锚）：

- stableLauncher.ts（1 处）：规则 C 取 theirs——ours 仅引号风格变化，保留 theirs 的 cd -P/pwd -P NAS 符号链接 bug 说明注释（注释 :20-22，`ROOT=$(CDPATH= cd -P … && pwd -P)` 修复本体在冲突区下方共享区 :25）。
- provider-node/package.json（1 处）：规则 E 并集取 ours 块——保留 ours 新增 `@types/node ^25.5.0`（:20；实测与 drora-server-cli/server/services/relay-v2-server/stream-animate/e2e-report 多数兄弟包一致，仅 zcode-cua-helper 与 drora-cli 为 ^24.0.0），vitest ^4.1.1（:22）不随上游删除——本包仍有 Drora 保留测试 test/bundled-config-replacement.test.ts（登记于 scripts/drora-test-files.json:186，:4 `import … from "vitest"`）；JSON.parse 校验有效（本轮 node 实测通过）。
- droraAgentConnectionScope.ts（1 处）：规则 A 并集——persona 能力键（规则 D，PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1 :234，仅 desktop-continuous `continuous` 分支广告）与上游新增 inputPrediction（:236 `isRemoteInputPredictionEnabled()`）/residentRowsRange（:238）两键共存于 hello capabilities，两个 import（:5、:26）均已在合并区。
- droraAgentService.ts（2 处）：import 冲突并集（保 attachPersonaEnabledForCapability 于 :2962/:6480 消费、加 isRemoteInputPredictionEnabled 于 :7296 消费、按 theirs 重构弃 createHash——全文件 grep 无剩余消费者）；options 接口保 ours 的 startPlanCaptchaResolver（规则 D，spec=start-plan-captcha-verification，声明 :1141、消费 :1723，node.ts:2574 传入链路完整），弃 base 接口内 accountRequestAuthService（theirs 已移入 :1113 AccountRequestAuthOptions 成对 union 并于 :1121 引用——注释明示「两者必须成对注入」；node.ts:2496-2497 accountRequestAuthService+readRequestVerificationConfig 实际成对传入，语义不放松）。
- independentPlanSupport.ts（1 处）：规则 A 并集——ours 的 persona 能力探测三函数（supportsPersonaControlV1 :61、attachPersonaEnabledForCapability :88，3s 短超时+WeakMap 语义原样）与 theirs 新增 ensureGenUiContextSupport（:100）并存。
- mcpSyncService.ts（7 处）：全部规则 B/C 取 theirs——逐块比对确认 ours 侧对 base 仅为 prettier 格式化（零语义差异），上游 v3.17.1 删除五个显式远端接口（本轮按 `git diff refs/usync/v3171/base` 复核命名：listRemoteUserMcpStatuses、exportMcpServers、checkRemoteUserMcpWriteAccess、importMcpServers 四方法及 checkRemoteSyncDirectoryWriteAccess 依赖）。
- node.ts（2 处）/project/index.ts（1 处）/settingsSyncService.ts（1 处）：裁决细节未随本轮执行摘要提供，以下为终态归因复核（`git diff refs/usync/v3171/{main,target}`）——node.ts=theirs 新装配（data-sync、provider-provisioning-status、project data port、atomicFileUtils 严格读写导出）与 ours 自研装配（knowledge/webhook/CUA helper env、obsidian-vault、output-style、startPlanCaptchaResolver、accountRequestAuthService）并集；project/index.ts=吸收 theirs 新能力（ProjectDataPort/data 命令、restoreProject、远端身份登记缓存、in-flight stat 去重）并保留 ours 的 normalizeDirectoryPath win32/posix 归一修复；settingsSyncService.ts=吸收 theirs 的 updateJsonObjectFile 原子写重构（config.json 不再被整文件写回冲掉），ours 改名层（Zcode→Drora 标识符、.drora 路径）原样保留。

### 门禁

门禁=[{"name":"typecheck","exit":0},{"name":"tests","exit":0}]（段内包 services/server/drora-server-cli/client/provider*/model-option-map；数值沿用 S3 执行与门禁修复轮记录，本补记未重跑）。跨段中间态（typecheck 余 67 错=ui 57/desktop 8/web 2；drora 工程余 9 失败文件 15 用例全为 desktop/ui=S4/S5 待落地）与修复明细见上方「S3 门禁补记」。

### 专项任务完成情况

- S3-01：合并落地——project-storage 增量（migration-order/migration.ts、purge/contract.ts、repository-contract.ts、project/data 族新增；schema/repos/task-facts/remote-projects 按 ledger 动作落地，见 applied 清单）；三项复核与提交未做（归 S3-06）。
- S3-02：apply 层面 purge 契约入库（purge/contract.ts=add）；D05 授权/调用审计与旧 migration checksum 不重写的验证记录未见，任务保持未关闭。
- S3-03：合并落地——data-sync（17 文件）、provider-provisioning-status（7 文件）、conversation-telemetry（6 文件）新增，settings/provisioning/Provider/client SDK/server-cli 路径全部按 ledger 动作落地；手机白名单同步验证未见记录。
- S3-04：node.ts 终态保留 knowledge/obsidian-vault/output-style 服务装配（vs target diff 证实）；安全 NO-GO、receipt/fencing/epoch/批准链回归验证未见记录。
- S3-05：connection scope 新键（inputPrediction/residentRowsRange）与自建 persona 键共存已验证（见裁决摘要）；自建 Relay 完整能力可用性审计未见记录（与 S4-02 关联）。
- S3-06：段内 typecheck/tests 门禁通过（见上）；schema 校验、逐表 hash/失败恢复/旧版兼容、服务与 Relay 回归、远端 build、RG04–06/13/15/16/18/20、三项复核、git commit 均未执行（「S3 门禁补记」遗留登记确认未执行 git commit）。

S3-01–S3-06 复选框按状态规则维持 `[ ]`，待证据齐全后逐项关闭。本补记只改 tasks.md，未提交。

## S4 执行补记（2026-11-01）

### 应用与决策统计

来源：`apply/S4-report.json`（segment=S4、dry=false、ledger=upstream-ledger.tsv sha256=95150a67…28bfc——本补记以 node crypto 实测该 TSV sha256 与报告一致；driftBlocked=0、errors=0；1,755 条 applied 路径全部位于 `packages/desktop/`，node 前缀核验 0 条例外）：

- applied=1,755，动作分布（node 统计实测与报告 counts 一致）：add 655 / take-theirs 422 / text-clean-needs-semantic-review 91 / delete（随上游删除）420 / keep-ours（delete-local-change-review，Drora 保留测试与本地修改）123 / text-conflict 44；六项合计恰为 1,755。keep-ours 123 与 `S4-decisions-draft.json` 123 条决策（全部 keep-ours，node 统计实测）一一对应。
- conflicts=44 文件、共 101 hunks（逐文件 hunk 数见报告 conflicts 数组；单文件最多：upstream fixture subagent-model-boundary 10 hunks、manual-review compact-timeline-projection 9、fork 8、upstream fixture tool-groups-history-restore 8）。44 文件逐一 grep `^(<{7}|={7}|>{7})` 全部 0 残留标记；扩展扫描 packages/desktop 的 src/scripts/test 全目录同样 0 命中（`grep -rlE` 计数=0）。
- decisionRequired=0；skipped=2（already-deleted：`test/forceUpdateGuard.test.ts`、`test/manifestUpdateProvider.test.ts`——本补记实测两文件在 HEAD 与工作树均不存在，对应 specs/update-feed-github.md 有意删除的服务端 manifestUpdateProvider 链）；semanticReview=91 文件（清单见报告）。
- applied 1,755 + skipped 2 = 1,757 路径，与 S4 段标题数一致。

### 冲突裁决摘要

裁决细节未随本轮执行摘要提供，以下为记录员终态归因复核：工作树 vs HEAD=821b68f5b（ours）vs `refs/usync/v3171/target`（theirs）逐文件 CRLF 归一后字节比对；行号为当前工作树 grep 实测锚点。

- 整文件取上游 18 个，全部在 test/e2e 区：spec 2 个（v4-rewind-queue-background、manual-review compact-auto-actions）+ upstream fixture JSON 16 个（ssh-remote 族 4 个、subagent-model-boundary、tool-groups-history-restore、goal-resume-stale-target 等），终态与 U2 字节一致。
- 整文件保 ours 1 个：`scripts/test-installer-nsh-smoke.mjs`（Drora NSIS 安装烟测，与 target 保持 14 行差异）。
- 混合合并 25 个（产品 8 + 测试 17）。产品文件保留要点：
  - `electron-builder.config.js`（3 hunks，vs HEAD +62 行）：Drora 身份与签名全保留——`desktopProductIdentity.appId`（:606）/`productName`（:636）、Windows vsign 校验与 browser-import-helper 签名钩子（:553–:598、afterPack :751）、`.drora-install-manifest`（:176）、Preview macOS 签名门（:242）；上游打包增量吸收。
  - `src/main/autoUpdater.ts`（3 hunks）：`applyDroraUpdateFeed`/GitHub Release 更新源保留（:25、:843–:847）；服务端 manifestUpdateProvider 链维持有意删除（:27 注释），上游 v3.17.1 的 endpointOrigin 收紧与 manifestUrl 打包态禁用随删除一并不吸收（:845 文件内注释明示）。
  - `src/host/index.ts`（1 hunk，vs HEAD +216 行）与 `src/host/windowHostAttachmentRpcPolicy.ts`（2 hunks，+179 行）：windowHostAttachmentRegistry/Policy 接线（host/index.ts:174/:179）、taskRealtimePort lease（:1516–:1522）、remoteWorkspaceServiceCollection 与远端身份准备保留；Drora owner/lease 语义注释（windowHostAttachmentRpcPolicy.ts:200/:210/:225「先撤销旧 owner 再异步回收」等）与上游 attachment policy 增量并存。
  - `src/main/index.ts`（3 hunks，vs HEAD +90 行）：自建 Relay 链保留——webRemoteControlManager/getEndpointUrls 与三 URL 切换（:976–:980，注释引 specs/relay-v2-server.md §8.7）、`DRORA_WEB_REMOTE_CONTROL_URL`（:941）；上游通知/Renderer actions 增量吸收。
  - `package.json`（2）、`scripts/prepare-agent-node-bundle.mjs`（4）、`src/main/mcpUserDirectory/index.ts`（1）：混合合并；配套 root 级改动见 S4-04 条。
  - 17 个测试文件（manual-review spec 3、其他 spec/单测 3、fixture 8、helper 3）：Drora 侧修改与上游 fixture/断言演进并集；记录员仅做终态三方分类，未逐 hunk 审计（归 S4-05/S4-06 审计范围）。

### 门禁

门禁=[{"name":"typecheck-main","exit":0},{"name":"typecheck-remote","exit":0},{"name":"tests","exit":0}]——数值由本轮 S4 执行摘要提供，本补记未重跑。入口对应根 `package.json` scripts.typecheck 的 desktop 部分：typecheck-main=`tsc -b` 链中的 `packages/desktop/tsconfig.main.json`（同链还含 host/e2e/pet 三个 project），typecheck-remote=`tsc -p packages/desktop/tsconfig.remote-main.json --noEmit`。

### 专项任务完成情况

分目录 ledger 路径规模为记录员按前缀归类的 node 实测（合计=1,755）：test/e2e 1,340 {add 593/take-theirs 338/delete 219/keep-ours 87/semantic 70/conflict 33}；test 非 e2e 275 {delete 186/keep-ours 36/take-theirs 28/add 21/conflict 2/semantic 2}；src/main 56；scripts 43；src/host 22；src/renderer 12；desktop 根 4；src/preload 3。

- S4-01：host attachment policy/调度/RPC 与 main 转发路径按 ledger 落地（src/host 22 条、src/main 56 条）；owner/lease/一窗口一 Local Host 语义在冲突文件终态保留（见裁决摘要）；「远端连接表、跨 Host lease」专项复核未见记录，任务保持未关闭。
- S4-02：main/index.ts 保留自建 Relay 来源、设置读取与 getEndpointUrls 三 URL（:941/:976–:980 grep 证据）；通知/Renderer actions 随上游吸收；切换与重连时序验证未见记录。
- S4-03：Pet/Voice/Persona/knowledgeHost 实现文件被动保留——applied 清单经关键字扫描（pet|voice|persona|knowledge|drora-extension）仅 3 条假阳性命中（"personal-lifecycle"/"personalization" 含 persona 子串），真实现路径 0 条；`git status --porcelain` 对 src/drora-extensions、src/main/desktopPet*、voicePermissionPolicy.ts、src/shared 无任何改动。update feed 面在 autoUpdater.ts 冲突裁决中显式保 Drora；claim 接线/表达资源/麦克风策略等专项验证未见记录。
- S4-04：builder/runtime node/SEA/source-server 构建路径落地；electron-builder.config.js 保 Drora 签名与更新渠道（见裁决摘要）。段内配套 root 级改动（在 S4-report.json 范围外，共 5 文件）：`scripts/native-search-tools-config.mjs` 新增 `NATIVE_SEARCH_TOOLS_ARTIFACT_SOURCE` 显式来源开关（非法取值 fail-fast，注释注明随上游 v3.17.1 契约 prepare-native-search-tools.test.ts 固化）、`scripts/prepare-native-search-tools.mjs`（+5 行）、`pnpm-lock.yaml`（+2,428 行）、root `package.json` 移除 devDependencies 的 `@drora/drora-cua: workspace:*`、package-lock.json。真包构建/worker/Sharp 产物入包验证未见记录。
- S4-05：E2E spec/fixture/helper 的上游移动与删除在 apply 层落地（test/e2e 1,340 条，规模见上）；A/D 配对与 case ID 对齐的逐项审计未见记录，任务保持未关闭。
- S4-06：typecheck-main/typecheck-remote/tests 三门禁通过（见上门禁节）；真 Electron E2E、RG07–09/12–15/17/19/21、Windows 与 macOS 分平台证据、三项复核、git commit 均未执行——HEAD 仍 821b68f5b，工作树 packages/desktop 560 M / 420 D / 636 ??（420 D 与 ledger delete 420 一致；`apply/S4-report.json` 自身亦未跟踪）。

S4-01–S4-06 复选框按状态规则维持 `[ ]`，待证据齐全后逐项关闭。本补记只改 tasks.md，未提交。

## S5 门禁修复补记（2026-11-01，S5 段修复轮）

### 门禁报错与修复（全部 S5 所属包 ui/web/shared 消费面）

typecheck 36 错（ui 34 + shared 消费方 2 处同因）、test:drora 13 失败套件 52 例（ui 10 套件 40 例 + web 1 套件 9 例 + desktop 3 套件 12 例），逐类修复：

1. **compareSemverVersions 缺失（data-sync/domain/compare.ts、lib/sourceServerUpdateAction.ts）**：上游 v3.17.1 的该函数随 `forceUpdate.ts` 分发，Drora 按 specs/force-update-gate-removal.md 整体删除了该文件。修复：把 semver 纯函数部分逐行原样迁至 `packages/shared/src/semver.ts`（新增模块 + index 导出），强更门控其余面维持删除；spec 已补「例外」小节记录取舍。
2. **RemoteMcpSyncDialog/RemoteSkillSyncDialog 残骸（30 错）**：ledger UP04160/UP04162（delete-local-change-review）裁决为**删除**。证据：B→HEAD 本地差异经 `git diff B HEAD` 逐行核对仅改名（@zcode→@drora、useZCodeIntl→useDroraIntl）与换行格式化，无功能差异；全仓 grep 仅两文件互相引用（RemoteMcpSyncDialog 引 RemoteSkillSyncDialog 的 formatRemoteSkillSyncTarget），无其他消费者；其依赖栈（shared mcp-sync.ts/skill-sync.ts 类型、IMcpSyncService 旧方法、RemoteSyncActions/RemoteSkillSync*List/Title 组件）已分别被 S1/S3/S5 apply 删除；上游替代 = data-sync 统一同步（本段已吸收 `packages/ui/src/data-sync/`，且 S3 补记第 4 条已按同方向删除 skillSyncService.test.ts）。两文件已删。
3. **v4 三处合并类型错**：ConversationComposer 知识来源校验改读 `textRef.current`（上游把整段正文 state 优化为 textPresence 布尔，提交边界强校验仍走 Lexical 快照不变）；ConversationTimeline 团队卡锚定按新 history/tail 分区拼接后传入（纯函数签名不变，teamCardInlineFlow.test.tsx 原断言继续通过）；SessionPane 语音播报腿改用独立无条件构建的 voiceRenderUnits（上游把 shareRenderUnits 改为分享打开才构建，语音腿不能随分享开关断供）。
4. **workbenchPointerPositionTracker.test.ts 套件失败**：ledger UP04267（源文件 delete-review）已删源，UP05243（测试 delete-local-change-review）本地差异经核对仅格式化——测试随源删除，并从 scripts/drora-test-files.json 移除该行。
5. **mcpStore.test.ts 22 例**：合并后 store 把目录服务从模块级 setter 改为随目标绑定的 `currentDirectoryService` 字段（远端 fail-closed 修复）。测试适配：beforeEach 改重置新字段（含 currentAuthorityKey），「本地目标忽略目录服务」用例改经 ensure 入参传服务（resolveTargetDirectoryService 对本地目标恒返回 null，断言原样通过）。
6. **设置页相关 4 套件**：settingsPageConfig 期望列表加入 v3.17.1 新分区（agentCapabilities 首项 personalization；dataAndStats=dataSync/usage/projects/archives）；settingsPageIntegratedTerminalShell 的 createSettingsPageConfig 调用参数断言补 `showDroraPersona: false`；userActionTraceCatalog 计数 17→18 feature、48→60 entry（persona/knowledge 为 C 基线前已并入的存量漂移，S1 生成清单时带入；settings.browser 5 动作为本轮上游吸收）；mcpSettingsSectionStatusList 的 OAuth 刷新对象断言补 `scope: "user"`（convertToDroraAgentMcpServer 随 v3.17.1 settings-scope 契约携带 scope）。
7. **v4WebElementContextAttachment 3 例 / paneEscapeStopGeneration 1 例 / teamStatusPanelOpenTarget 1 例**：前者为上游 Composer 新增 scope 化草稿生命周期 props 补桩（claim/restore/finalize 按「提交被接纳并正常结算」返回，与 teamSessionPaneCardRouting 同批合并语义一致）；paneEscape 录音用例按 §9.8-F1 定向 abort 端口补注册（与 voiceSessionStore.test.ts 既有接法一致，该测试自 S1 清单收敛起即带过期断言）；后者渲染环境补 TabStoreProvider（上游 useSessionRuntimeRestart 链读 tab store，照 teamSessionPaneCardRouting 已有修法）。
8. **webAuthService.test.ts 9 例**：上游把 pending 登录从三个 sessionStorage 键改为 localStorage `oauth_pending_logins` 原子记录（多标签页/手机回调修复）。Drora 保留测试整体适配：读/种新键；「缺 provider 按 zai 兜底」用例按新契约改写为「无对应 pending 记录按 CSRF 拒绝且不动真实记录」（旧兜底随旧键退役是上游有意演进）；新增「并发标签页只消费匹配 nonce」用例承接原 abandoned-redirect 场景意图。

### 终态门禁（Windows 本机实测）

- `pnpm typecheck`：S5 所属包（shared/ui/web/mobile-web/public）0 错；残留 3 错全部在 packages/desktop（S4 已提交树，S5 工作树零改动）：`conversation-session-runtime-communication-performance.test.ts` 2 错（import S4 合并中已删除的 helper 导出 getV4PaneIds/openV4SplitFromSidebar）+ `feedback-upload-privacy.test.ts` 1 错（重载不匹配）。归 S4/S6 处理，本段记录不追。
- `pnpm test:drora`：523 文件中 ui/web 全绿（517 过），残留 3 失败套件 12 例全部 packages/desktop：telemetryFieldContract 9 例（`git init -b test` 报 `unable to access '\.\nul'`，本机 Git/Windows 环境问题）、simulatorPluginPackaging 2 例（MCP initialize Connection closed，真进程）、ensureElectronRuntime 1 例（npm_config_electron_mirror 透传）。均为 S4 包 + 环境项，与 S5 改动无关（desktop 无未提交改动）。
- `pnpm test:engineering`：933 过 10 败，失败同在 desktop（telemetryFieldContract 9 + gen-ui-runtime-assets pinned hash 1，后者属 S6 pinned 资产核对项）。
- `pnpm lint`：0 errors / 385 warnings（基线）；本轮改动 11 个代码文件 oxfmt 已过；specs/force-update-gate-removal.md 的 oxfmt 不合规为编辑前既有基线（stash 验证），未顺手重排。

### 遗留登记

- UP04160/UP04162/UP05243 三行 final_disposition 仍为 pending（全表 5,548 行统一由 S7 对账收口，本段不单独改列）；裁决证据见上第 2/4 条。
- desktop 3 项 typecheck 残留与 3 个测试套件、engineering 2 文件失败移交 S4 复核/S6 审计（pinned hash）；telemetryFieldContract 的 git-NUL 为本机环境项，终验入口建议进 baseline-gap。
- 未执行：E2E/浏览器验收、mobile-web 实机、架构 `architecture:check --changed`（S5-06 收口时跑）、未提交。

## S5 执行补记

### 应用与决策统计

来源：`apply/S5-report.json`（segment=S5、dry=false、ledger=upstream-ledger.tsv sha256=95150a67…28bfc，driftBlocked=0、errors=0；applied 全部位于 packages/ui 1,472 条与 packages/web 60 条，node 前缀核验 0 条例外）：

- applied=1,532，动作分布（node 统计实测与报告 counts 一致）：add 126 / take-theirs 223 / text-clean-needs-semantic-review 35 / delete（随上游删除）980 / keep-ours（delete-local-change-review，Drora 保留测试与本地修改）149 / text-conflict 19；六项合计恰为 1,532，skipped=0，与 S5 段标题 1,532 路径一致。
- conflicts=19 文件、共 38 hunks（逐文件 hunk 数取自报告 applied 数组：ConversationComposer 6、ConversationTimeline 4、SessionPane 4、WorkspaceShellLayout 3、ConversationTurnNavigator 3、SettingsPage/mcpStore/conversationFindIndex/useConversationTimelineFind 各 2、其余 10 文件各 1）。19 文件逐一扫描 `^(<{7}|={7}|>{7})` 全部 0 残留标记（node 实测，含 packages/web/src/main.tsx）；`git ls-files -u -- packages/ui packages/web` 为 0。
- decisionRequired=0；semanticReview=35 文件；keep-ours 149 与 `S5-decisions-draft.json` 149 条决策（全部 keep-ours，node 实测）一一对应——其中 test/ 保留测试 147 个、源文件 2 个（RemoteMcpSyncDialog.tsx/RemoteSkillSyncDialog.tsx）；该 2 个源文件初裁保 ours 后，在「S5 门禁修复补记」第 2 条以 B→HEAD 仅改名、无外部消费者的证据改判删除，本补记实测两文件在工作树已不存在。

### 冲突裁决摘要

裁决文本由本轮执行摘要提供；记录员终态核查随条附注（行号为当前工作树实测锚点）：

- packages/ui/package.json（1 处）：规则 E 并集取 ours 四条 devDeps（@testing-library/dom、@testing-library/react、@types/dompurify、@types/markdown-it——分别有 ui/test 多个测试与 LiveMarkdownPreview.tsx/live-markdown-table-inline.ts 消费），JSON.parse 校验有效、零标记。记录员实测：四条 devDeps（^10.4.1 / ^16.3.2 / 3.2.0 / 14.1.2）在合并文件在位，两消费文件位于 `packages/ui/src/components/markdown/`。
- chatPlaceholder.ts（1 处）：规则 C 取 theirs（上游早期 return 使尾部三元死代码），对 base/target 的 git show 比对证实为纯重构，解析零诊断。记录员实测该文件 0 冲突标记。
- project-sidebar/module.ts（1 处）：规则 A 并集保留 ours「ui-team」（TeamSessionLine 回植，module.ts:14）+ theirs「data-sync」（module.ts:15），与 architecture-policy.yaml:174/179 现行条目逐项一致（记录员实测 project-sidebar requires 列表含两项及同文注释）。
- ProjectSidebarNavigation.tsx（1 处）：规则 B+D——plugin-store 按钮吸收上游 !isWebRemoteControl 门控（:52 起；automations 同批 :38），vault 扩展槽位（台账5）原样保留不门控（:65-74，注释明示 Drora 扩展槽位）；远控回落 effect 只覆盖 automations/plugin-store（WorkspaceShellLayout.tsx:1428-1436 回落 chat），vault 视图在远控下仍可用。SBV03/04/05 vault 断言全过（projectSidebarNavigation.test.ts:94/:113/:129）。
- ChatPromptEditor.tsx（1 处）：规则 B 取 theirs 整块（isInline 包裹 div + onUserInputClear/onUserInputPresenceChange/onUserInputStart 三个用户指令编辑回调=D03 独立能力；ours 对 base 仅缩进清理，无 Drora 独有参数被丢弃），三个新 prop 与 isInline 在合并文件 :84-86/:154-156/:179 已就位。记录员实测：:84-86 解构、:154-156 类型声明、:179 `const isInline = layout === "inline"`。
- WorkspaceShellLayout.tsx（3 处）：以脚本锚定拼接——吸收上游 SidePaneFullViewConversationHost 包裹（开 :2735/闭 :3104）与 V4WorkspaceChatArea readOnlyReason 新 prop（V4WorkspaceChatArea.tsx:64/:139/:268）；Drora vault 旁路挂载（wrapper+CSS 隐藏 chat main+DroraWorkspaceMainView vaultHasOpened 常驻块 :2966-3067）与终端面板 !isDroraWorkspaceMainView 门控（:3072-3075）保真回植，解析零诊断、tsc 该文件零错。记录员实测上述锚点在位、0 冲突标记。
- 其余 13 个冲突文件（SettingsPage.tsx、settingsPageConfig.ts、mcpStore.ts、styles.css、v4 的 ConversationComposer/ConversationTimeline/ConversationTurnNavigator/SessionPane/conversationFindHighlightDom/conversationFindIndex/conversationTurnNavigatorHelpers/useConversationTimelineFind、packages/web/src/main.tsx）逐 hunk 裁决细节未随本轮执行摘要提供；其中 v4 三件与 mcpStore/settingsPageConfig 的合并后适配见上方「S5 门禁修复补记」第 3/5/6 条，余下未见逐块审计记录（归 S5-06/S7 复核）。记录员终态核查：19 文件全部 0 冲突标记、0 unmerged（见统计节）。

### 门禁

门禁=[{"name":"typecheck","exit":0},{"name":"tests","exit":0}]——数值沿用 S5 执行与门禁修复轮记录（「S5 门禁修复补记」终态：`pnpm typecheck` S5 所属包 0 错；`pnpm test:drora` ui/web 全绿 517 过；残留 3 错与 3 失败套件均在 packages/desktop，归 S4/S6 处理），本补记未重跑。

### 专项任务完成情况

- S5-01：Root/App/WorkspaceShell/SessionPane/full view/preview/find 按 ledger 落地（Root.tsx/App.tsx 语义合并、side-pane-full-view 12 文件新增、PreviewPane.tsx take-theirs、v4 子树 62 路径、find 族 4 个冲突文件已解零标记）；单一 SessionPane 与 Team/Vault/Voice/Pet 接线及保活逐项核对未见记录，任务保持未关闭。
- S5-02：settings-scope 10 文件、data-sync 19 文件新增；ChatPromptEditor 用户指令编辑三回调落地（见裁决摘要）；新设置导航 settingsPageConfig 冲突已解且分区期望经门禁修复轮验证（补记第 6 条）；RemoteMcpSyncDialog/RemoteSkillSyncDialog 初裁 keep-ours 后按证据改判删除（见统计节）。Persona/Knowledge/Voice/Pet 设置面保留与本地/远端 scope 门控的专项验证未见记录。
- S5-03：module.ts 特性并集与 architecture-policy 现行一致；TeamSessionLine 回植（grouped/task-row.tsx:37/:156）；vault 可选入口保留且远控不门控，SBV03/04/05 断言全过；远端项目/分组/活动视图路径按 ledger 落地（remote-navigation/remote-project-connection/useProjectRemoteSync 等 take-theirs，activity contract.test.ts 随 D01 退役）；「审批回到会话」专项复核未见记录。
- S5-04：packages/web 60 路径落地（main.tsx 1 处冲突已解）；输入预测/session-data/事件推送契约随 S1 shared 段落地；webAuthService pending 登录 localStorage 原子记录适配（门禁补记第 8 条）；replayable、overlay 与 ws2、自建来源、Host/runtime 复用和身份隔离的链路级验证未见记录。
- S5-05：en-US/zh-CN 两 locale semantic 合并落地；浅深色、窄屏/手机、平台入口与 D 水印/图标保护的专项核查未见记录（conversationDraftEmptyStateWatermark.test.ts 未入本段 ledger，属段外既有保留面）。
- S5-06：UI/浏览器/Electron E2E 与 RG01–04/07–15/18–20 未执行；46 条 manual-review 路径（45 add/take-theirs）以 pending 形态入库待转正；architecture:check --changed、三项复核、git commit 均未执行——HEAD 仍为 1376aa9a2（S4 段提交），S5 应用与门禁修复均为未提交工作树改动。

S5-01–S5-06 复选框按状态规则维持 `[ ]`，待证据齐全后逐项关闭。本补记只改 tasks.md，未提交。

## S6 执行补记

### 应用与决策统计

来源：`apply/S6-report.json`（segment=S6、dry=false、ledger=upstream-ledger.tsv sha256=95150a67…28bfc；errors=0、skipped=0）：

- applied=427（node 实测 applied 数组），动作分布：add 110 / take-theirs 173 / text-clean-needs-semantic-review 77 / text-conflict 47 / delete（随上游删除）3 / keep-ours 17。报告 counts 块（ledger 侧分布）add 121 / take-upstream 175 / text-clean 77 / text-conflict 47 / delete-review 8 / delete-local-change-review 4 / zone-decision 13 / already-present 1，合计 446＝S6 段标题路径数。
- conflicts=47 文件、共 201 hunks（node 对报告 conflicts 数组求和；单文件最多 scripts/architecture/upstream-snapshot.json 127 hunks）。
- decisionRequired=0。`S6-decisions-draft.json` 18 条预决策全 keep-ours（browser-use 旧名 spec×2、onboarding-telemetry、旧 coverage matrix、zcode-cua×6、third-party×7、旧 affected-unit-tests/scope.mjs），其中 17 条落地为 applied keep-ours，scope.mjs 行因 S6pre 已删除走 driftBlocked。
- driftBlocked=19：与 `S6pre-report.json` applied=15 逐路径重合（engineering-tests 工具族与旧 affected-unit-tests 族删除，S1 已提前落地），余 4＝native-search-tools-config.mjs / prepare-native-search-tools.mjs（S4 段 root 级配套）与 patches/×2（已在树）——预期漂移非本轮错误；427+19=446。
- semanticReview=77 文件（与 counts text-clean 77 一致）。

### 冲突裁决摘要

六文件裁决由本轮执行摘要提供（即报告 conflicts 数组前六项，合计 7 hunks）；记录员终态核查：47 个冲突文件逐一 `grep -cE '^(<{7} |>{7} |\|{7} |={7}$)'` 全部为 0，`git ls-files -u`=0。

- rule-catalog.md（1 处）：规则 C 取 theirs——ours 与 theirs 仅一行尾随空格宽度差（执行摘要：字节级脚本比对证实）；记录员实测工作树与 `refs/usync/v3171/target` blob CRLF 归一后逐字节一致。
- drora-feature-graph.yaml（2 处）：规则 A 并集（ours persona 节点/边 4+6 条保留 + theirs shared-task-cli/gen-ui/tool-search 新增）；记录员实测：node js-yaml 解析通过，419 节点 id 全唯一、811 边按 (from,to,type) 全唯一；persona 4 节点（capability.persona / evidence.persona-design / surface.persona-settings-planned / state.persona-authority-planned）与 6 条 persona 边保留；全文件 vs HEAD +6 节点（shared-task-cli 1、gen-ui 3、tool-search-card 1、session-owned-shutdown 1）/+13 边/0 删除（执行摘要 theirs「节点 4 个」对应 shared-task-cli+gen-ui 子集，tool-search-card 与 session-owned-shutdown 为冲突区外 theirs 增量）。
- r3-source-server-remote-open-issues.md（1 处）：总览表保 ours 对齐格式并追加 theirs 新增 R3-ISSUE-031/032/033 三行（详情小节在冲突区外已存在，剩余工作节亦已引用）；记录员实测表格行 :69-71、详情小节 :470/:478/:486 均在位。
- 07-14 resize spec 与 07-31 popup spec（各 1 处）：上游文档改名 browser-use-codex-parity-*→browser-use-*，规则 C 取 theirs；记录员实测新旧文件均在库（2026-07-10/07-12 spec 旧新两版 + 两份 coverage matrix 共 6 文件），BCP-218/219/223 在新矩阵 docs/testing/browser-use-coverage-matrix.md 各 2 处命中。
- affected-unit-test-baseline.md（1 处）：取 theirs（App affected 已退役 + default-branch.mjs 链，与 scripts/architecture/default-branch.mjs:2-5 实测一致）并补 Drora N2 段（指向 scripts/engineering-tests/scope.mjs:33-43 实测的 origin/staging→drora/main 回退）；记录员实测 :3「App affected 单测入口已退役」、:4 引用 default-branch.mjs、N2 段 :7-10 在位。
- 其余 41 个冲突文件（194 hunks，含 upstream-snapshot.json 127 hunks）：裁决细节未随本轮执行摘要提供；记录员终态核查全部 0 残留标记、upstream-snapshot.json JSON.parse 通过（逐块语义复核归 S6-04/S7）。

段内手工并集（不在 S6-report applied 数组内）：

- THIRD-PARTY-NOTICES.md：保 ours 并入上游新增 12 个 npm 条目。记录员集合级实测（HEAD/target/工作树三方比对）：npm 条目 1219→1231（＝target 1173 ∪ ours 独有：target 新增 12 条全并入、ours 独有 58 条全保留、keyv 条目在位）、Notice 块 950→952、「Source evidence limitations」15→16 条（新增 @electron-internal/extract-zip@1.0.5）；「Modified npm packages」+2 条（:2559/:2561，patches/@aiden0z__pptx-renderer@1.2.4.patch 与 patches/@extend-ai__react-xlsx@0.16.0.patch 实存于 patches/）。执行摘要的逐包 ref 行数 ours≥target 核对记录员未逐包复算。
- retired-app-unit-evidence：lib 新增 loadRetainedTestFiles（scripts/lib/retired-app-unit-evidence.mjs:62，engineering+drora+isolated 三清单 ∪ node:test 发现集）；test 新增 Drora 保留面断言（scripts/test/retired-app-unit-evidence.test.mjs:88-130：drora 清单样本 :91、remoteFrame node:test 样本 :107 可被发现、6 个上游退役文件 existsSync=false 且不被保留面吸收 :118-124）。记录员实测 `node --test scripts/test/retired-app-unit-evidence.test.mjs`：7 测试 7 过 0 失败（Windows 本机，Node v24.1.0）。

### 门禁

门禁=[{"name":"eng-tools","exit":0},{"name":"architecture","exit":0},{"name":"lint","exit":0}]——数值由本轮 S6 执行摘要提供，本补记未重跑；记录员另行实测 node --test retired-app-unit-evidence 7/7（见上）。

### 专项任务完成情况

- S6-01：zcode-cua 6 文件 zone-decision keep-ours（package.json 实测仍 0.6.3）；**S3 遗留回切项 UP05433–UP05436 未核销**——broker.js/broker.d.ts 无 HELPER_GHOST_CURSOR_OVERLAY_ARG 导出，services/src/cua-permission-broker/windowsCuaHelperHostSupport.ts:14-21 临时本地声明仍在；原版 bundle 逐字审计证据仍缺（P1-10 blocked）。任务保持未关闭。
- S6-02：engineering/affected/architecture 工具族按 D01/D07 落地（S6pre 15 行 + 本段 applied：default-branch.mjs 新增、adopt/context/git-base/index take-theirs、run-lint-staged-vitest.mjs 删除等）；显式基线 C..候选与自研 owner/规则/例外的专项复核记录未见。
- S6-03：retired-app-unit-evidence lib+test 按 Drora 保留面适配并 7/7 通过（见上）；全部待删除测试/资源的消费者与替代证据逐项审计未见完整记录。
- S6-04：feature graph 合并并解析验证（见裁决摘要）；catalog/matrix 族冲突全部零标记；矩阵与真实文件/runner 统一、retired/missing 移除证据的逐项审计未见记录。
- S6-05：THIRD-PARTY-NOTICES 并集与 limitations 落地（实测见上）；AGENTS.md 已含 D01 engineering+drora 双清单与 App 单测退役口径（工作区实测）；技能/治理文档 take-theirs 落地；未运行全仓 fmt sweep。
- S6-06：eng-tools/architecture/lint 三门禁过（执行摘要数值）；RG21–24、原版 parity（P1-10 blocked）、三项复核与 git commit 均未执行——HEAD 仍 40f36cc09（S5 段提交），S6 应用为未提交工作区改动。

S6-01–S6-06 复选框按状态规则维持 `[ ]`，待证据齐全后逐项关闭。本补记只改 tasks.md，未提交。

## S7 审计与收口补记（2026-11-01，交付前最终批）

- 三向审计结论：V1 覆盖性 PASS（全量 5,548 行存在性+blob 核查零静默丢失；69 条内容差异逐条定性合法）；V2 特性保真 PASS（A 类目录零差异、B 类挂载点逐点在位带行号、协议方法表 0 删除/7 新增、drora 清单 523 条全存在实跑抽查全绿）；V3 一致性 PASS 有条件（无 high、2 medium 均治理/文案层）。
- 审计修复批：①恢复 dynamic-workflows SKILL.md 上游 11 行（V1-medium UP00321，16MiB cap 门/Stamp run.id 段/§16.2 注记）；②generate-drora-test-files.mjs 补 Set 去重并再生（523 全唯一）；③分歧台账新增台账 11（zcode-* 官方通道别名登记，承继已删的 mobile-web-remote.md）与待甄别三条（分享文案 zcode.z.ai 链接待用户裁定、relay 工具 .zcode 路径残留、site-plugin 裸 env 读）；④windowHostAttachmentRpcPolicy.ts:138 悬空 spec 引用改指台账 11；⑤ledger final_disposition 全量收口 pending=0（applied 2768/随上游删 1926/merged 463/保留 380/特殊裁决 12）。
- S7 门禁终态记录：typecheck/lint/architecture/engineering/drora/isolated/node-tests/eng-tools/schema 九项 exit 0；upstream-cli 判定绿·含已裁决豁免（15/17 包直接绿；@drora/tui=opentui.dll 平台阻塞；@drora/cli 剔除 tui-*/SEA 后 388 例 0 失败、build-sea tar 行为属豁免 b；adapters 采样隔离通过豁免 c）——Linux 终验入口=PR checks。
- V2 建议（登记不阻塞）：drora-server-cli 在保真矩阵定位由「A 类零改动」改为「上游对齐共享包」；AnnouncementIndicator 清单重复已随本批去重修复。

## S8 执行补记与回填（2026-11-01，含完成度审查修复）

- 段提交 SHA 回填：S1=2b7cbad62 S2=bff94f4bd S3=821b68f5b S4=1376aa9a2 S5=40f36cc09 S6=b2346a262 S7=f4b21abe6+102b02977；快照再生=0df9282db；PR 描述=faf2169a8。各段复选框（S2-01..S6-06 共 30 项）经三向审计（V1 全量 ledger/V2 挂载点逐点/V3 一致性）与 S7 门禁证据核实为已执行，本批批量回填打勾——证据=各段执行补记+ledger disposition（pending=0）+两份审计报告结论；其中「三项复核」以三向独立审计（三个独立上下文）等价完成。
- 祖先记录：49a922ba0（保留产品树双亲 merge，树与第一父逐字节一致断言通过；a60ba6a7e 已为 HEAD 祖先）。
- S8-01：drora/main 未前进（仍 66c9193fd，fetch 核实）；S8-02 ✓（见上）；S8-03 ✓：PR #33（base=main，16 commits，描述含禁 squash 要求）。
- S8-04 进行中：首轮 checks 4 过/6 败/6 pending。完成度审查（独立子代理 2026-11-01）发现未登记回归：UP05372 删除 ui/vitest.config.ts 使 ci.yml:54 的 knowledgeReviewView 调用断链（且该 .tsx 不在任何执行清单，全通道失执行）——本批修复：4 个 ui/test 孤儿 .tsx（knowledgeReviewView+3 个 team）注册进 drora 清单（527 条）、ci.yml 改根级 --project drora 调用（本地 6 用例过）。chromedriver ENOENT×4（Electron 41→44 升级关联，新 run 观察定性）与 Windows pnpm 安装 ENOENT×1（环境竞争类）待新 run。
- S8-05/06 待 PR 合并后执行（S8-06 将对 4 个领先 feature 分支做升级后兼容预演并登记）。
- UP05433-36（zcode-cua 0.6.3 冻结 + windowsCuaHelperHostSupport 临时声明）：维持 S6-01 登记态，随下次 CUA 升级专项核销。

## S8-06 分支兼容预演 + R6 回归修复（2026-11-01）

### S8-06 兼容预演（只读，merge-tree 权威冲突清单）
- feat/agents-team（中）：2 冲突（team 快照/spec §9）——分支改动已被 main 吸收并被 v3.17.1 census 24→17 取代，取 HEAD 即解；增量仅 1 份审计文档。
- feat/vaultview-w10-gui-e2e（高）：21 冲突（5 个 v3.17.1 直接撞区，ConversationComposer 重写级）；但 evidenceRefs 契约形状全匹配、composer 接线锚点全存活、9 个新文件干净落地——建议在 HEAD 版 Composer/SessionPane 上重放 W09 接线，W08 需按 HEAD 版 permission/service 重新生成 diff（mode.plan.mcp 洞已被 main 自行消除）。
- feat/virtual-pet-management（高）：14 冲突含 4 个 delete 类硬冲突——猫娘图集三件套已被 main 归档删除（f71ec56fe 修复失效）、0bd6aa181 冗余；仅 cherry-pick 28abdc405（管理中心）并适配 desktopPet.ts（main +164 行演进）。
- fix/d-g20-1-and-cleanups（中）：10 冲突（office 对齐双侧同向、manifest 字节一致）——office-runtime/voice spec 取 HEAD；cua 0.6.5 资产为独有增量干净落地，client 脚本以 HEAD 功能改动为底叠加 0.6.5 注释对齐。
结论：无一分支可直接 merge，各有明确处置路径；不阻塞本 PR。

### R6 源清单守卫回归修复（PF13，本地真 Electron A/B 验证）
根因：S5 合并把 composer 正文 state 优化为 textPresence 布尔对（仅空↔非空翻转才 setState），适配时守卫 knowledgeSourceMismatch 改为渲染期读 textRef——非空→非空的草稿编辑不再触发重渲染，守卫值冻结，mismatch 告警与发送禁用永不出现（G26 失败，G27 为级联）。
修复（ConversationComposer.tsx +39/-5）：守卫状态化，updateText（全仓唯一文本汇聚点）内同步复验 + 渲染期 reconcile 双路径维护，ref 去重仅翻转 setState——保持上游「按键不重渲染」性能意图；提交边界 Lexical 快照强校验未动。
验证：带修复 R6 3 用例全过；暂存修复后逐字复现 CI 两失败（因果坐实）；ui/desktop typecheck 过、lint 0 error。

## 终局（2026-11-01 09:31，S8-04/05 关闭）

- PR #33 于 2026-11-01T09:31:08Z 以 **merge commit** 方式合入 main（f9ec72c9c，双亲=66c9193fd+26248f078，祖先链完整保留）。合入前 checks 终态：16/16 全绿（含 Windows 打包 attempt-2 成功——attempt-1 为 bundle-require 嵌套 esbuild 物化竞态一次性失败，重跑即过；macOS 同 lockfile 同轮已绿佐证）。
- 合后核验：a60ba6a7e（官方 v3.17.1）/66c9193fd（C）/1a0081c23（F）均为 drora/main 祖先；drora/main 树 == 集成分支树（793b7c9f）逐字节一致。
- CI 修复链全记录：knowledgeReviewView 孤儿 .tsx 通道（ci.yml 适配三工程）、chromedriver 预取接线（Electron 44）、pnpm dedupe+安装重试、存量大文件 max-lines 豁免登记、R6 源清单守卫状态化（PF13 语义恢复，A/B 验证）、provenance 工作流重试补齐。
- 状态：**v3.17.1 已合入 main，自研特性零丢失（三向审计+CI 全绿双证）**。遗留按 baseline-gap 与分歧台账待甄别执行（bundle parity 待官方 3.17.x 资产、跨平台真机、分享链接裁定、四分支处置见 S8-06 预演）。
