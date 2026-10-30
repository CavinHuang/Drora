# Drora Persona v5 实施计划

日期：2026-10-29。状态：design-complete / P0a 完成 / P0b 切片 C 完成（切片 D 待做）。本文件整体替代原 ContextSection＋env 文件方案的 P0 计划；不得执行其旧步骤。依据[唯一主 spec](../../../specs/drora-persona-system.md)、[数据合同](../../design/drora-persona-data-contracts-2026-10-29.md)、[PM01–PM58](../../design/drora-persona-system-impact-2026-10-28.md)。

用户已于 2026-10-29 要求新建实施分支并建立一个专门 PR。整个功能统一使用 codex/drora-persona-system 分支和一个 Draft PR；下面的切片通过连续提交和同一 PR 的检查清单跟进，不拆到其他 PR。实施授权不等于模型费用实验、发布或合并授权。

## 1. 开工前

1. 运行 workspace freshness，使用 mise.toml 对应 Node 与当前 package.json 的 pnpm。
2. 对本次实际代码diff使用 architecture-governance，先架构检查再取模块上下文；新的文件/契约登记遵守当前架构策略。
3. 核对本计划源码基线与HEAD；重点复核主请求投影、runtime preferences、消息来源、model-io、voice、桌宠。恢复链路变化先更新矩阵。
4. 先验证新旧端可兼容的能力发现路径。旧严格hello不能直接塞新字段；找不到合法接缝则该组合不开放，不用捕获未知错误代替能力协商。
5. 确认P0的G1/G2合同已一致；实现中不临时恢复公共section、env开关或个人偏好依赖旧M。

## 2. 接缝与上游重放记录

以下均为候选改动位置，实施时按真实模块归属与diff hunk确认。主体放新模块，既有文件只转交可选端口；不得将特性逻辑内联进还原文件，也不以“最小接缝”绕过禁止特性修改的文件边界。

| 接缝                                  | 新模块承担              | 原链路允许变化                        | 上游同步重放依据                       |
| ------------------------------------- | ----------------------- | ------------------------------------- | -------------------------------------- |
| Settings schema / runtime preferences | E的合同/能力门          | 默认false可选许可；新建/cold冻结      | schema字段＋启动请求装配，旧端字段缺省 |
| create-app/进程组合                   | 惰性Persona工厂         | 注册通用可选端口，不阻塞ready         | 组合注册位置/依赖方向                  |
| turn admission之后、首主请求之前      | 资格/capture编排        | 捕获一次，保留旧同步冻结与分流顺序    | 一个调用接缝，取消信号原样传递         |
| turn-loop/provider-request helpers    | 纯贡献编译与投影adapter | 可选contribution、预算/recordable共用 | 缺参数原结果，entries仍canonical       |
| 控制协议/Host服务注册                 | 独立管理API             | 能力发现后开放，无旧会话帧扩字段      | 新方法注册与代理                       |
| UI Settings/对话菜单                  | 独立组件/hook           | 插入入口，不由UI读库                  | 组件组合点与原导航                     |
| P1b成功轮机会通知                     | 学习消费者/仓储         | 原完成路径非阻塞有界通知              | 一个可选观察端口，无旧库outbox         |
| P2桌宠render                          | 独立纯呈现映射          | 当前态文字/样式，不改动画/导航        | typed presentation组合，不推导历史     |

每片提交在同一个 PR 记录实际文件/hunk、端口签名、默认关闭行为、上游替换条件；若官方已覆盖完整契约，则按当前 upstream 迁移规则评估，不因为名称相同直接替换。

## 3. 切片与退出条件

### A · P0a 纯合同与主请求实验

交付：共享schema/常量、Core纯编译/资格、测试内存贡献适配。先用受控端口证明接缝，不先写完整UI或学习库。

验证：PM01/03–05/12/20/30/34/36/47/51；包括最终provider body、ToolSearch、sourceEntries、recordable二次渲染、continuation回写。原canonical不变；原Continue过滤等记录语义保留。直接辅助请求无contribution，新诊断仍如实。取消不能降级成继续运行。

退出：缺参数路径与基线等价；没有共享数组变异；不能满足则修spec和端口，禁止通过写公共历史简化。

### B · P0a 独立存储与服务生命周期

交付：PersonaAppService、adapters worker、P0三类表（authority/core/receipt）、版本化模板和逻辑管理API。

验证：PM06/16/19/21/27/53/55/57；多进程CAS、锁等待、迟到响应、outcome_unknown幂等；未启用不读库，显式管理不创建聊天；当前库损坏与首次默认明确区分；正式worker最低可运行验证。

