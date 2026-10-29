# Drora 人格系统 Impact Brief 与候选验收

日期：2026-10-28；修订：2026-10-29，第四版。对应[当前设计](../../specs/drora-persona-system.md)、[资料专项合同](drora-persona-data-contracts-2026-10-29.md)、[可行性审查](drora-persona-system-feasibility-review-2026-10-28.md)和[兼容性审查](drora-persona-system-compatibility-review-2026-10-29.md)。保留第三版兼容边界，新增归因、scope、冲突、只读导出与跨回合验收。本文件只描述拟议变更，不标为已经实施或覆盖。

## Feature Summary

| Field            | Value                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Developer intent | 单一持续身份与有限成长；不扰动既有功能；本轮只设计                                                               |
| Capability       | persona，邻接 Settings、主请求投影、Project Memory、恢复、多端协议                                               |
| Change layer     | presentation、draft-default、validation、commit-effect、persistence、recovery                                    |
| Operating mode   | planning；实施接缝和用例尚待验证                                                                                 |
| Primary seeds    | turn-loop/turn-model-step、runtime-provider-request-messages、Settings/runtime preferences、project-memory-agent |
| Out of scope     | 改旧 Memory、旧库 migration/逐轮人格 entry、重写恢复、公共帧加人格字段、主共享工具表加个人写工具                 |

## UI Surface Matrix

| User scenario    | Entry/component                        | Draft/default                         | Commit/gate                                  | Authority                             | Mode/isolation                                      |
| ---------------- | -------------------------------------- | ------------------------------------- | -------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| 允许使用新人格   | Settings 独立选项，经现有 hook/service | 新旧安装均 false                      | 现有 Settings owner；协议协商后传许可        | App Settings；Runtime 新建/cold 冻结  | warm 不变；不重启会话                               |
| 编辑 Drora       | 新独立设置组件，复用 SettingsPageParts | 局部草稿；内置模板或已存 revision     | updatePersona CAS；不要求模型/聊天           | CLI Persona 服务/独立库               | 打开设置可惰性开 worker，不创建 AgentRuntime        |
| 查看本轮是否应用 | 对话更多菜单/设置状态查询              | 当前进程内存状态，非永久历史          | 独立查询；能力缺失显示不可用                 | owner Runtime 的当前贡献              | 不往 sessions-index/snapshot/delta 加字段           |
| 显式个人偏好     | P1a 设置页                             | 有限键、条目草稿                      | 保存与有效读取分开；CAS/范围说明             | Persona 库                            | 不新增模型写工具，不改旧 Memory catalog             |
| 自动学习管理     | P1b 资料策略页                         | 默认 off；显示抑制键/有限预算         | policyEpoch/key generation                   | Persona 库                            | 不等于开启执行许可或旧 Memory                       |
| 归因/冲突查看    | P1b 偏好详情                           | 来源类别、最多一个待确认候选          | 原文 owner 权限/分支复验；设置保存或忘记解决 | Persona 库；来源仍由原消息 owner 拥有 | 不创建新消息或未读，不覆盖 pinned                   |
| 只读资料导出     | P1a 本地设置页                         | 一次性内存 payload、快照时间/省略数量 | 独立 export 能力＋IPlatformService.saveFile  | Persona 服务生成，平台保存字节        | 无模型/聊天；不修改资料或旧库；P2 前不开放手机/远端 |
| 现有 Memory 设置 | MemorySettingsSection/IMemoryService   | 原默认 false                          | 原新建/cold gate、原查看权限                 | 原 Settings/CLI Project Memory        | 手机边界不变                                        |
| 桌宠/语音/经历   | 桌宠保持原设置；其他后续设计           | 原外观/真实任务状态                   | 无 P0/P1 新表达提交                          | 原 owner                              | 换外观不换身份；未实现入口不显示                    |

## Shared And Divergent Behavior

