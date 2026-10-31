# 自研特性保护、接线与验收矩阵

状态：保护合同已整理；**以下升级后验收尚未执行**。当前 main C=`66c9193fd`，F=`1a0081c23`（已是 C 祖先且同树）；历史对照 C0=`8ee406fc9`。主方案见 [迁移 spec](../../../specs/upstream-v3.17.1-migration.md)，任务状态见 [tasks.md](tasks.md)。

本表的“存在”依据当前源码和 spec，不代表功能所有阶段均已交付。Persona、VaultView 和部分 E2E 的原有未完成项继续保留。其他分支尚未进 C/F 的实现不是本轮可以宣称已交付的能力。

## 1. 四类保护与逐文件兜底

| 类别 | 处理方式 | 判定要求 |
| --- | --- | --- |
| A 独立扩展 | 默认逐字保留，变更必须单独说明 | 上游同名新增也不能覆盖；迁移需要等价证明与引用清理 |
| B 共享触点 | 三方合并后逐接线复核 | 入口、注册、能力位、权限、调用顺序、销毁/恢复与数据归属都要保留 |
| C 有意删除/分歧 | 继续保持当前决策 | 不恢复 force-update/皮肤等已删能力；查 divergence ledger 的最新条目 |
| D 冻结还原/发行资产 | 不作机械覆盖 | 按版本、producer、原版 hash、bundle 偏移取证与验证 |

机器兜底为 [local-preservation.tsv](local-preservation.tsv) 的全部 C/F 相对 T(B) 差异，以及 [feature-branch-delta.tsv](feature-branch-delta.tsv) 的全部历史 C0→F 差异。清单也含文档、测试、生成物和第三方资产，不等于每行一项功能。未归入下述特性或工程资产的行先标 needs-owner-review，不可跳过；分类完成是 P1/S7 门禁。

模块清单不能只按 `owner: drora` 收集：知识库、独立 Relay 与 CLI persona 各层的 owner 名称不同；根配置、共享协议、主进程装配和服务入口也不是独立目录。最终按文件差异、模块策略、已合入提交与 spec 交叉核对。

## 2. 必须保留的能力与共享触点

路径均为仓库相对路径；花括号仅为阅读缩写，不是可直接执行的命令。

