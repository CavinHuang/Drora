# Drora Persona v5 Impact Brief 与验收矩阵

日期：2026-10-29；planning，未实现。依据[唯一主 spec](../../specs/drora-persona-system.md)、[合同](drora-persona-data-contracts-2026-10-29.md)、[实施计划](../superpowers/plans/2026-10-29-drora-persona-p0.md)。保留 PM01–PM48 ID，断言已按 v5 语义修订；新增 PM49–PM58。旧版相反断言不再适用。

## Feature Summary

| Field            | Value                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Developer intent | 按综合评审完整设计；单一持续身份、有限成长，保护现有能力                                                              |
| Capability       | persona，关联请求投影、Settings、Memory、诊断、恢复、多端、桌宠                                                       |
| Change layer     | presentation、draft-default、validation、commit-effect、persistence、recovery                                         |
| Operating mode   | planning；本轮只改文档和设计图谱                                                                                      |
| Primary seeds    | turn-loop/turn-model-step、runtime-provider-request-messages、project-memory-agent、runner-debug、runtime preferences |
| Out of scope     | 业务实现、旧 session migration、恢复重写、Dream 自动调度、跨域画像同步、复杂主动气泡                                  |

## Clarification Log / Boundary Decisions

| 来源                           | 已固定边界                                             | v5 处理                         |
| ------------------------------ | ------------------------------------------------------ | ------------------------------- |
| 用户 Q1–Q3                     | 长期数字伙伴、有限成长、一个身份                       | 保留，不重复询问                |
| 用户要求按综合评审完成设计     | 采用评审推荐方向形成可实施合同                         | 单一服务/库、受控编辑、请求贡献 |
| 设计取舍，非另一次逐项用户答复 | 不支持外部 Markdown 双向同步；不承诺 OS 任意工具硬隔离 | 首版剪枝；未来需求变化另修 spec |
| S1/S2                          | 旧 M 与新 U/L 分离、字段唯一                           | PM49/50/52                      |
| R3/S3                          | 诊断如实，直接隔离与间接读取分开；忘记为逻辑撤销       | PM30/51/56                      |

accepted 表示本版已选择的设计规则，不代表用户逐条验收或代码覆盖。所有实现状态 missing、执行证据 none；P2 当前态呈现按阶段独立实施。

## UI Surface Matrix

| 场景/入口     | 共享组件与草稿               | 默认/继承                | 校验/提交                   | 权威/持久化                      | 模式/隔离                      |
| ------------- | ---------------------------- | ------------------------ | --------------------------- | -------------------------------- | ------------------------------ |
| 开启身份      | 原 Settings＋独立行          | E 默认off                | 原设置提交＋可信偏好协商    | Settings；Runtime 新建/cold 冻结 | warm不变，手机共用owner        |
| 编辑/恢复核心 | 独立设置组件，经hook/service | 产品模板或保存revision   | 五字段校验、CAS、mutationId | Persona独立库                    | 不创建聊天/模型，不改E/U/L/M   |
| 预览          | 局部草稿                     | 当前模板                 | 纯编译                      | 无持久化                         | 不是模型效果保证               |
| 查看应用      | 对话菜单/设置查询            | 无可证执行显示不可用     | session/turn/authority关联  | Runtime内存                      | 不增加旧帧字段                 |
| 交流默认      | 同一字段可多入口             | 未设置回落基线，U默认off | 唯一字段API/CAS             | Persona偏好记录                  | 不依赖M，不覆盖项目要求        |
| 停学/忘记     | 策略与条目设置               | L默认off                 | epoch/generation/fence屏障  | Persona事务                      | 已开始轮不回写，旧历史不删     |
| 来源/冲突     | P1b详情                      | 模型推测不是用户设置     | 原owner权限/分支复验        | 原消息owner＋新域引用            | 不复制聊天、不更新未读         |
| 导出          | P1a本地设置                  | 当前有效资料             | 快照复核＋平台saveFile      | Persona生成/平台保存             | 无模型、无导入、非本地不开放   |
| 旧Memory      | 原MemorySettingsSection      | 原M语义                  | 原接口                      | 原owner                          | 不暗改开关/根/写入             |
| 桌宠/语音     | 原模块；P2当前态可选         | 原状态                   | 原导航/音频控制             | 原owner                          | 不推导缺失业务事件、不反写人格 |