| Concern  | Shared                                        | Deliberately different                               |
| -------- | --------------------------------------------- | ---------------------------------------------------- |
| 资料身份 | 同 authority 一个 personaId                   | 入口执行许可不同，使用同根不自动 opt-in              |
| 执行开关 | 复用 Settings→runtime preference 装配形态     | 人格正文不写 Settings；CLI 不重复保存 enabled        |
| 请求组装 | 原 ToolSearch/角色映射/媒体预算/cache-control | 仅主请求接受独立 contribution；辅助请求无参数        |
| 运行状态 | 原 admission/stop/fork/resume                 | 人格失败只省略扩展，不能吞原会话/provider 错误       |
| 持久化   | 原库继续原业务写入                            | 新资料/已接收学习工作在独立库；旧库不新增 entry      |
| 多端     | 同 Host 同执行结果                            | 新资料查询双层协商；旧公共帧不变                     |
| 忘记     | 新域值清除与键抑制                            | 真实历史和项目记忆不被新域删除                       |
| 归因     | 原文/角色/origin 来自可信 owner               | 摘要和模型分类不具备原消息或用户设置的权威           |
| 导出     | 沿用平台 data 保存能力                        | 数据可用不等于 Runtime 可读；资料管理不打开执行 gate |

## Feature Relationships

| Rank           | From         | Relation                             | To                                          | Evidence / implication                                |
| -------------- | ------------ | ------------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
| must-inspect   | 主请求贡献   | projected-by                         | prepareRuntimeProviderRequest               | turn-loop.ts 先准备实际请求，再渲染记录；两者必须一致 |
| must-inspect   | 主请求贡献   | must-not-enter                       | requestEntries/messageHistory               | turn-model-step.ts continuation 会回写 requestEntries |
| must-inspect   | 贡献使用     | constrained-by                       | trusted execution origin                    | interactive 不等于所有 executeTurnCommand 调用        |
| must-inspect   | 执行许可     | configured-by                        | Settings/runtime preferences                | 新建/cold 生效；旧 strict 端不得收新字段              |
| must-inspect   | 个人值       | must-not-flow-as-raw-contribution-to | Project Extraction / summary / verifier     | project-memory-agent 复制公共历史，必须从源头隔离     |
| must-inspect   | 个人库故障   | must-not-block                       | 原输入/恢复                                 | 只捕获扩展异常，取消和原故障仍传播                    |
| should-inspect | 当前应用状态 | queried-by                           | 独立资料服务                                | 不增加 task index 或公共帧字段                        |
| conditional    | 学习机会     | received-by                          | Persona 独立工作表                          | accepted 前可漏学，之后幂等恢复                       |
| must-inspect   | 个人候选     | attributed-by                        | 原消息 owner / trusted origin               | role=user 不足以证明人类自述；证据不足跳过            |
| must-inspect   | 资料导出     | captured-by                          | Persona 服务/独立库                         | cutoff 前撤销排除；跨库只读核验，非原子承诺           |
| should-inspect | 导出文件     | saved-by                             | IPlatformService.saveFile / desktopSaveFile | 既有 bytes 保存路径；取消/失败/页面关闭如实处理       |
| invariant-only | 新资料域     | must-remain-isolated-from            | VaultSearch / OffPeak / 桌宠                | 不把检索、任务执行或表现状态当人格资料 owner          |
| invariant-only | 后台资料写入 | must-not-mutate                      | session time/title/status/unread            | 不调用默认 touchSession writer                        |
| invariant-only | 插件关闭     | preserves                            | 原工具目录/权限/请求/存储                   | 关闭态差分，不批量重录旧 fixture                      |
| evidence-only  | 已有测试     | demonstrates-baseline                | context/Memory/fork/resume suites           | 测试存在不证明新增行为已通过                          |

## State Owners And Commit Sinks