| ID / 能力 | 状态所有者及独立实现 | B 类高危接线与上游交集 | 不得回退的行为 / spec |
| --- | --- | --- | --- |
| PF01 品牌与外部契约 | rename spec、Drora 图标与 D 形空态水印 | 新增路径/import/env、OAuth、marketplace、共享 contracts、全部平台包名 | 内部 Drora 命名一致；官方 CDN、OAuth scheme、appId、wire header、manifest/seed 保豁免；`specs/drora-rename.md` |
| PF02 Agents Team runtime | CLI core team 与 bootstrap `app/drora-team/`，团队事实及 journal；UI `src/team/` 消费 v4 投影 | create-app、runtime/tools 注册表、server-operations、v4 command/apply/projection、session-flow/hydration、WorkspaceShellLayout | team 工具/技能门同源；父子会话与权限继承；历史、导航、手机摘要保持；`specs/agents-team.md` |
| PF03 Team 分阶段审批 | runtime 的 plan/approval；UI `TeamStagedEditor`、`TeamConversationSummary` | 审批命令、修改计划回填、TeamSidePane、会话行/侧栏、取消/重启/历史恢复 | 未批准不执行；修订回到原对话；重复/迟到审批不重放；手机走既有 v4 路径，不虚构 MobileTeamPanel |
| PF04 Knowledge 检索与证据 | services `knowledge/`，索引/lease/fencing/receipt 单一 owner | services/node、drora-extensions/knowledgeHost、CLI vaultSearchPort、知识工具、设置入口 | 原文为事实源；receipt 绑定 session/run/epoch/hash；跨 Host 不能串源；索引可重建；`specs/obsidian-knowledge.md` |
| PF05 Obsidian 与 VaultView | services `obsidian-vault/`、Vault 配置/焦点；UI VaultView | ProjectSidebarNavigation 的 onOpenVault/vaultActive、WorkspaceShellLayout 主视图路由、WorkspaceMainView、插件/hook | 保留唯一 VaultView 入口、原文定位/引用；不新增重复 Knowledge 顶级导航；写入/撤销现有 NO-GO 继续 fail-closed，不为升级解锁 |
| PF06 Jev 与本地 embedding | 现有 Jev adapter/localEmbeddingPort、评测与模型配置 | provider/node 装配、knowledgeEvidence、可选模型解析、worker/native 资源 | Jev 可选且默认关闭的既有决策不变；无凭据/模型不可用如实降级，不伪造检索质量证据 |
| PF07 桌宠与创建技能 | Desktop `drora-extensions/desktopPet*`、main/desktopPet*、preload、renderer pet；shared/contracts/desktopPet | Main 启动/窗口/事件销毁、settings、UI 投影发布、tsconfig.pet、native library、打包资源 | 开关/角色/尺寸/位置、导入和坏包隔离、v1/v2 animation、Codex 包格式、创建技能、Sharp 闭包、单浮窗；`specs/desktop-pet*.md` |
| PF08 语音 | ui `voice/`、store/voiceSessionStore、hooks/port；guarded actions 与 claim 唯一写入 | ConversationComposer、ChatPromptEditor、SessionPane、设置导航、Main 麦克风策略、生命周期卸载 | 录音 episode、partial 不入正文、busy 输入/打断、ASR/TTS 双引擎、音色/角色、播报 owner 隔离、取消和跨 pane 不误停；`specs/voice-agent-integration.md` |
| PF09 人格与个人化（F） | core/persona、adapters/storage/persona、bootstrap/app/drora-persona、ui/drora-persona | create-app/runtime/session-facade、protocol control/capability、AppSettings/schema、SettingsPage、Pet 表达映射、worker 打包 | E/U/L、每轮冻结、CAS/幂等/逻辑忘记/只读导出、有界学习和 lease；管理不创建会话，不传播远端；上游 AGENTS.md 编辑器不是替代；`specs/drora-persona-system.md` |
| PF10 自建 Relay V2 服务 | `packages/relay-v2-server/`，只持鉴权/配对/转发/必要 token 元数据 | shared relay schema、新 mobile push、web 远控、Docker/静态托管/同源 WS、npm/构建入口 | 保留当前可部署服务与安全/背压/停机语义；无业务队列/快照；官方未开源服务端不能靠客户端更新冒充全对齐；`specs/relay-v2-server.md` |
| PF11 官方/自建 Relay 切换（F） | AppSettings.webRemoteControlRelayOrigin 与 shared endpoint resolver | Main getEndpointUrls、validation 两侧、WebRemoteControlDialog/RelaySourceSection、web drora-extensions/remoteEndpoint | env > 设置 > 默认 endpoint；只影响远控三 URL；切换先停止再按新源重启；同源 ws2；不是 10-22 历史已删除能力；divergence ledger 9 |
| PF12 更新与发行 | desktop drora-extensions/updateFeed、GitHub feed、现有 CI/release/签名配置 | autoUpdater、builder、package、Node/CLI/SEA 构建、脚本资源清单 | Drora 渠道/签名、产品版本、CLI 0.0.1、bootstrap 闭包先构建等最近修复保持；不恢复官方强更门；`specs/update-feed-github.md` |
| PF13 写入安全与审批 | 已有 write-tier policy、权限流程、trusted receipt 与既有 NO-GO | tool executor permission-flow、hook rewrite、runtime tool table、Team 子工具、Knowledge apply/undo | 单一门控出处；未经许可/过期批准/串会话凭证拒绝；不因官方执行器更新绕开现有门；`specs/agent-write-safety.md` |
| PF14 项目/分组/任务组织与远程身份 | CLI 会话事实；Host 项目/分组/置顶/已读；远端项目归远端 app 库 | project-storage 0007–0009、task-facts、task-groups、sessions-index、sidebar/navigation、remote entries | 分组不变项目/cwd；NULL 归属合法；snapshot 缺席不删除；离线移入口不删远端；时间来自 CLI；migration checksum 不改；session-management 不变量 |
| PF15 Provider 与自定义配置 | 现有 registry/config/snapshot/provisioning owners | provider-node、模型选择/刷新、data-sync、Personalization、设置 scope、OAuth | 自定义 provider 和 bundled persistence、模型选择与认证隔离保留；源设备/作用域显式；同步不覆盖 persona/private 凭据；`specs/provider-bundled-persistence.md` |
| PF16 Web/部署/CLI 分发 | 现有 web/mobile-web/server-cli/website 构建与 drora-extensions | official 新 source-server 构建、site 插件、远端资产、native search、SEA/runtime Node | 手机复用同一 Host/runtime；保留 Drora server 启动/部署和资源闭包；原版 mobile snapshots 按 D 类保护；不恢复旧手机独立 Agent |
| PF17 已移除能力与治理 | force-update/skin 移除 spec、architecture owner/例外、受控快照 | 根 scripts、pre-push、lint/formatter、技能与 AGENTS、上游 test retirement | 不恢复已删除模块；不把还原区改成整目录 lint 静默；不清掉自研测试与当前 spec 约束；divergence ledger 1–9 |