## Shared And Divergent Behavior

共用原请求投影和管理基础组件，不共享业务写权限。核心表达基线与交流默认是不同字段，设置入口共享同一默认记录。E 是 Runtime 启动许可，U/L 是资料策略，M 属旧项目 Memory。诊断记录与新学习输入是不同用途；全局默认与项目自由文本分别由各自 owner 管理。

## Feature Relationships

| Rank           | From → To                                              | 原因/条件                                 |
| -------------- | ------------------------------------------------------ | ----------------------------------------- |
| must-inspect   | Persona → Settings/runtime preferences                 | 生命周期和旧端严格schema                  |
| must-inspect   | contribution → projection/recordable/ToolSearch/budget | 同值、来源映射、canonical不可回写         |
| must-inspect   | Persona → model-io                                     | 真实记录含贡献；不能错误宣传全域隔离/遗忘 |
| should-inspect | Persona ↔ Project Memory                               | 不双写、不联动开关；直接输入无原始贡献    |
| conditional    | model-io → Dream                                       | 既有handler可读，无自动调度；未来接线另审 |
| must-inspect   | Persona → 源消息owner                                  | P1b只读有效分支，无法证明则跳过           |
| invariant-only | Persona → 语音/团队/远控/恢复                          | 不改变现有owner/lease/CommandInbox        |
| conditional    | 桌宠当前态 → 呈现                                      | P2独立验证，复杂触发已剪枝                |
| evidence-only  | 原测试/架构检查                                        | 不能当新人格已覆盖                        |

## State Owners And Commit Sinks / Must-Preserve Invariants

| 事实                   | owner / sink           | 不变量                                           |
| ---------------------- | ---------------------- | ------------------------------------------------ |
| E                      | 原Settings→Runtime冻结 | 不在Persona库重复保存同义enabled                 |
| Core/Preference/Policy | Persona服务/独立库     | 单一字段、短事务CAS，不请求模型于事务内          |
| contribution           | 原Runtime存活轮        | 同轮固定、不回写canonical、不阻止原恢复          |
| source                 | 原Session Store        | identity/分支/role/origin来自owner，不从模型自报 |
| accepted work          | Persona独立库          | 旧完成路径不等待，accepted前可漏、之后幂等恢复   |
| 显示/导出              | UI局部/平台文件动作    | 草稿不是事实、success后才提示保存、旧结果不跨域  |

旧权限、工具目录、任务活动时间、队列和两种delivery语义均保持。新故障不能吞原错误；U/L关闭不能被旧工作绕过；关闭态不读库/起worker。

## Codegraph Evidence

本会话无codegraph工具，精确源码读取代替；未声称完成图调用分析。深度以1–2跳为主，诊断→Dream条件链额外检查。

| Seed                                  | 已核对调用/数据路径                               | 结论                            |
| ------------------------------------- | ------------------------------------------------- | ------------------------------- |
| context-history-entries               | context init/refresh→history→Memory snapshot      | 不采用公共section               |
| runtime-provider-request-messages     | turn-loop→recordable→turn-model-step continuation | 独立contribution且entries不变   |
| runner-debug                          | generate/stream→model-io→Dream transcriptRoot     | 保留真实记录，限制隔离承诺      |
| server-operations runtime preferences | materialization→Runtime config                    | E与旧M同入口但各自许可          |
| project-memory-extraction             | 原M/remote/headless/source guards                 | 新U不要求旧M开启                |
| desktopPetProjection                  | task摘要→bounded行→Main呈现                       | 不能推断连续失败/耗时           |
| session-store.port                    | MessageSemantics/ProjectionAnchor                 | synthetic与真实来源不是同一维度 |

## Graph Drift Candidates / Graph Delta

图谱只登记设计能力，不宣称已有Persona owner/UI。保留能力ID，更新v5证据，增加Settings、Project Memory与model-io关系及计划中的管理入口/状态owner。codeSeeds仅引用实际已有接缝。已有悬空目标 desktop-user-data-root、mcp-oauth-authorization 与本功能无关，单独报告，不顺手修复。

## Domain Scope / Dimensions / High-Risk Cross-Products

主要域：执行投影、资料并发、学习撤销、多端发行。维度采用等价类，不做全笛卡尔积：