| State                             | Owner                          | Commit/sink                         | Non-owner role                        |
| --------------------------------- | ------------------------------ | ----------------------------------- | ------------------------------------- |
| 允许执行人格                      | 原 App Settings / CLI 可信入口 | Settings 持久开关；Runtime 冻结消费 | 人格 DB 无 enabled 副本               |
| 人格核心/偏好/策略                | CLI PersonaAppService          | PersonaRepository worker/CAS        | Host 代理；UI 草稿                    |
| 本轮 applied/omitted              | Runtime turn state             | 内存冻结，主请求投影消费            | 新查询展示；不永久会话绑定            |
| canonical entries/工具执行/原恢复 | 原 Runtime                     | 原 Session Store/原模型路径         | 人格不接管                            |
| 学习机会通知                      | 原成功轮观察点                 | 有界非阻塞通知                      | 允许未接收丢失，不影响任务成功        |
| 已 accepted 学习工作              | Persona 域                     | 独立库幂等键/预算/fencing           | 源 owner 只读复验                     |
| 角色/origin/原始证据              | 原消息 owner / 可信输入入口    | 原持久记录，只读核验                | 模型不能自报权威；无法证明跳过        |
| 语义候选/冲突                     | Persona 服务                   | 独立库每键有界候选与 revision       | UI 选择，模型不决定 pinned            |
| 导出 payload                      | Persona 服务                   | 内存冻结快照，无业务持久化          | UI 持有一次性结果，Main 不读取人格 DB |
| 导出文件                          | 用户选定路径的文件             | 原平台 saveFile                     | 不属于 live 配置，不跟随 forget 回收  |
| task 组织态与活动                 | 原 Host / CLI 分工             | 原 task index/事实镜像              | 无人格写入路径                        |

## Must-Preserve Invariants

1. 原 model/outputStyle admission 在新增异步捕获之前冻结；已接受输入、guide/queue、stop 仍属 CommandInbox/Runtime。
2. 新原始贡献不进入 canonical messageHistory/requestEntries；实际主请求与记录的角色、内容、source mapping 一致。
3. 人格关闭且未访问设置时，无新库/worker/迁移依赖；扩展故障不使旧任务、握手或恢复失败。
4. session/task 旧库无新 schema 或人格 entry；后台学习不更新活动时间、状态、未读、分组、标题。
5. workspaceIdentity?.trim() || workspacePath 用于来源隔离；workspacePath 仍用于 cwd/文件，不随项目组织变化重绑人格。
6. Project Memory、Output Style、权限、工具目录、Dream 默认与自动化执行规则保持。
7. 新字段只有相应链路双方支持才发送；不把一侧能力当作另一侧能力。
8. 旧历史保持；缺人格资料不阻止原恢复；关闭不是回滚已产生的真实聊天。
9. 自动推测不变成 explicit；临时/项目范围不提升全局；单独确认词和摘要不能提供长期授权。
10. 导出不写资料/任务库、不调用模型、不跨域取资料；cutoff、来源核验时点与用户保存时点明确区分。
11. 同核心/编译器/输入的贡献确定；不随机人格片段，不通过情绪或亲密度改变工具权限。

## Codegraph Evidence

本会话无 codegraph 索引工具；以下为源码定向读取替代，不声称完成 codegraph depth-2。

