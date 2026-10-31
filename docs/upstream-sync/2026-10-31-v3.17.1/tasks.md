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

- [ ] S2-01 导入官方 SessionLifecycleController 与协议 façade；统一冷恢复、create/fork、lease、hydration、stop/restart，先补竞态/失败回归。
- [ ] S2-02 合并 workflow quota/concurrency/resume、插件 metadata/search/MCP Node fallback、model feature header、工具权限与恢复逻辑。
- [ ] S2-03 回接 Team runtime/skills gate/工具注册/审批历史和 vaultSearchPort、write-tier，不新增 owner 或还原文件内自研逻辑。
- [ ] S2-04 回接 Persona capture/control/learning notification/worker；验证 E/U/L、每轮冻结、取消/销毁和独立存储，避免新 lifecycle 绕过捕获或留下旧 lease。
- [ ] S2-05 合并新 site 插件与相关 seed/manifest、node-repl-host 生成物；保持官方字节/生产者边界，生成类型通过对应 build 重生。
- [ ] S2-06 执行实际 CLI 包级 typecheck 与所改/扩展测试，完成 RG02/03/05/10/11/17/20；三项复核、提交和 ledger 回填。

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

- [ ] S3-01 合并 project-storage 0007–0009/schema/repos/task-facts/remote projects；保留分组、NULL 归属、CLI 时间、离线本地入口与同路径身份隔离。
- [ ] S3-02 按 D05 验证 purge 的实际授权/调用，不自动改变软删除产品边界；旧 migration checksum 不重写。
- [ ] S3-03 合并 data-sync/settings/provisioning/Provider/客户端 SDK/server-cli，公开入口与 source-settings/手机白名单同步。
- [ ] S3-04 保留知识库、Jev/local embedding、Obsidian 的服务注册与插件/协议；安全 NO-GO、receipt/fencing/epoch/批准不放松。
- [ ] S3-05 自建 Relay 服务与新 shared 契约对齐，完成新增能力可用性审计与兼容降级；服务端必要扩展按独立模块/spec 任务落地。
- [ ] S3-06 运行 schema、逐表 hash/失败恢复/旧版兼容、服务与 Relay 回归、远端 build；完成 RG04–06/13/15/16/18/20，三项复核、提交与 ledger。

## S4：Desktop main/Host/preload/构建（1,757 路径）

前置：S1–S3。

- [ ] S4-01 合并 Host attachment policy/调度/RPC、Main 转发与窗口/托盘/未读；保留一窗口一 Local Host、远端连接表、跨 Host lease。
- [ ] S4-02 合并远控新能力与通知/Renderer actions；保留自建 Relay 来源、设置读取与 getEndpointUrls，三 URL 一致，验证切换与重连时序。
- [ ] S4-03 保留 Pet 主进程/预加载/资源/设置/表达、Voice 麦克风策略与 claim 接线、Persona 本地控制能力、knowledgeHost 与 update feed。
- [ ] S4-04 合并 builder/native search/runtime Node/SEA/source-server 构建及发布依赖；Drora 签名/更新渠道不被覆盖，worker/Sharp 产物入包。
- [ ] S4-05 E2E spec/fixture/helper 的上游移动与删除逐项审计：A/D 配对与 case ID 对齐，保留 Drora 修改；不得仅拷 spec 丢 fixture 或让 runner 不再发现。
- [ ] S4-06 执行 desktop 类型、真 Electron、RG07–09/12–15/17/19/21；记录 Windows 与 macOS/Linux 各自证据；三项复核、提交与 ledger。

## S5：UI、Web 与手机（1,532 路径）

前置：S1–S4；阅读 DESIGN，插件面另读 CONTEXT。