退出：旧库schema/活动时间不变，扩展故障不退出CLI，不吞原错误。存储不兼容只停扩展。没有性能证据不得固定250ms为达标承诺。

### C · P0b 许可、协议与设置

交付：E、双层能力协商、设置编辑/确定性预览/恢复默认、独立application查询；新字段只有一个出处。

验证：PM13–15/19/29/33/35；新旧UI/Host/CLI交叉，warm/new/cold/fork；手机仍共享owner，不新增Agent；SSH/WSL不传资料；无模型也能管理；CAS冲突保留草稿、切authority迟到结果无效。E保存与初始化非跨库原子，UI如实显示资料不可用。

退出：设置显示已保存不冒充当前轮应用；P0所有入口文案/主题/i18n与DESIGN一致。测试文件名和命令由实际目标包确定，不复制原Mac绝对路径。

### D · P0b 效果、发行与回退

交付：冻结的模型对照样本、诊断边界说明、三平台打包检查记录。

验证：PM47真实效果、PM57性能、PM35升级/关闭/旧版/再升级；G3–G5。旧Dream无新调度入口；不能用“handler当前不自动触发”宣称工具无法读日志。

退出：固定阈值通过，默认关闭无旧行为变化；所有限制如实展示。P0只在结果记录齐全后标shipped；仅类型/lint通过最多说明对应检查，不是P0完成。

### E · P1a 显式交流默认与导出

交付：Preference/Policy表、唯一四键、U、纠正/忘记、只读导出；没有自动学习队列/模型写工具。

验证：PM07/10–11/17/22–23/28/42–43/45–46/49–50/52/56。M off时显式默认可用，旧M不被打开；两个编辑入口同字段CAS；cutoff前后forget、平台取消/失败、无资料不初始化导出；逻辑撤销不宣称全域擦除。

退出：新域与项目Memory冲突按范围解释，不改旧prompt或旧gate让测试通过。不稳定的偏好键不发布，而非扩大数据同步。

### F · P1b 有限自动学习

交付：可信源适配、无文件工具的模型抽取端口、accepted仓储/租约/预算、来源/争议UI。

验证：PM08–09/24–26/31/37–41/44/48/52/54及相关回归；真实owner角色/分支，内部user和synthetic real_user分开；来源无法证明跳过；关闭U/L、forget、并发fencing、崩溃预算预留、同source幂等和无任务活动写入。

退出：负例错误有效写入为0；真实模型效果/预算满足合同；不能从model-io或旧summary建新域证据，不把旧抽取工具全部复用给新学习。不可用的键保留P1a，不阻断已验证核心。

### G · P2 当前态呈现

交付：桌宠当前态表达的独立映射；原动画/交互/导航保持。

验证：PM18/58及原桌宠E2E；中断结束不庆祝，重复error不算多次失败，attention不当作permission超时。语音仅兼容检查，不新增情绪输出链路。

退出：无复杂主动气泡、日额度、持久情绪或人格反写。若要这些能力，先另立业务事实与呈现策略spec，不能在Main补计时猜任务时长。

## 4. 测试与检查执行合同

- 业务改动先补对应行为测试；交互改动按e2e-case-lifecycle建立manual-review，真实capture与审查后才能promotion。
- 根必须运行 pnpm typecheck、pnpm lint；格式使用 pnpm fmt:check 或明确报告仅受影响文件检查范围。
- 按实际代码范围执行架构检查及目标CLI/包的定向测试。根affected只覆盖选中的根UT，不代替CLI或E2E。
- 不在未获用户要求时运行 pnpm test / pnpm test:unit 全量。
- 每次验证记录HEAD、环境、命令、退出码、用例、产物、未跑原因；既有失败不能写通过。
- 模型测试与replay fixture分开；真实模型可能产生成本，按已授权实施范围与冻结预算执行，不在本设计轮擅自调用。
- 发行包验证包含worker资源和退出，不只测试开发目录能找到文件。

## 5. 交付与回退

每片提交可独立 review，统一追加到同一个功能 PR；新能力默认 off。提交只包含功能相关文件，不裹挟本地 voice 等无关文档。PR 保持 Draft，直到全部约定交付范围及验收完成。

回退以停止注册/捕获新扩展为主，保留独立资料；不回滚旧session库、不恢复整库备份、不删除用户导出。发现旧数据不兼容或原执行被扩展阻断属于发布阻断，不加超时兜底掩盖一致性问题。

## 6. 本轮状态