| Seed                                         | Confirmed path                                                           | Interpretation                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| turn-loop.ts                                 | requestEntries → prepare → recordableProjection → runModelBackedTurnStep | 贡献作为独立参数，重复渲染同值                    |
| turn-model-step.ts                           | output continuation 将 options.requestEntries 写回 turnRequestState      | 注入副本绝不能放入该参数                          |
| runtime-provider-request-messages.ts         | ToolSearch exposure → provider role/cache projection                     | 保留唯一请求准备链；不另造 provider body          |
| project-memory-agent.ts                      | 复制 messageHistory → 辅助请求                                           | 不改 helper 也可能因公共历史污染而回归            |
| context-refresh.ts                           | 重建公共前缀                                                             | 第三版不修改它来保存人格                          |
| session-entries.ts                           | 默认 touchSession；无类型条件可全量读取                                  | P0/P1 放弃新 entry 设计                           |
| cold-event-merge.ts                          | 全量 entries → goal/shared_context 取值                                  | 独立存储避免旧冷路径读取扩展正文                  |
| transport.ts                                 | clientHello.capabilities strict                                          | 先广告后声明，不无条件发新键                      |
| resume.ts / session-fork.ts                  | 旧历史/分支恢复与显式 fork bundle                                        | 不新增人格恢复拒绝，不复制学习工作                |
| packages/shared/src/platform.ts              | SaveFileRequest data 分支 / IPlatformService.saveFile                    | 已有文件保存接口；不需要在 Persona 服务写目标文件 |
| packages/desktop/src/main/desktopSaveFile.ts | dialog.showSaveDialog → writeFile → success/canceled/error               | 对话框期间 payload 已冻结；不能宣称原子写文件     |
| contracts/src/tools/vault-search.ts          | 已授权 vault 的 query/limit 检索合同                                     | 不具备个人归因/撤销字段，不作为 Persona 仓储      |

## Graph Drift Candidates

| Candidate                                     | Evidence                                                  | Follow-up                                                    |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| 人格尚无实现节点                              | 仅设计，尚无端口/实现                                     | 已登记设计入口和文档证据；服务/UI 接缝待冻结，不伪造当前能力 |
| 公共请求消费者关系不足                        | Extraction、compact、goal verifier 共用投影/历史          | 登记用途语义，避免只搜索 ContextBuilder                      |
| Output Style UI→普通 Runtime 热更新未完全核验 | 两端能力分别存在                                          | 不把它直接当作人格热更新提交链                               |
| 外部笔记称 TaskRealtimeBus→PetStateAggregator | 当前 desktopPetProjection/Publication 来自 sessions-index | 继续现有投影，不按外部笔记重建 owner                         |

## Graph Delta

| Status           | Proposed relationship                                                          | Reason                                                 |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| confirmed-design | capability.persona → specified-by → evidence.persona-design                    | 仅设计导航，codeSeeds 为空，未登记实现 owner/服务/界面 |
| proposed         | capability.persona → configured-by → Settings                                  | 执行 opt-in 与核心资料两个 owner                       |
| proposed         | persona contribution → projected-by → main request                             | 与公共 ContextBuilder 分离                             |
| proposed         | persona contribution → must-not-enter → canonical history / auxiliary requests | 消除原始资料流入旧抽取器                               |
| proposed         | persona store → must-not-block → session lifecycle                             | 默认关闭、扩展故障隔离                                 |
| proposed         | learning accepted → persisted-by → independent repository                      | 不建设旧 session outbox                                |
| proposed         | personal candidate → attributed-by → trusted message source                    | 归因缺证据就跳过，不改旧存储补字段                     |
| proposed         | persona export → saved-by → platform saveFile                                  | 复用字节保存，独立数据 owner 不承担文件对话框          |

用户已确认产品方向和兼容优先级；功能图仅写入明确标记“未实现”的设计入口与文档证据关系。其余拟议技术关系仍留在本文，未把未验证接缝当作现有节点。当前无 codegraph 工具，新设计节点无代码 seed；图检查仅验证 ID/边/文档路径，不能声称已运行 depth-2。

本轮图差分检查：新增 2 个设计/证据节点、1 条关系，文档路径有效，原节点和边未改变。全图基线已有 4 条悬空关系，涉及缺失的 persistence.desktop-user-data-root 与 capability.mcp-oauth-authorization；本轮未引入新悬空关系，也未修复这些无关问题。因此结论是新增关系检查通过，不是全图无缺陷。

## Unresolved Questions / Clarification Log

