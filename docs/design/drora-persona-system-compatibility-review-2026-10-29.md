# Drora 人格第二版：既有功能兼容性审查

- 日期：2026-10-29。
- 基线：`f1619365f2ad9e58e3ae784ddaaf32d9fe29efe9`。
- 对象：[第二版设计](../../specs/drora-persona-system.md)、[候选验收](drora-persona-system-impact-2026-10-28.md)。
- 新约束：用户明确强调功能重要，不能打乱既有功能。
- 结论：暂不放行实施完整方案。第二版仍有 6 项 P1 设计阻塞、2 项 P2 合同缺口。以下是设计风险，不是已经发生的生产故障；没有人格实现可作运行证明。
- 本轮仅增加审查记录，不自动改写设计或将候选验收标为通过。

> 后续修订：用户要求继续设计后，R1–R8 已纳入[第三版设计 §13](../../specs/drora-persona-system.md#13-两轮审查的第三版处置)。当前方案采用主请求专属投影、独立存储、扩展故障降级与 accepted 后学习恢复；旧会话 outbox、逐轮正文和人格恢复拒绝条件已撤回。下文保留第二版被审查时的证据，不应作为当前实现要求。候选验收已更新为 PM01–PM36，均未运行。

> 第四版补充：以[当前 spec](../../specs/drora-persona-system.md)和[资料专项合同](drora-persona-data-contracts-2026-10-29.md)为准。新增只读导出沿独立资料服务与原平台保存端口，不恢复旧库或恢复路径侵入；候选范围扩展到 PM01–PM48，仍无实现/运行证据。

## 1. R1 / P1：扩展故障被放到了主任务的必经路径

**证据与范围：** 设计 §6.1 要求核心预算不足报错，§6.2 要求人格 binding 写失败不发模型请求；§4.1 在进程生命周期创建服务，尚未明确延迟初始化和初始化故障隔离。§7.1 只规定两项记忆开关默认关闭，没有明确 personaEnabled 对已有安装和旧会话的默认值。

**回归机制：** 新数据库损坏、worker 启动失败、扩展迁移失败或额外上下文预算不足，都可能令原本可完成的用户请求失败。即使 UI 关闭人格，若启动时仍强制初始化扩展数据库，也会引入新的启动依赖。

**建议合同：** 首次发布对已有安装默认关闭且显式启用；未启用时不打开人格数据库、不运行迁移或 worker，不注册人格写工具。进程组合层可注册惰性服务句柄，不能把扩展 ready 加入旧启动握手必需条件。人格开关需有独立于损坏数据库的可信禁用路径。

已启用后也要区分“原 Session Store 失败”和“仅人格扩展失败”：原会话故障继续按旧规则处理；扩展捕获/绑定失败应在首请求前取消整份新增贡献、显示明确降级状态并沿原任务路径执行，不能把旧持久化错误一并吞掉。若产品一定要求严格人格快照，则它应是用户选择的严格模式，不能作为兼容默认。成功注入的贡献仍须遵守同轮冻结。

**验收：** 人格关闭＋数据库缺失/损坏/不兼容＋worker 不存在时，启动、普通输入、stop、旧恢复均可用；人格开启时只注入扩展故障，验证主任务可完成、没有丢失 ACK 后的输入、没有绕过原持久化失败。

## 2. R2 / P1：新增上下文会被既有 Project Memory 辅助请求继承

**确认事实：** [project-memory-agent.ts](../../apps/drora-cli/packages/core/src/runtime/helpers/project-memory-agent.ts) 的 captureProjectMemoryAgentContext 复制 `runtime.messageHistory.borrowReadOnlyRuntimeEntries()`，prepareProjectMemoryAgentRequest 再把这些 entries 发给模型。它还读取当前 Runtime 的工具表。第二版 §6.2 让人格贡献进入会被 rebuildContextPrefix 替换的上下文前缀。

**回归机制：** 在此接法下，“不修改旧 Extraction 实现”不等于“旧 Extraction 的输入不变”。它会读到新增核心/个人偏好，并有可能将全局偏好写进项目文件；实际写入由模型决定，尚无实验结果。新域忘记无法约束旧域。这比两域本来就各自记住一句话更强，是新增资料主动流入旧链路。

**建议合同：** 在通用贡献上定义请求用途/受众，只有明确允许的主对话请求消费新增人格。Project Extraction/Dream、title、selector、compact summary 及 child 各自列出准入。优先在构造请求投影时选择贡献，避免把主对话贡献无条件写入所有消费者共用的 canonical history。若仍进入公共历史，必须保留可机器识别的来源标签并在辅助请求投影前过滤，不能按文本内容删除。

[context-history-entries.ts](../../apps/drora-cli/packages/core/src/runtime/methods/context-history-entries.ts) 当前将 systemMessages 映射成仅含 message 的 entry；因此不能假设 system section 的 source 已完整保留到所有消费者。来源保留与缓存前缀顺序是需要验证的新通用接缝。不得关闭旧 Memory 作为绕过方案。

**验收：** 用只存在于新增核心/偏好中的哨兵检查最终 Main/Extraction/其他辅助请求；主请求可见，未授权消费者不可见。旧用户转录本身已有的同一事实不在过滤保证内。不能为了清理人格而删除合法项目记忆或改写历史。

## 3. R3 / P1：学习状态写入会影响任务活动时间

**确认事实：** [session-entries.ts](../../apps/drora-cli/packages/adapters/src/storage/session-store/repositories/session-entries.ts) 在 `input.touchSession !== false` 时调用 touchSession。省略字段就是更新会话活动时间。

**回归机制：** 按第二版 §7.4 保存 awaitingCommit/ready/delivered、恢复补扫和学习状态时，如果沿用默认值，后台学习会改变 time_updated，进而改变任务排序及活动展示。完成之后的后台写入尤其明显。

**建议合同：** 所有人格 binding/学习来源/交付状态 entry 显式 `touchSession:false`，包括补偿、重试和迁移；仅真实既有用户活动路径更新时间。新增条件更新 adapter 同样不得 touch。不得通过 sessions-index、Host syncer 或 UI 再补写时间、未读、状态来“抵消”副作用。

entry ID 为全库唯一：统一命名空间＋authority/session/turn/evidence 身份，不复用裸 turnId；条件更新验证 sessionID 与 type，防止现有 `on conflict(id)` 覆盖另一条会话归属。

**验收：** 完成任务后处理/重试学习，比较会话 time_updated、title、lastOutcome、列表顺序、未读、置顶和分组；除新领域记录外全部不变。两个会话使用相似来源键不能互相覆盖。

## 4. R4 / P1：逐轮核心正文会放大既有冷恢复读取成本

**确认事实：** [cold-event-merge.ts](../../apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/cold-event-merge.ts) 的 loadPersistedConversationMaterialization 调用不带 type 的 sessionEntries；repository 将全部条目读出并解码。第二版 §6.2 要求每轮保存编译后核心正文，P1b 还增加多状态来源条目。

**回归机制：** 不参与 UI 展示的人格快照也会被旧冷恢复路径全量读取。仅核心 4,000 字符×10,000 轮即 4,000 万字符，尚未计 JSON、元数据和多字节编码；这只是容量计算，不是实测延迟。人格库独立 worker 无法消除旧 session 库的这笔读取。

**建议合同：** 不把重复正文按轮嵌入旧 session_entry。优先评估独立扩展存储中的内容寻址编译对象，每轮只保留小引用；需要明确保留、故障降级与版本编译语义，不能又只留下不可恢复的 hash。学习来源元数据须有数量/体积上限与终态保留策略。若必须修改旧读取为类型过滤，列为独立通用优化，证明 goal verifier、shared_context 等消费者仍完整，不能顺手改整条冷恢复路径。

**验收：** 小会话、长会话和重复版本场景测 cold materialization 返回字节数、反序列化、恢复时延、内存峰值；关闭人格与旧数据集保持基线。记录查询结果规模，而非只检查 SQL 有索引。

## 5. R5 / P1：协议“可选字段”不自动兼容旧 Host/手机

**确认事实：** [transport.ts](../../packages/shared/src/drora-protocol-v4/transport.ts) 的 clientHello.capabilities 是 strict schema；现有 workflowRunDeltas 注释要求先看 Host 声明再发送新键，否则旧 Host 会拒绝握手。其它 snapshot/delta 也有严格校验边界。

**回归机制：** 若客户端无条件发送 persona capability，或新 Host 向旧客户端的既有帧加入人格摘要，失败可能发生在连接/帧解析层，不仅是新入口不可用。人格功能未启用的用户也可能受到影响。

**建议合同：** 明确 Host 广告→客户端条件声明→双方协商后使用的顺序。P0 尽量通过独立资料查询返回状态，不往 sessions-index 或公共 conversation delta 加字段。旧端不支持时不发送未知字段/操作，原会话流仍按旧形状发送。CLI 控制协议与 Host↔客户端协商分别验证，不能用一侧 capability 替代另一侧。

**验收：** 新 UI/旧 Host、新 Host/旧手机、新 Host/旧 CLI、全部新端；桌面 continuous 与手机 replayable 各自验证连接、发送输入、stop 和 gap repair。不能以“新入口隐藏了”作为链路兼容证明。

## 6. R6 / P1：为了人格持久性增加恢复限制，可能削弱原能力

**证据与界限：** 第二版 §6.2 规定编译版本不兼容拒绝同一执行恢复，包含个人偏好的执行丢失进程后不自动恢复原轮。[resume.ts](../../apps/drora-cli/packages/core/src/runtime/methods/resume.ts) 当前按 session/messages 恢复分支、权限、compact、goal 等状态，不能从文件名或 cold resume 一词推断它必然支持某一种原轮续跑。

**回归机制：** 尚未逐项确认旧恢复语义，就让“曾使用个人资料”成为新的禁止条件，违反本次用户要求。还可能把手机网络重连、Runtime eviction 后重载与进程崩溃混成同一情形。当前未证明某条已支持续跑实际会被阻断，因此这是设计阻塞，不能报告成现有 bug。

**建议合同：** 先建立现有恢复动作清单：网络重连、驻留实例重接、冷加载历史、compact 中断恢复、fork/edit/retry、goal 后续轮。全部沿既有状态机决定恢复动作；人格编译不兼容只能影响是否重新附加人格，不新增拒绝旧会话的条件。已经发给模型的历史无法通过扩展忘记撤回；取消敏感资料与严格恢复之间的选择不能靠改旧状态机偷偷解决。

**验收：** 相同旧 fixture，在从未启用/已启用/禁用后/扩展库丢失/版本回退五种状态重复既有恢复场景，比较目标状态、工具处理、待输入处理、分支和最终消息。原本支持的操作不能因人格元数据缺失而变不可用。

## 7. R7 / P2：资格判定还没有覆盖所有实际执行入口

**确认事实：** [session-store.port.ts](../../apps/drora-cli/packages/contracts/src/interfaces/session-store.port.ts) 的 taskType 包括 interactive、fork、selection_side_chat、workflow_parent 以及多类 child；[turn.ts](../../apps/drora-cli/packages/core/src/runtime/methods/turn.ts) 普通 executeTurnCommand 还包含 off-peak 准备与 compact/rewind 命令解析。“进入普通 turn 函数”不等于“用户正在和主 Drora 交流”。

**建议合同：** 在可信启动/执行来源定义显式 eligibility 表，区分普通用户输入、guide、队列执行、selection side chat、workflow parent、headless、automation/off-peak、slash 命令和内部辅助调用。未知来源默认不贡献、不学习。人格捕获放在现有模型/outputStyle admission 冻结之后，不能增加 await 到这些旧冻结之前；不能为 slash 命令新增 persona IO。

P1 新写工具必须在工具目录、执行端口两侧按 eligibility 限制，避免 child 或旧 Extraction 通过共享 registry 看见/调用个人写入口。不得提升权限模式、向 sandbox 添加个人库文件访问权限，或借名字隐藏代替执行校验。

**验收：** 对上述入口逐项检查请求贡献、工具目录、写入和后台任务数量；无需所有工具的笛卡尔积。专用身份与自动化输出格式按原 fixture 保持。

## 8. R8 / P2：“关闭无影响”需要两个不同的合同

**缺口：** 当前 PM01 只写 Persona off，没有区分从未启用与曾经启用。人格曾参与生成的回复或 compact 摘要可能已成为合法会话历史，关闭后不能要求所有历史字节恢复成从未启用，也不能为了达成该断言删除历史。

**建议合同：**

- 从未启用：同输入下，新版本与基线的最终 provider 请求、工具目录、旧库变更、生命周期事件和连接形状保持等价；仅允许规范化 requestId/时间等非确定字段。
- 曾启用后关闭：后续不新增贡献、不访问个人正文、不安排学习，不删除或重写旧聊天，不改变原恢复路径；冻结的在飞轮按已经公开的生效边界完成。
- 撤回功能发布：禁止新启用和新增学习；保留用户数据，旧版能读取其原有表/协议。不能通过回滚删除迁移表或恢复整库备份来撤回功能。

**验收：** 分别验证这三条；升级→启用→关闭→旧版读写→再升级，确认历史、任务组织态和真实活动时间保持。

## 9. 不扰动既有功能的发布门槛

| 功能域           | 必须保留的事实                         | 重点验证入口                                      |
| ---------------- | -------------------------------------- | ------------------------------------------------- |
| 主对话与输入队列 | 原 admission/ACK、串行、取消与模型冻结 | turn、CommandInbox、busy guide/queue              |
| Session 管理     | title/status/time/未读/分组归属        | session entry、Host task index、sessions-index    |
| Memory           | 旧 gate/root/Extraction 默认与原来源   | 主请求、辅助抽取、warm/cold、身份隔离             |
| 模型/输出风格    | 原选择/临时覆盖/恢复、任务格式         | outputStyle、off-peak、headless                   |
| 子代理与工作流   | 原专用身份与权限                       | child、workflow parent/actor、selection side chat |
| 恢复与历史       | 原 branch/goal/compact/fork 行为       | 网络重连、冷加载、重试、rewind                    |
| 多端协议         | 原连接和帧可解析                       | 新旧端交叉、continuous/replayable                 |
| 性能与发行       | 未启用不新增启动依赖；长历史读取有界   | worker 故障、正式打包、冷恢复                     |

首个落地范围建议只包含显式启用的稳定身份，以及通过测试证明隔离的请求投影。个人资料写工具、自动学习、逐轮来源账本、远端人格同步不与此一起发布。P0 也必须先解决 R1/R2/R4/R5/R6，不能因为“只有身份”省掉共享链路验证。

测试采用冻结基线差分：对同一隔离数据集执行旧行为 fixture 和新版本关闭态，比较最终请求、旧数据表内容、可观察事件及协议；开启态只允许列出的新增贡献差异，不接受重录全部 fixture 来掩盖回归。不更换默认模型、旧 prompt、Memory 分支、任务生命周期或测试阈值来让人格评测通过。

## 10. 本轮证据和限制

- freshness 通过；源码仍为上述基线，未修改实现。
- 本次新确认的实质路径：Extraction 复制全部公共历史、saveSessionEntry 默认 touch、cold materialization 读取全部 entry、clientHello strict 协商边界。
- title-generation-sidecar 使用独立标题 prompt，未发现它直接继承人格公共历史；不能把所有辅助模型请求都报告为已经污染。它仍应列入关闭态回归。
- session-fork 当前显式组装复制条目，未发现自动复制所有新 entry；风险在将来接入，不报告已有跨 fork 泄漏。
- 未执行人格原型、故障实验、旧版互操作或 E2E；静态审查不能证明零回归。测试入口存在也不等于已通过。
- 原方案和 PM01–PM28 保留供对照；本轮建议尚未并入为第三版设计。