统一 spec、接口/存储/生命周期合同、58 项验收和本计划完成。P0a 首批已实现：托管 cli-persona-domain、五字段严格校验、确定性不可变核心贡献、可选请求 overlay、canonical/source/cache 索引对应、直接辅助调用隔离。没有注册执行许可或 UI，普通调用不传 contribution。

第二批（同日）完成 Runtime 轮内捕获接线：cli-persona-domain 新增封闭世界入口资格表 `isPersonaEligibleMainRequest`（合成来源、model-only、automation、off-peak 一律不合格，未知值拒绝）与 `PersonaCapturePort`/outcome 契约；runtime 经 `AgentRuntimeDeps.personaCapturePort` 可选注入，`executeTurnCommand` 在 admission 同步冻结资格（PM34：旧模型冻结前无新增 await），`runRegularTurnLoop` 在首个合格主请求前经 `capturePersonaContributionForTurn` 捕获一次并整轮冻结（重试、工具续跑、输出 token continuation、同轮 compact 后主请求复用；omitted 终局，迟到结果不生效）；取消沿原 AbortSignal 传播，端口故障/cancelled 按省略降级并如实记录；实际请求与 recordable 二次渲染传同一冻结贡献，token 估算沿用含贡献的最终 messages；canonical 历史零回写。编排内联在 turn-loop.ts（避免为单个接缝新开未受管文件），生产服务落地 P0b 时由独立模块承接。另外修正：原 `src/persona/contract.test.ts` 不在 vitest `tests/**` 收集范围从未执行，已移入 `tests/persona/contract.test.ts`（28 项现真实执行），并删除其单行指针 `tests/persona/domain.test.ts`。

第三批（切片 B·P0a 独立存储与服务生命周期，同日）落地共享契约扩充、独立库存储与生产服务装配：`packages/shared/src/contracts/persona.ts` 新增为存储键/错误码/限额常量单一出处（`PERSONA_STORAGE_KEYS`、`PERSONA_ERROR_CODES`、`PERSONA_CORE_LIMITS` 等），contracts 目录 contract/module/示例/测试同步；adapters 新增托管模块 `cli-persona-store`（`src/storage/persona/`：独立 SQLite worker、`0001_persona_p0_base` 迁移建 `persona_authority`/`persona_core`/`persona_mutation_receipt` 三表、多进程短事务 CAS、首次默认与库损坏明确区分、`schema_incompatible` 进程内终态），policy requires `[shared, sqlite-migrations]`；bootstrap 新增托管模块 `cli-persona-service`（`src/app/drora-persona/`：PersonaAppService 无会话管理 API——初始化幂等、CAS/`mutation_conflict`、校验拒绝、确定性预览零存储访问、`storage_capacity` 透传——与版本化产品模板），requires 由真实 import 推断为 `[cli-persona-domain, cli-persona-store, drora-cli, shared]`；`create-app.ts` 生产默认装配进程级 Persona 绑定与 `personaCapturePort`：执行许可 E 未注册，生产 capture 快速返回 `omitted(permission_not_granted)`、零开库零 worker，取消返回 `cancelled`，路径只取自 `PERSONA_STORAGE_KEYS`（模块内无 cwd/homedir/process.env/storage.dir 派生）。为支撑服务层重构修正 `core/persona/compiler.ts` warmth 类型窄化（首次构建 TS2322，修复后重建通过）。门控（文档同步时全量复跑）：adapters `tests/persona/` 3 文件 37 项、bootstrap `tests/persona/` 4 文件 34 项、core `tests/persona/` 2 文件 54 项全部通过；走真实 `createDroraApp` 的 `tests/drora-protocol.test.ts`＋`tests/legacy-cli-output-token-runtime.test.ts` 120 项通过，验证新绑定不改变应用装配行为；core/adapters typecheck 与 bootstrap `tsc --noEmit` 均 0 错误（adapters/shared dist 重建后第二批遗留的 3 个 stale-dist 错误消失）；`pnpm architecture:check --changed` 0 违规；根 lint 0 errors/395 warnings 与基线一致；根 typecheck 仍 exit 2 且 20 个错误全部位于 relay-v2-server 已知 TS2307 家族，无 persona 相关。边界：无 Host 协议注册（`drora-protocol/` 全目录无 persona 字样），执行许可/能力发现/设置 UI/应用状态属切片 C；旧 session/task schema、任务活动时间、还原文件与 `docs/voice-merge-readiness-2026-10-24.md` 零触碰；本批改动停留工作区待提交。