| ID  | Status              | Current handling                                                |
| --- | ------------------- | --------------------------------------------------------------- |
| Q1  | confirmed           | 长期数字伙伴，兼顾工作/日常                                     |
| Q2  | confirmed           | 有限成长，核心身份价值观稳定                                    |
| Q3  | confirmed           | 一个 Drora，场景调整表达                                        |
| Q4  | P2 open             | 远端传输范围未定前不传正文；原远端任务正常                      |
| Q5  | 第三/四版基线       | 个人忘记/聊天/项目记忆独立；导出副本不被应用删除                |
| C1  | 用户明确约束        | 不扰动现有功能；原执行/恢复优先，新增扩展可省略                 |
| T1  | 技术验证            | 新投影的 source mapping、缓存、记录与 continuation              |
| T2  | 技术验证            | 双层协议发现、Settings 装配、worker 正式打包                    |
| T3  | 第四版设计/技术验证 | 角色/origin 证据来自 owner；缺乏可信来源则跳过，无旧库新增字段  |
| T4  | 第四版设计/技术验证 | 导出独立格式与 cutoff；P1a 本地，原平台保存结果，不保证原子落盘 |
| T5  | 第四版初始实验合同  | 归因/范围负例与学习率分母、跨回合指标；阈值须在实验前冻结       |

## Planning Handoff

| Item                    | Destination                                | Status                                      |
| ----------------------- | ------------------------------------------ | ------------------------------------------- |
| Spec                    | specs/drora-persona-system.md              | 第四版；未实现                              |
| Data contracts          | drora-persona-data-contracts-2026-10-29.md | 归因/scope/冲突/导出/评测已定义，待实现验证 |
| Cases                   | 本文 PM01–PM48                             | planned/missing；沿用 ID 的断言以本版为准   |
| Main catalog / coverage | 既有 conversation 流程                     | 未改写、未标覆盖                            |
| Implementation order    | spec §14 A–F                               | 每片独立契约与差分验收                      |
| Source acceptance       | P1b                                        | 接收前允许漏学，接收后可靠；不承诺每轮必学  |

## Domain Scope / Dimensions

主要域：原任务执行与请求投影、独立资料管理、学习撤销、多端/发行兼容。

| Dimension | Values                                                                      |
| --------- | --------------------------------------------------------------------------- |
| 许可      | 从未启用、显式启用、新建/cold、warm、关闭后                                 |
| 捕获      | applied、omitted、cancelled；超预算、慢库、worker 故障                      |
| 请求用途  | 主请求、continuation、记录、Extraction、summary、verifier、title、child     |
| 源        | 提交有效、回退、软删除、未接收机会、accepted 工作                           |
| 形态      | 本地主、fork、guide/queue、side chat、workflow、自动化、未知                |
| 版本      | 新旧 UI/Host/CLI，关闭后降级再升级                                          |
| 数据量    | 短/长会话、重复核心版本、有界工作队列                                       |
| UI        | Desktop、手机，主题/语言/窄屏代表场景                                       |
| 归因      | 人类自述、助手建议、第三人、引用、假设、裸确认、重述确认、内部 user         |
| 范围      | 全局默认、项目限定、当轮临时、歧义、跨 identity 重复                        |
| 冲突      | 无值、同值、不同 inferred、pinned、disputed、抑制                           |
| 导出      | 未初始化、gate off、准备/冻结/保存、取消、写盘失败、revision 竞态、来源失效 |

## Candidate Combinations / Cases

所有用例 status=undefined（待实施验收合同冻结），evidence=planned，E2E=missing。未运行；不会因新增设计而自动 accepted。