| 维度 | 值                                            | 高风险组合                           |
| ---- | --------------------------------------------- | ------------------------------------ |
| 许可 | E/U/L/M、warm/new/cold                        | 显式默认×M off；L off×在飞提交       |
| 资料 | 未初始化/有效/损坏/未知schema/冲突            | capture×迁移慢；保存响应丢失         |
| 执行 | 主轮/queue/guide/compact/续跑/fork/child/未知 | 编辑×续跑；取消×迟到结果             |
| 来源 | 有效/软删/分支失效/内部user/引用/假设         | accepted×rewind；synthetic×real_user |
| 并发 | 多窗口/多进程/租约过期                        | same source×重复领取；预算×崩溃      |
| 交付 | Desktop continuous/手机replayable/旧端/远端   | reconnect×能力缺失                   |
| 导出 | cutoff前后/取消/写失败/authority切换          | forget×已冻结payload                 |
| 观测 | canonical/请求/诊断/新学习                    | 原始哨兵的来源区分                   |

## Candidate Combinations / Accepted Cases

以下58项均为accepted设计规则；evidence=none、test=missing。表中的Setup、Action、Assertions是后续fixture合同，不能仅用prompt含词断言替代行为证据。

| ID   | Setup / State                                          | Action                         | Assertions / Evidence                                                                             |
| ---- | ------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| PM01 | 从未启用                                               | 普通请求                       | 无新库/worker/贡献/工具；与基线 request/旧库/事件等价                                             |
| PM02 | E on、U off、M 任意                                    | 主请求                         | 只有核心，无新域偏好/学习；旧 M 沿原行为；provider＋策略 IO                                       |
| PM03 | 当前轮核心 N                                           | 保存 N+1                       | 当前轮继续 N，下一合格轮 N+1；body＋内存 snapshot                                                 |
| PM04 | busy queue                                             | 更新核心后执行                 | 捕获执行时版本；原 ACK/commandId/admission 不变                                                   |
| PM05 | token continuation/轮内 compact                        | 继续主请求                     | 同一贡献一次；summary 无原始贡献；canonical 无污染                                                |
| PM06 | 两窗口同 revision                                      | 并发编辑                       | CAS 冲突保留草稿；独立库唯一提交                                                                  |
| PM07 | P1a 设置页                                             | 保存/失败/纠正                 | 只有事务成功提示保存；无新增模型写工具                                                            |
| PM08 | 学习在飞                                               | forget                         | generation/autoSuppressed 拒绝迟到；范围提示准确                                                  |
| PM09 | accepted 工作重复/崩溃                                 | 重领                           | evidenceId 最多一次应用；未 accepted 不承诺补齐                                                   |
| PM10 | 同路径不同 identity                                    | 源读取/项目 Memory             | 原项目隔离、新源不串域；cwd 仍是路径                                                              |
| PM11 | 同 authority 跨项目                                    | 读取全局偏好                   | 允许的默认可复用，项目事实不提升全局                                                              |
| PM12 | custom/child/workflow                                  | 执行                           | 无默认人格贡献/个人工具；原专属身份保持                                                           |
| PM13 | fork/cold resume                                       | 原恢复和新轮                   | 不复制工作；不新增恢复拒绝；按原许可和新轮规则                                                    |
| PM14 | 手机 gap repair                                        | 重连                           | 原帧/owner/runtime；无额外人格帧或新 Agent                                                        |
| PM15 | 旧端/远端能力不足                                      | 资料查询/原任务                | 不发未知字段/正文；原任务可用、不虚报保存                                                         |
| PM16 | persona worker/DB 故障                                 | 请求/恢复                      | 扩展 omitted 原任务继续；原 session/provider 故障仍报错                                           |
| PM17 | 自动推测/显式纠正                                      | 旧源回退                       | pinned 优先；失效推测不注入；来源不可伪造                                                         |
| PM18 | 多任务＋换桌宠外观                                     | 真实投影                       | 原状态优先；无新 task 字段或独立人格                                                              |
| PM19 | 无聊天/模型配置                                        | 编辑设置、关聊天               | 无 session/Runtime/model 请求；服务独立                                                           |
| PM20 | 公共上下文重建                                         | 模型刷新/下一轮                | 公共前缀原样；主请求叠加唯一；preview 不写执行                                                    |
| PM21 | capture/新扩展可选审计失败、首请求前中断               | 原执行继续                     | 扩展失败可省略；原 session/event/provider 错误不能吞；取消不重启                                  |
| PM22 | 曾使用偏好后 forget                                    | 杀进程/原恢复                  | 原恢复能力保持；缺旧贡献时省略；新轮服从撤销                                                      |
| PM23 | 两域偏好冲突                                           | 纠正/忘记/warm/cold            | 来源范围准确；不宣称全域清理；body＋真实模型                                                      |
| PM24 | 通知前/接收前/accepted 后故障                          | 重启                           | 前两者可漏学但任务成功；accepted 后恢复、重复幂等                                                 |
| PM25 | 源复验与写入交错                                       | rewind/delete 后 capture       | 捕获时复验；失效/未知源省略；原旧库无写回调                                                       |
| PM26 | pinned/忘记键                                          | 旧源改写、重新允许             | 不覆盖、不复活；旧 epoch/generation 不能重标为新                                                  |
| PM27 | cwd/project config/多进程                              | 读写资料                       | 可信根不漂移；同根一个身份；锁等待不阻塞主任务                                                    |
| PM28 | warm E off；或 U/L off/预算耗尽                        | 改设置/尝试学习                | E 仅新建/cold；U/L 屏障即时控制新捕获/提交；不自动修改 M                                          |
| PM29 | 曾启用后关闭                                           | 原历史继续/新会话              | 不改写历史；许可边界后无新贡献；旧功能保持                                                        |
| PM30 | 主贡献有独特哨兵且未写入真实对话                       | 辅助直接请求装配               | Extraction/summary/verifier/title 的直接输入无新增贡献；不把合法工具读取或真实回复混作直接注入    |
| PM31 | 完成任务后处理学习                                     | 重试/纠正/清理                 | old time/title/status/未读/排序/分组不变；旧表差分                                                |
| PM32 | 长会话/重复核心版本                                    | cold materialization           | 无新 persona session entry；canonical 正文不增加；原记录/诊断允许实际贡献，不误称全系统零新增字节 |
| PM33 | 新旧 UI/Host/CLI/手机交叉                              | 握手/发送/stop/重连            | 两层协商；旧端无未知键；两种 delivery 各验                                                        |
| PM34 | guide/queue/slash/side chat/off-peak/goal 自动续轮     | 执行入口遍历                   | 显式资格表；旧模型冻结前无新增 await；未知拒绝                                                    |
| PM35 | 升级→启用→关闭→旧版→再升级                             | 旧数据读写                     | 原库/历史/组织态可用；不恢复整库/不复活删除                                                       |
| PM36 | provider 重渲染/ToolSearch/媒体/token 恢复             | 最终发请求和记录               | 内容一致、sourceEntries/真实用户索引正确、目录权限不变、canonical 无贡献                          |
| PM37 | 助手建议或自动化/内部 role=user 消息                   | 触发候选抽取                   | 可信 owner 提供 role/origin；不得写当前用户偏好；DB＋输入来源证据                                 |
| PM38 | 用户引用他人、假设/否定；仅有摘要                      | 抽取用户偏好                   | 引用/假设/不明否定不写入；摘要不能替代原文；引用偏移/校验不符拒绝                                 |
| PM39 | 当前任务、项目约定、跨 identity 重复                   | 尝试提升全局默认               | 个人域不写；原任务仍执行原指令；不新增项目个人库或 Project Memory 写路径                          |
| PM40 | 助手建议＋裸“好”/重述具体值和全局范围                  | 自动学习、随后设置保存         | 裸确认不持久化；合格重述仅 inferred；只有设置事务产生 explicit/pinned                             |
| PM41 | 两个不同 inferred 或 pinned＋不同候选                  | 抽取、下一轮、设置解决、forget | inferred 冲突暂停该键；pinned 不变；候选有界且复验；忘记清理/抑制；旧任务无未读变化               |
| PM42 | 有核心、显式偏好、已忘记值/旧版本                      | 生成 JSON 导出                 | 版本/当前字段/来源类别完整；排除旧正文/凭据配置/聊天；≤256 KiB；原资料 revision/旧表无写入        |
| PM43 | 导出读快照期间修改、cutoff 前后 forget                 | 生成和保存                     | 变化至多重读一次；持续冲突不给 payload；cutoff 前排除、之后不伪称可撤回副本                       |
| PM44 | P1b 自动项来源被删/不可用与有效显式项共存              | 导出                           | 无效推测省略，原因计数准确；显式项保留；不伪称跨库原子；不从摘要补来源                            |
| PM45 | 准备/保存中取消、磁盘失败、关闭页/切 authority、双窗口 | 操作导出                       | 无自动重试/新聊天；旧结果不落新页；仅 success 显示保存；冻结后平台可能继续，未承诺原子文件        |
| PM46 | 无会话/无模型，E/M/U/L off、无资料、旧端/手机/远端     | 管理导出                       | 已有本地资料可导出不改 gate；无资料不初始化；非支持端不绕行传正文                                 |
| PM47 | 同一核心/编译器/输入；工作/日常/Output Style           | 重复编译和继续主请求           | 相同输入内容/hash 一致；场景表达不换身份；无随机采样/新分类模型；格式与权限原规则                 |
| PM48 | 专项合同的固定跨回合序列与同配置基线                   | 执行纠正/忘记/范围/跨模型实验  | 分模型报告分母、误记/任务/干扰/成本；按事先阈值判断；实际模型证据独立于 E2E fixture               |
| PM49 | M off、E/U on、显式默认已存                            | 开始新轮                       | 偏好有效，旧 M 保持 off、不触发项目抽取；请求＋原 Memory 调用计数                                 |
| PM50 | 两设置入口/两窗口编辑称呼                              | 同 revision 保存不同值         | 单一字段、一个成功一个 conflict；保留失败草稿，无隐藏第二值                                       |
| PM51 | generate/stream 开启人格                               | 诊断记录及新学习输入检查       | 诊断按实保留；新学习无文件/日志工具；Dream 无新自动入口；分别证明直接与间接边界                   |
| PM52 | forget/L off/U off 与抽取提交交错                      | 受控 barrier 后恢复            | generation/epoch/fence 拒绝迟到；清候选/负载；U off 同时 L off；新开不复活                        |
| PM53 | 写入已提交但响应超时                                   | 同 mutationId 查询/重试        | 同摘要重放结果，不重复提交；异摘要拒绝；UI 不换 ID 重写                                           |
| PM54 | 两进程同 source/同预算/租约过期                        | 并发接收领取提交               | accepted 幂等、fencing 生效、预算预留不超额；崩溃用量不确定不退款                                 |
| PM55 | 库未初始化、核心损坏、未知 schema                      | 管理/启用/capture              | 明确默认预览与不可用区别；损坏不静默换身份；旧任务正常                                            |
| PM56 | 已忘记值、旧工作、导出副本/原诊断存在                  | 重启/管理/新捕获               | 新域不提供/不复活；文案不承诺介质擦除或删除原记录；不删除用户文件                                 |
| PM57 | 每 OS 冷/热/慢盘至少100次                              | capture＋取消/重启             | 分组报告应用率/p95/省略原因/恢复，按专项阈值判断，不把 omitted 记 applied                         |
| PM58 | P2 桌宠 completedInterrupted / 重复 error / attention  | 更新有界投影                   | 中性结束，不庆祝中断；无连续失败/等待时长推断；原动画导航不变                                     |