第四、五批（切片 C：协议与许可层＋设置 UI 层，2026-10-30）落地执行许可 E、双层能力发现、无会话管理路由、应用状态与设置页；落地事实的完整记录见主 spec §13 第四、五批。实现范围与文件：shared `contracts/persona.ts` 常量区新增能力位/偏好键/七个 wire 方法名/省略原因字面量单一出处，`drora-protocol/index.ts`、`drora-protocol-v4/transport.ts`、`protocol.ts`、`validationAppSettings.ts` 接入能力 schema 与 `personaEnabled` 偏好；services `drora-agent/`（droraAgent、droraAgentService、droraAgentConnectionScope、independentPlanSupport）与 `node.ts` 落地按连接实例缓存的能力探测（缺失/断线 fail-closed false）、附加门剥键与启动偏好冻结（fork 继承）；core `persona/` 与 `runtime/`（types/internal/internal-methods/agent-runtime/turn-loop/methods）落地轮内应用记录与 `getPersonaTurnApplication` 三态查询口；bootstrap `app/drora-persona/`（contract/persona-system/persona-app-service）与 `drora-protocol/`（entrypoint/server/server-types/server-operations）注册七个无会话管理方法、惰性控制端口与 `capturePortForPermission` E 门，`create-app.ts` 改绑 E 门端口；UI 新建受管模块 `packages/ui/src/drora-persona/`（11 文件：usePersonaCoreEditor/PersonaSettingsSection/PersonaApplicationArea/usePersonaControlAvailability/contract 等）并接入 SettingsPage、settingsPageConfig、settingsNavigation、userActionTraceCatalog 与 zh-CN/en-US 文案；`vitest.config.ts` 与 `architecture-policy.yaml` 同步登记。测试数（标注「复跑」者为本次文档同步实际执行并核实）：复跑 UI drora-persona 3 文件 24 项、core `tests/persona/` 2 文件 60 项、bootstrap `tests/persona/` 5 文件 54 项、adapters `tests/persona/` 3 文件 37 项、shared 契约＋services 能力门合并 3 文件 70 项，全部通过；实现轮实跑 bootstrap `drora-protocol.test.ts`＋`protocol-runtime-shutdown.test.ts` 124 项、`droraAgentService.test.ts` 41 项、`droraAgentService.v4.test.ts` 64 项通过（协议轮曾出现 7 项 droraAgentService 失败，经 git stash 基线对照确认为当轮引入，以 `lifecycle:"observation"` 修复后复跑全绿）。门控：`pnpm architecture:check --changed` 终跑 0 违规（期间抓到 contracts 测试 335>300 行、ui 单文件 996>800 行，分别压缩与拆出 usePersonaCoreEditor 解决；`ui-drora-persona` 受管模块按 ui-drora-extensions 先例登记 policy）；shared/services/ui/bootstrap/core 包级 typecheck 0 错（services 无 typecheck 脚本，按 fallback `tsc -p tsconfig.json --noEmit` 执行）；根 lint 0 errors/395 warnings 与基线一致（协议轮实跑；UI 轮以 oxlint 核对本层文件 0 errors，1 warning 位于既有 hooks 文件）；根 typecheck exit 2 的 20 个错误全部为 relay-v2-server 既有 TS2307 家族（`grep -v relay-v2-server` 无输出），如实归属非本切片；UI 邻域回归 34 文件 378 项中 377 通过，唯一失败 paneEscapeStopGeneration 经 git stash 对照确认为既有失败；根 fmt:check 本轮未跑（基线为全树 CRLF 环境性失败），UI 本层文件以 `oxfmt --check` 内容级核对通过；未跑 pnpm test/test:unit 全量（未获授权）。手机/远端不广告 personaControlV1；E2E、正式 worker 打包验证与真实模型效果仍属切片 D，P0b 未整体完成。