| ID   | Setup / State                                               | Event                             | Assertions / Evidence                                                                      |
| ---- | ----------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| PM01 | 从未启用                                                    | 普通请求                          | 无新库/worker/贡献/工具；与基线 request/旧库/事件等价                                      |
| PM02 | Persona on、Memory off                                      | 主请求                            | 有核心，无偏好读取/学习；最终 body＋IO                                                     |
| PM03 | 当前轮核心 N                                                | 保存 N+1                          | 当前轮继续 N，下一合格轮 N+1；body＋内存 snapshot                                          |
| PM04 | busy queue                                                  | 更新核心后执行                    | 捕获执行时版本；原 ACK/commandId/admission 不变                                            |
| PM05 | token continuation/轮内 compact                             | 继续主请求                        | 同一贡献一次；summary 无原始贡献；canonical 无污染                                         |
| PM06 | 两窗口同 revision                                           | 并发编辑                          | CAS 冲突保留草稿；独立库唯一提交                                                           |
| PM07 | P1a 设置页                                                  | 保存/失败/纠正                    | 只有事务成功提示保存；无新增模型写工具                                                     |
| PM08 | 学习在飞                                                    | forget                            | generation/autoSuppressed 拒绝迟到；范围提示准确                                           |
| PM09 | accepted 工作重复/崩溃                                      | 重领                              | evidenceId 最多一次应用；未 accepted 不承诺补齐                                            |
| PM10 | 同路径不同 identity                                         | 源读取/项目 Memory                | 原项目隔离、新源不串域；cwd 仍是路径                                                       |
| PM11 | 同 authority 跨项目                                         | 读取全局偏好                      | 允许的默认可复用，项目事实不提升全局                                                       |
| PM12 | custom/child/workflow                                       | 执行                              | 无默认人格贡献/个人工具；原专属身份保持                                                    |
| PM13 | fork/cold resume                                            | 原恢复和新轮                      | 不复制工作；不新增恢复拒绝；按原许可和新轮规则                                             |
| PM14 | 手机 gap repair                                             | 重连                              | 原帧/owner/runtime；无额外人格帧或新 Agent                                                 |
| PM15 | 旧端/远端能力不足                                           | 资料查询/原任务                   | 不发未知字段/正文；原任务可用、不虚报保存                                                  |
| PM16 | persona worker/DB 故障                                      | 请求/恢复                         | 扩展 omitted 原任务继续；原 session/provider 故障仍报错                                    |
| PM17 | 自动推测/显式纠正                                           | 旧源回退                          | pinned 优先；失效推测不注入；来源不可伪造                                                  |
| PM18 | 多任务＋换桌宠外观                                          | 真实投影                          | 原状态优先；无新 task 字段或独立人格                                                       |
| PM19 | 无聊天/模型配置                                             | 编辑设置、关聊天                  | 无 session/Runtime/model 请求；服务独立                                                    |
| PM20 | 公共上下文重建                                              | 模型刷新/下一轮                   | 公共前缀原样；主请求叠加唯一；preview 不写执行                                             |
| PM21 | capture/可选审计失败或首请求前重启                          | 原执行继续                        | 不因人格失败阻断；无旧库 binding 必需条件；用故障注入证明                                  |
| PM22 | 曾使用偏好后 forget                                         | 杀进程/原恢复                     | 原恢复能力保持；缺旧贡献时省略；新轮服从撤销                                               |
| PM23 | 两域偏好冲突                                                | 纠正/忘记/warm/cold               | 来源范围准确；不宣称全域清理；body＋真实模型                                               |
| PM24 | 通知前/接收前/accepted 后故障                               | 重启                              | 前两者可漏学但任务成功；accepted 后恢复、重复幂等                                          |
| PM25 | 源复验与写入交错                                            | rewind/delete 后 capture          | 捕获时复验；失效/未知源省略；原旧库无写回调                                                |
| PM26 | pinned/忘记键                                               | 旧源改写、重新允许                | 不覆盖、不复活；旧 epoch/generation 不能重标为新                                           |
| PM27 | cwd/project config/多进程                                   | 读写资料                          | 可信根不漂移；同根一个身份；锁等待不阻塞主任务                                             |
| PM28 | warm gate off/预算耗尽                                      | 改开关/学习                       | 生效边界准确；无机会不调模型；预算有限                                                     |
| PM29 | 曾启用后关闭                                                | 原历史继续/新会话                 | 不改写历史；许可边界后无新贡献；旧功能保持                                                 |
| PM30 | 主请求包含私有哨兵                                          | Extraction/summary/verifier/title | 原始贡献不进入辅助请求；不删正常转录中的内容                                               |
| PM31 | 完成任务后处理学习                                          | 重试/纠正/清理                    | old time/title/status/未读/排序/分组不变；旧表差分                                         |
| PM32 | 长会话/重复核心版本                                         | cold materialization              | 旧 entries 数量/正文不增加；原冷读取量保持                                                 |
| PM33 | 新旧 UI/Host/CLI/手机交叉                                   | 握手/发送/stop/重连               | 两层协商；旧端无未知键；两种 delivery 各验                                                 |
| PM34 | guide/queue/slash/side chat/off-peak/goal 自动续轮          | 执行入口遍历                      | 显式资格表；旧模型冻结前无新增 await；未知拒绝                                             |
| PM35 | 升级→启用→关闭→旧版→再升级                                  | 旧数据读写                        | 原库/历史/组织态可用；不恢复整库/不复活删除                                                |
| PM36 | provider 重渲染/ToolSearch/媒体/token 恢复                  | 最终发请求和记录                  | 内容一致、sourceEntries/真实用户索引正确、目录权限不变、canonical 无贡献                   |
| PM37 | 助手建议或自动化/内部 role=user 消息                        | 触发候选抽取                      | 可信 owner 提供 role/origin；不得写当前用户偏好；DB＋输入来源证据                          |
| PM38 | 用户引用他人、假设/否定；仅有摘要                           | 抽取用户偏好                      | 引用/假设/不明否定不写入；摘要不能替代原文；引用偏移/校验不符拒绝                          |
| PM39 | 当前任务、项目约定、跨 identity 重复                        | 尝试提升全局默认                  | 个人域不写；原任务仍执行原指令；不新增项目个人库或 Project Memory 写路径                   |
| PM40 | 助手建议＋裸“好”/重述具体值和全局范围                       | 自动学习、随后设置保存            | 裸确认不持久化；合格重述仅 inferred；只有设置事务产生 explicit/pinned                      |
| PM41 | 两个不同 inferred 或 pinned＋不同候选                       | 抽取、下一轮、设置解决、forget    | inferred 冲突暂停该键；pinned 不变；候选有界且复验；忘记清理/抑制；旧任务无未读变化        |
| PM42 | 有核心、显式偏好、已忘记值/旧版本                           | 生成 JSON 导出                    | 版本/当前字段/来源类别完整；排除旧正文/凭据配置/聊天；≤256 KiB；原资料 revision/旧表无写入 |
| PM43 | 导出读快照期间修改、cutoff 前后 forget                      | 生成和保存                        | 变化至多重读一次；持续冲突不给 payload；cutoff 前排除、之后不伪称可撤回副本                |
| PM44 | P1b 自动项来源被删/不可用与有效显式项共存                   | 导出                              | 无效推测省略，原因计数准确；显式项保留；不伪称跨库原子；不从摘要补来源                     |
| PM45 | 准备/保存中取消、磁盘失败、关闭页/切 authority、双窗口      | 操作导出                          | 无自动重试/新聊天；旧结果不落新页；仅 success 显示保存；冻结后平台可能继续，未承诺原子文件 |
| PM46 | 无会话/无模型、Memory/Persona off、无资料、旧能力/手机/远端 | 打开导出入口                      | 本地已存资料可管理但不改 gate；无资料不建默认身份；缺能力/非支持域不绕行上传或传正文       |
| PM47 | 同一核心/编译器/输入；工作/日常/Output Style                | 重复编译和继续主请求              | 相同输入内容/hash 一致；场景表达不换身份；无随机采样/新分类模型；格式与权限原规则          |
| PM48 | 专项合同的固定跨回合序列与同配置基线                        | 执行纠正/忘记/范围/跨模型实验     | 分模型报告分母、误记/任务/干扰/成本；按事先阈值判断；实际模型证据独立于 E2E fixture        |