## Coverage Matrix / 分期

| 阶段              | 必需用例                                                                         | 实施/执行状态                |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| P0a/P0b           | PM01–06的核心部分、PM12–16、PM19–21、PM27、PM29–36、PM47、PM51、PM53、PM55、PM57 | missing / none               |
| P1a               | PM02/06的偏好部分、PM07/10–11/17/22–23/28、PM42–43/45–46、PM49–50/52/56          | missing / none               |
| P1b               | PM08–09/24–26/31、PM37–41/44/48、PM52/54、重跑偏好/导出/恢复                     | missing / none               |
| 原功能回归/P2呈现 | PM18，P2追加PM58                                                                 | missing / none               |
| 真实模型          | PM47效果部分、PM48、专项合同指标                                                 | 未运行；不能用replay通过替代 |

PM14/15/33 的原端兼容是P0门槛，不等于开放新资料管理。PM36必须包含真实provider映射与recordable二次渲染。技术实验达标前不能省略正式CLI/打包验证。

## Pruning Decisions

| ID   | 剪枝组合                          | guard/产品理由                             | 代表       |
| ---- | --------------------------------- | ------------------------------------------ | ---------- |
| PR01 | child/workflow×默认人格           | 专属身份保留                               | PM12/34    |
| PR02 | 每工具步骤×核心热更新             | 同轮冻结                                   | PM03/05    |
| PR03 | 全主题×所有库故障                 | UI/后端分层，选代表                        | PM06/16/19 |
| PR04 | 远端×桌面完整画像同步             | P0/P1未开放                                | PM15/33    |
| PR05 | U或L off×新域自动学习             | 新域策略拒绝；旧M off不再是该剪枝依据      | PM28/49/52 |
| PR06 | 每轮必学×全历史补扫               | accepted前允许丢机会                       | PM09/24    |
| PR07 | 人格故障×拒绝旧恢复               | 扩展可省略                                 | PM13/21    |
| PR08 | 临时/项目限定×全局晋升            | 来源范围不授权扩大                         | PM39       |
| PR09 | 手机/远端×P1导出                  | 本地管理限定                               | PM46       |
| PR10 | 文件导入×恢复学习授权             | 无导入能力                                 | PM42/56    |
| PR11 | 情绪/随机片段×权限                | 无该决策机制                               | PM47/58    |
| PR12 | 旧Memory任意文件读取×绝对原文隔离 | 保留旧能力，本版只保证直接投影与新学习通道 | PM30/51    |
| PR13 | 桌宠mode重复×连续失败/长任务提醒  | 无可信历史事件，复杂气泡另案               | PM58       |