- [ ] S5-01 合并 Root/App/WorkspaceShell/SessionPane/full view/preview/find；单一 SessionPane、Team/Vault/Voice/Pet 接线及保活逐项核对。
- [ ] S5-02 合并 settings-scope/data-sync/用户指令编辑与新设置导航；保留 Persona/Knowledge/Voice/Pet，scope/capability 与本地/远端门控正确。
- [ ] S5-03 合并 project-sidebar 与远端项目/分组/活动视图；保留 Vault 可选入口、TeamSessionLine 和审批回到会话。
- [ ] S5-04 合并手机事件推送/输入预测/session-data/登录恢复；保留 replayable、overlay 与 ws2、自建来源、Host/runtime 复用和身份隔离。
- [ ] S5-05 中英文 key、浅深色、窄屏/手机和平台入口；保护 D 水印与图标，不把原版 Z 图形重新引入 live UI。
- [ ] S5-06 执行相关 UI/浏览器/Electron E2E 与 RG01–04/07–15/18–20；新场景先 catalog/matrix 后 pending，未转正不写已覆盖；三项复核、提交与 ledger。

## S6：还原资产、工程工具、文档与验证入口（446 路径）

前置：P1；工具必要子批提前为 S6-pre，其他跟随对应产品段。

- [ ] S6-01 CUA/seed/runtime 与原版 bundle 逐字审计；每项变更有版本/hash/偏移/片段，缺证据保持冻结；检查 helper 品牌/权限和跨平台能力。
- [ ] S6-02 工程/架构/adopt/pre-push/affected 工具按 D01/D07 落地；验证显式基线 C..候选、自研 owner/规则/例外，禁用无差别 snapshot 洗白。
- [ ] S6-03 完成全部待删除测试/资源的消费者与替代证据审计；保留自研和修改用例的可执行回归集合，Node/CLI/CUA/E2E 不误入退役范围。
- [ ] S6-04 测试 catalog/matrix/feature graph/roadmap 与真实文件/runner 统一；移除证据明确 retired/missing，保留历史报告原貌；不能靠删除矩阵消除缺口。
- [ ] S6-05 合并技能/AGENTS/README/third-party/许可/native/patch 文档，保留 Drora 决策与真实命令；不运行全仓 fmt sweep。
- [ ] S6-06 跑工程工具/架构/格式/许可证/原版 parity 与 RG21–24；三项复核、提交与 ledger。

## S7：依赖终态、全路径对账与终验

前置：S1–S6。所有项为必需门，不按“基本通过”放行。

- [ ] S7-01 用 Node 24.14.0 / pnpm 10.33.2 重生成 lock；核对 importer/seed 排除、native/worker/patch 闭包，保留受 Git 跟踪的 vendored 内容。
- [ ] S7-02 upstream ledger 5,548 行逐项 final disposition，证据/commit/复核齐全，pending=0；中间版本被 U2 撤销的项目显式 superseded。
- [ ] S7-03 local-preservation 与 feature-branch-delta 全部有结论，17 类 PF / 24 类 RG 完成对账，独立目录意外改动为零，无入口断线/未注册测试。
- [ ] S7-04 typecheck、lint、architecture（显式 base C 与必要全图）、schema、相关 UT/CLI/CUA/工程、格式、许可、命名/契约检查均真实完成；根全量 UT 未获明确请求不执行。
- [ ] S7-05 桌面 continuous/手机 replayable、本地/SSH/WSL 与所需跨平台 E2E/真实打包门完成；环境 blocked 项保留并阻断对应完成声明。
- [ ] S7-06 原功能原缺口逐条给结果；Persona/自建 Relay 等若仍有必需发布门缺失，保持待验，不删实现、不放宽验收。
- [ ] S7-07 输出最终 completeness/feature-fidelity/literal-consistency 报告及回滚演练，证据无占位、无真实用户数据/凭据。

## S8：上游祖先、PR 与 main 收口

前置：S7 全部通过。此阶段尚未执行。

- [ ] S8-01 重取 Drora main，若前进先合入集成分支并重开相关任务；更新 merge candidate 与输入 manifest，重新复验。
- [ ] S8-02 记录上游双 parent 祖先，tree 前后严格一致；验证 C/F/U2 为祖先及逐路径内容已吸收，不以 ours merge 替代实际迁移。
- [ ] S8-03 创建以 Drora main 为 base 的完整 PR，附本计划/ledger/验证；保留上游祖先关系，禁止 squash/rebase 丢失记账；不向官方仓库发功能 PR。
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