P0a/b 优先 PM01–06、PM12–16、PM19–21、PM27、PM29–36 的核心链路；P1a 增加 PM07/10–11/17/22–23/28；P1b 增加 PM08–09/24–26/31 的学习路径。PM14/15/33 的旧端兼容是 P0 门槛，新人格管理能力属于 P2。PM18 是既有功能不回归。效果实验另按 spec §10，不能当作确定性 E2E。

第四版补充：P0b 加 PM47；P1a 加 PM42–43/45–46；P1b 加 PM37–41/44/48，并重跑导出与撤销相关用例。PM48 属真实模型实验，不能因测试使用 scripted provider 就标为通过。具体 schema、源 origin 证明路径和 fixture 在对应阶段实施前冻结；本轮无需重复确认 Q1–Q3。

## Pruning Decisions

| ID   | Pruned combination             | Reason                                           | Representative |
| ---- | ------------------------------ | ------------------------------------------------ | -------------- |
| PR01 | 所有 child×个人关系资料        | 首版无资格/工具入口                              | PM12/34        |
| PR02 | 每工具步骤×编辑人格            | 同轮冻结，不枚举全工具                           | PM03/05/36     |
| PR03 | 全主题×所有 DB 故障            | UI/backend 分层，各选代表                        | PM06/16/19     |
| PR04 | 所有远端×完整画像同步          | 当前不提供                                       | PM15/33        |
| PR05 | Memory off×自动学习            | gate 禁止                                        | PM02/28        |
| PR06 | 每轮必学×全历史补扫            | 本版允许未接收机会丢失；不侵入旧提交             | PM09/24        |
| PR07 | 人格丢失×拒绝旧会话恢复        | 本版撤回该行为                                   | PM13/21/22     |
| PR08 | 任务/项目临时偏好×全局自动晋升 | P1 只保存明确全局默认，重复出现不授权            | PM39           |
| PR09 | 手机/远端×P1 导出              | 本版只有本地管理；不能凭 saveFile 存在跨域取资料 | PM46           |
| PR10 | 文件导入×自动恢复授权/已忘记值 | 首版只读导出，尚无导入路径                       | PM42/43        |
| PR11 | 随机人格片段/持久情绪×工具权限 | 核心编译确定，未引入情绪系统                     | PM47           |