## 3. 保真验收场景（升级前后按同一断言执行）

所有行当前状态：**planned**。对应原功能的未验证部分列为 baseline-gap；发现升级前已失败时不能假称由上游导致，也不能将该门勾选为 pass。执行记录须写 setup、action、assertions、runner/平台、commit、产物与结果。

| 场景 ID | 覆盖 / 操作与明确断言 | 已存在的测试种子（需确认注册与执行） | 执行段 |
| --- | --- | --- | --- |
| RG01 | 浅/深主题打开首页与设置、登录回调；D 水印/图标正确，官方回调与 appId 不改名，新增功能文案中英完整 | rename spec；services/test/oauthDesktopCallbackContract.test.ts；desktop/test/desktopDeepLinkUrl.test.ts | S1/S4/S5 |
| RG02 | Team 开关关闭时技能/工具都缺席；开启建团队、分派、成员历史、桌面/手机下钻与回到父对话 | core/tests/team/；bootstrap/app/drora-team/install.ts；ui/team CONTRACT | S2/S5 |
| RG03 | 提案→未批不执行→修订→批准→执行→halt；重复批准/取消后迟到批准无副作用，冷历史展示一致 | ui/test/teamConversationSummaryStagedApproval.test.tsx；desktop/test/e2e/conversation-session/manual-review/pending/conversation-session-agents-team-staged-approval.test.ts | S2/S5 |
| RG04 | Vault 侧栏入口→笔记/问库→可信引用→原文；跨会话/epoch receipt 拒绝，文件更新使旧证据失效 | services/test/knowledgeReceiptIsolation.test.ts；knowledgeEvidence.test.ts；desktop/test/e2e/obsidian-knowledge-positive.test.ts | S3/S5 |
| RG05 | 审核提案/读取账本正常；apply/undo 在现有 NO-GO 下拒绝，旧批准和变更文件不能写 | services/test/knowledgeReviewFreshApproval.test.ts；knowledgeReviewWritePath.test.ts；WRITE_SAFETY_NO_GO.md | S2/S3 |
| RG06 | Jev 关闭/无凭据/连接失败、本地 embedding 失败与热切换；既有回退、lease/fencing 不回退 | services/test/knowledgeJevAssembly.test.ts；knowledgeJevHotReload.test.ts；knowledgeLocalEmbedding.test.ts；knowledgeLeaseFencing.test.ts | S3 |
| RG07 | 开启/关闭桌宠、导入 v1/v2、坏包隔离、切换/缩放/拖动/重启恢复、生成宠物入口；同一时刻单浮窗 | desktop/test/desktopPetLibrary.test.ts；desktopPetConfiguration.test.ts；desktopPetCreationSkill.test.ts；package test:pet-parity/test:pet-production（先读脚本与环境要求） | S4/S5/S6 |
| RG08 | 系统/remote ASR 能力选择、开始/partial/final/停止；partial 不进正文；多句 final 不提前结束 episode | ui/src/voice/useVoiceDictation.test.ts；V4ComposerVoiceEntry.test.tsx；desktop/test/e2e/voice-composer-entry.test.ts | S4/S5 |
| RG09 | 跨 pane 与多窗口播报/录音争抢、owner 卸载、取消、用户打断、工具简报和 busy 输入；非 owner 不停止其他人的播报 | ui/src/voice/useVoiceAnnouncement.wiring.test.ts；voiceAnnouncementClaim.test.ts；turnSpeechPlanner.interrupt.test.ts；store/voiceSessionStore.test.ts | S2/S4/S5 |
| RG10 | 人格未初始化只读不开库/不建会话；E off 零捕获 IO；E on 每轮冻结，重试/工具子调用不重新取值 | core/tests/persona/；bootstrap/tests/persona/persona-app-service.test.ts；policy-closure-pm35.test.ts | S1/S2/S3 |
| RG11 | 资料 CAS 冲突保草稿；逻辑忘记/幂等重试、U 关闭级联关 L、worker 取消/预算/销毁，运行事实与保存状态分开 | adapters/tests/persona/；bootstrap/tests/persona/；UI persona 模块测试。人格真实 GUI/E2E 与跨平台原缺口仍需补证 | S2/S3/S5 |
| RG12 | 桌宠表达只消费人格已应用事实；运行切换、失效与默认映射正确，不依据未生效草稿变化 | desktop/test/desktopPetPersonaExpression.test.ts；ui/test/desktopPetProjection.test.ts | S4/S5 |
| RG13 | 官方/自建来源切换、注册/配对、断线重连/ACK、半开与背压；新推送能力不可用时如实报告，既有远控可用 | desktop/test/webRemoteControlManagerV2.test.ts；webRemoteControlSharedHostAttachments.test.ts；relay-v2-server/test/；源码检查新增能力协商 | S1/S3/S4/S5 |
| RG14 | 三 URL/env 优先级、切换期间停止/重启、手机同源 ws2；不改变全局其他业务 endpoint | webRemoteControlEndpointUrls.test.ts；shared endpoint/validation 与 F 的 fa1a27129 变更。GUI/真实部署按 Relay spec 补证 | S1/S4/S5 |
| RG15 | 本地+SSH/WSL 同路径不同 identity、多 Host owner/lease 转移、stale run、桌面 continuous 与手机 replayable 重连 | 现有 conversation/remote E2E catalog；desktop/test/webRemoteControlSharedHostAttachments.test.ts；services/test/workspaceIdentityOffPeakMigration.test.ts | S2/S3/S4/S5 |
| RG16 | 旧 tasks-index 升级、0007 顺序只首次播种、0008 已删入口缓存、0009 重复 create 幂等；分组/NULL 归属/CLI 时间保留 | project-storage/schema.baseline.sql；session-management checklist；现有迁移 fixture 和 schema contract，按上游新语义补回归 | S1/S3 |
| RG17 | ensureReady 并发/stop/restart/故障清理与冷历史；Team/Persona cancel，未释放不能建替代实例，未接纳输入不能假装已接受 | 上游 CLI lifecycle 测试、现有 queue/reconnect fixture；S2 先登记对应 catalog 行与精确测试路径 | S2/S4 |
| RG18 | 设备数据同步不删远端独有项；同名覆写按 hash 检查；本地/远端设置 scope 正确，persona 不被推送 | 上游 data-sync/settings-scope 合同；CLI/远端消费者测试；需设备 E2E（上游新增） | S3/S5 |
| RG19 | 完整视图/普通面板切换、查找/预览/返回会话；Team/Vault/语音保活，同一 SessionPane，桌面窗口按钮与手机禁入正确 | 上游 ui-shell/side-pane-full-view.test.ts、conversation-session-side-pane-full-view.test.ts（导入后才可用）；现有 Team/Vault/voice 种子 | S4/S5 |
| RG20 | 自定义 Provider 保存/刷新、OAuth pending 回调恢复、远端 provisioning 失败重试；模型选择不跨身份，用户指令与 persona 分离 | 当前 Provider/OAuth E2E 矩阵、provider-bundled-persistence spec；实际运行文件从当前 runner 发现 | S2/S3/S5 |
| RG21 | 干净依赖环境构建 bootstrap 闭包，再 typecheck/bundle/SEA；GitHub feed、Windows 安装重入、远端资源与宠物 Sharp 能加载 | 8ee406fc9/4557f766c/fb2e42de7 的构建修复；desktop/test/desktopPetSharpPackaging.test.ts；installer 脚本与发布配置 | S4/S6/S7 |
| RG22 | CUA/插件 seed 原版 hash、批准/拒绝、helper 身份、文档 wire 字面量、平台能力按既有实现保持 | packages/zcode-cua 当前 test 入口；原版 bundle/producer 证据；未取到 v3.17.1 对照资产时该项不通过 | S6 |
| RG23 | 上游退役的测试/夹具分类；自研与修改回归仍可被新配置发现/执行，skip/零项不能冒充 pass；矩阵无失效路径 | 根现有 Vitest/Node/affected 与 CLI/CUA 独立入口；官方 engineering 清单与 retired evidence 审计脚本 | P1/S6/S7 |
| RG24 | force-update/skin/旧远控壳不复活；新功能不扩大权限；架构 owner/公开入口/无循环，命名差分全部分类 | 移除 spec、divergence ledger、architecture-policy、check-bundle-key-parity | S1/S6/S7 |