undefined不属于P0阻断项：自由外编/硬文件沙箱/复杂主动气泡/多用户远端画像均后续另立需求。当前不为其编写测试，也不把剪枝视为能力已验证。

## Matrix Backfill / E2E Handoff / Planning Handoff

主catalog与coverage增加Persona规划入口，指向本58项，全部missing；不伪造测试路径。实施时按既有manual-review/pending→capture→review→replay→promotion流程，使用e2e-case-lifecycle；本轮不生成E2E代码或修改Docker preset。

- Provider fixture：synthetic语料，区分主/辅助/诊断来源；限制工具fixture匹配次数，避免续跑环。
- File-system fixture：隔离Persona/旧Session/原Memory根；测试前后旧表/活动时间/canonical差分。
- Timing：worker barrier、可取消信号、受控时钟和fencing；不靠真实sleep掩盖竞态。
- 多端：Desktop continuous和手机replayable分别走真实链路；旧schema用真实旧端验证。
- 打包：三平台worker资源/路径/关闭进程，不以开发服务器可用替代。
- 重点review：间接读取不误标直接注入；source role不等于语义正确；逻辑forget不等于介质擦除。
- 技术检查：根typecheck/lint、受影响架构/CLI定向测试；用户未要求时不跑全量测试。

| 交付                     | 当前状态                                       |
| ------------------------ | ---------------------------------------------- |
| 主spec/数据合同/实施计划 | v5设计完成                                     |
| PM01–PM58与剪枝          | 合同已定义，未实现/未运行                      |
| 主catalog/coverage       | 规划链接，无覆盖声明                           |
| 功能图                   | 设计关系更新，保留历史漂移报告                 |
| 开工前准入               | 核对HEAD/受控上下文/兼容发现，实验失败先修spec |

## 本轮设计检查记录（2026-10-29）

- freshness 通过：当前分支与 drora upstream 同步；源码基线为主 spec 所列 HEAD。
- pnpm lint：0 errors、395 warnings，未修无关警告。
- pnpm typecheck：退出码 2，relay-v2-server 的 workspace 模块解析与相关类型错误仍存在；没有业务代码改动，不归因于本设计，也不记为通过。
- 设计图 YAML 可解析，413 个节点无重复；本次新增悬空边 0，既有 4 条悬空关系仍存在。相关 6 个实际代码 seed 的文件/符号文本定位通过，不等同 codegraph 语义分析。
- PM01–PM58 共 58 个唯一 ID，连续性检查通过；当前六份主设计/评审文档的 25 个本地文件链接可解析。以上只证明文档结构，不证明行为覆盖。
- 对四份重写设计、两份新增评审及功能图执行定向格式检查；未以此宣称仓库全量格式通过。git diff --check 检查本次差分。
- 未执行全量测试、CLI/E2E、模型实验或发行验证；本轮没有提交、推送或修改业务代码。