- [x] P0a 核心编译与可选请求投影接缝；28 项新单测。
- [x] 相关 MCS/ToolSearch 回归：4 文件、47 项测试通过。
- [x] CLI core typecheck、架构 changed 检查通过；root lint 通过（395 个既有 warnings）。
- [x] P0a Runtime 轮内 capture、记录/预算实际接线、取消/续跑/恢复集成：资格表 + 可选端口 + 每轮一次冻结捕获 + 记录一致 + 取消传播；新增 26 项集成测试（含资格表、默认关闭等价、busy 队列执行时捕获、continuation/工具续跑复用、记录投影一致、取消不降级、故障降级、不合格入口零捕获）。
- [x] P0b 独立库 worker 与无会话管理服务：共享契约扩充＋`cli-persona-store`（独立 SQLite worker、迁移、多进程 CAS）＋`cli-persona-service`（PersonaAppService/产品模板/逻辑管理 API）＋`create-app` 生产默认装配；执行许可 E 未注册，生产 capture 默认快速 `omitted(permission_not_granted)`、零开库。
- [x] 切片 C（§3-C·P0b 许可、协议与设置）完成：执行许可/能力发现、无会话管理路由、设置 UI、应用状态（2026-10-30，协议与许可层＋设置 UI 层两批）。P0b 未整体完成——正式 worker 打包验证与 E2E/真实模型效果仍属切片 D 待做（见下条）。
  - 协议与许可层：shared contracts 字面量单一出处（能力位/偏好键/七个 wire 方法名，评审后追加省略原因字面量）；CLI↔Host `runtimeCapabilities.personaControlV1`（控制端口已装配才广告，缺席整键缺席 fail-closed）；Host↔UI `hello.capabilities`（仅 desktop-continuous，手机/远端不广告）；`personaEnabled` 运行偏好（原 Settings → 能力确认后附加 → record/runtimeConfig 冻结，fork 继承零重读）；CLI server 七个无会话管理方法（entrypoint 惰性控制端口，零 session/create，未知方法 -32601）；bootstrap `capturePortForPermission` E 门（off 零 IO／on 真实捕获，未初始化省略不建库，250ms 总预算）；core 轮内应用记录＋`getPersonaTurnApplication`＋`persona/getPersonaApplication` 三态查询（applied/omitted+reason/not_available，重启不伪造冷历史）。
  - 设置 UI 层：`packages/ui/src/drora-persona` 全套（usePersonaCoreEditor 编辑状态机——五字段草稿/CAS/focus 重读/预览去抖/初始化与恢复默认，outcome_unknown/RPC 失败保留 mutationId 同 ID 幂等回放（PM53）；PersonaSettingsSection 分区与 E 开关文案；PersonaApplicationArea 应用情况三态；usePersonaControlAvailability hello 能力门）＋SettingsPage 集成＋zh-CN/en-US 文案。评审收口：capture 省略原因字面量上移 shared/contracts（UI 与 bootstrap 同源）、runtimeCapabilities 生产点改用 `PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1` 计算键、E on 捕获补合同 §2 的 250ms 总预算（超预算 budget_exhausted 省略）、core 编排记录边界（cancelled 不记省略、抛错轮落无原因 omitted）、Host getPersonaApplication 改 existing-only 观察者、external respondSessionRuntimePreferences 回包统一经能力门剥键。
  - 测试（文档同步时复跑核实）：shared 契约＋services 能力门合并 70 项、core `tests/persona/` 60、bootstrap `tests/persona/` 54、adapters `tests/persona/` 37、UI drora-persona 24，全部通过；实现轮回归 bootstrap `drora-protocol`＋`protocol-runtime-shutdown` 124 项、`droraAgentService` 41 项通过。
- [ ] 切片 D（§3-D·P0b 效果、发行与回退）：E2E、真实模型效果、正式 worker 打包/资源验证、跨平台发行与回退准入。
- [ ] P1a 显式交流默认与逻辑忘记/导出。
- [ ] P1b 有限自动学习、来源复验、预算/fencing。
- [ ] P2 当前态呈现及原桌宠/语音回归。

整个清单只通过同一个分支/PR 更新，不能为后续切片另开功能 PR。首批测试前重建了过期的本地 contracts dist，使当前源码的 ToolSearch 常量可用；没有改相关业务源码。本批验证前重建了 core dist 以解除 bootstrap 对过期 d.ts 的误报（team 域错误消失）；根 typecheck 仍在 relay-v2-server 的模块解析及相关类型处失败（`@drora/shared/web-remote-relay`/`@drora/client`/`@drora/rpc` 等 TS2307 家族），bootstrap 单独 typecheck 另有 3 个同家族 stale-dist 错误（NodeSkillAdapterOptions/NodeCustomCommandAdapterOptions 的 additionalDirectories、ProviderEndpointRoutingFactoryOptions 的 readDroraJwt），均与本切片无关，未记为通过。根 lint 0 errors、395 warnings 与交接基线一致；`pnpm fmt:check` 在干净基线同样失败（全树 10484 文件、内容级 diff 为 0，Windows CRLF 环境性），本切片文件已按内容级格式核对并修正 2 个测试文件。root lint 原先忽略整个 CLI，本次仅将新人格模块/测试和最小接缝纳回检查，不重新 lint 其他还原目录。