剪枝是当前设计范围，不代表用例已经执行；正式 E2E admission 按既有流程办理。

## Matrix Backfill / E2E Handoff Notes

- 未改主 catalog/coverage；功能图只增加设计检索入口和证据，不把未验证接缝登记成当前能力。
- 使用隔离资料根、原 session 数据 fixture；加入旧表内容/活动时间、canonical entries 不变性、各用途 provider 哨兵。
- 时序使用受控 worker/barrier/AbortSignal；超时只测试可选等待预算，不作为同步正确性证明。
- 新主请求接入必须测试 recordableProjection 的第二次渲染，以及 turn-model-step 对 requestEntries 的回写路径。
- 混合版本必须用实际旧 schema/旧端验证；不能用新 schema 缺字段替代旧端接收新字段的测试。
- 归因使用原始消息 role/origin 与 quote 校验 fixture，含内部 user 反例；不能只断言抽取 prompt 含禁止词。
- 导出使用受控 barrier 验证 cutoff 前后和 revision 重读，取消/失败分别检查真实平台结果；不要求旧保存端口提供未实现的原子性。
- 双窗口导出独立 snapshot；关闭页/切 authority 验证旧结果不污染新页；不通过删用户文件模拟撤销导出。
- Desktop continuous 和手机 replayable 各走真实链路；worker 检查覆盖正式发行包。
- 实施按根 typecheck/lint、架构与目标 CLI 定向测试检查；未获要求不跑全量测试。
- 本轮只有设计；所有用例仍无实现/运行证据。历史 typecheck/lint 结果不作为本版功能通过证据。