此处为既有 spec 与上游行为的迁移验收合同，不构成现行自动化覆盖声明。实施时将 RG ID 映射到正式 catalog/matrix 的稳定 case ID；新用例先 pending，获得所需人工复核后再按工具转正。

## 4. 必验平台与组合

| 面 | 必验内容 | 明确隔离 |
| --- | --- | --- |
| Windows/macOS/Linux 桌面、本地 | 核心会话、Team、Vault、设置、构建资源；麦克风/语音/桌宠按平台合同 | 不用 Windows mock 证明 macOS helper/TCC；不把云引擎缺凭据当已通过 |
| 桌面 SSH/WSL；Docker 远端有环境时 | identity/remoteSessionId、项目组织、scope、队列与恢复、工具/Provider | 本地 persona 管理不出现于远端目标；不另启 Desktop Remote Host |
| 手机 replayable，官方与自建 Relay | 已有 Host attachment、输入、审批、Team 摘要、重连、隔离与新能力提示 | 不创建手机独立 runtime；不显示 persona 桌面管理和 side-pane full view |
| 普通 Web | 既有会话/工具/Provider/响应式；新增 UI 合同及 capability 降级 | 桌面原生能力入口遵守 IPlatformService；不直读 window.drora |

最低高风险交叉：本地/远程 × continuous/replayable × 正常/断连恢复；运行中停止/重启、权限拒绝、迟到响应和身份冲突单列。组合剪枝必须写合同依据，不能为节省执行将必验组合直接划掉。

## 5. 共享触点检查表

每项必须同时查定义、注册/装配、调用者、销毁/重连和实际场景结果：

- Root/App/app-shell/SessionPane：Team focus/provider/side pane、Vault 主视图、Pet publisher、Voice claim；上游完整视图不得复制运行组件。
- SettingsPage/settingsPageConfig/schema/platform：Knowledge/Pet/Voice/Persona 入口、作用域、Settings 单写路径与跨窗口同步防环。
- CLI create-app/runtime deps/protocol facade：Team registry 与技能门、vaultSearchPort、persona capture/control/learning notification、lifecycle 接口与队列准入。
- shared command/apply/snapshot/channels/platform/validation：自研 additive 字段/命令/能力位和严格运行时校验，producer/consumer 同源常量。
- Main/Host/createLocalServices：drora-extensions、Desktop Pet、update feed、Voice permission、Relay endpoint 设置读取、个人化/知识服务与平台 IPC；Main 不吸收 session 业务状态。
- project-sidebar/navigation：Vault 可选槽位、TeamSessionLine、分组/置顶/未读、远端入口离线与删除状态。
- manifest/workspace/lock/exports/build/CI：自研 workspace importer、负向排除的 seed、CLI/Pet worker/native/Sharp 产物、Drora Release 渠道、架构 introduced 记录。

完成时每条 PF 对应的 RG 必须有当前候选证据；任一相关路径从清单消失、入口不再可达或状态 owner 发生变化，均返回对应段修复，不以“文件还在”关闭保真审查。
