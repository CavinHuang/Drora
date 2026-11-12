# Obsidian Vault 能力插件化剥离 Spec（2026-11-11 立项；**阶段一=中间态**）

> **2026-11-11 用户终裁【阶段二：真抽离】**：推翻本文件「宿主实现保留」模型，裁定
> 完全抽离——VaultView UI 用插件 webview 形态重建 + 知识检索栈做成插件自带宿主服务
> 进程 + 数据全部进插件数据目录 + **本体零 vault 实现**。本文件降级为**中间态**：
> 其 B1-B6 批次已在本工作区落地实码（git 实测 83 文件 +2690 行，该实码即阶段二的
> 改造对象）；§4 平台扩展、§5 安全不变量、§8 能力圈选、§3 三态合成/两层启用位、
> D1a/D6 裁定**保留有效**；§4.1 宿主面板形态（hostPanelId）、§4.2 本体装配条件化、
> §4.4 CLI 注册门与 B3/B4 批次**被取代**（拆除/改造对象），处置表见
> **`specs/obsidian-vault-phase2-true-extraction.md` §7**。归属与物理位置的现行
> 裁决以阶段二文件为准。

来源：用户裁定「把内置 Obsidian Vault 能力剥离为 Drora 官方插件」。本文件与
`specs/obsidian-plugin.md`（插件形态与 hooks 语义）、`specs/obsidian-knowledge.md`
（知识链路行为契约）互链：那两份继续持有各自行为契约，本文件持有**归属、装配、
剥离批次与能力圈选**（阶段二落地前）。冲突时以本文件为准（归属类，阶段二落地后
以其文件为准）/以原 spec 为准（行为语义类）。

设计依据：三份只读调研（内置能力盘点、插件体系承载力、社区 Obsidian AI 能力候选），
关键结论均经本次会话源码抽查复验：`packages/services/src/node.ts:3520-3526`（四服务
无条件注册）、`apps/drora-cli/packages/contracts/src/plugins/index.ts:187-202`
（ui.surfaces 仅 session 级 MCP 资源面板）、`official-plugin-definitions.ts:310-336`
（obsidian v0.2.0 非默认启用）、`packages/ui/src/drora-extensions/WorkspaceMainView.tsx`
（vault 主视图内置注册）。

## 0. 目标与非目标

**目标**：Vault 能力面的**产品归属**从「host 无条件内置」转为「官方插件 obsidian 拥有」
——归属展示、可下线开关、卸载语义与新能力组件归插件名下。**分两阶段**（评审 2 轮
修订，修正原「单一启用位」论证错误——现状是面板/四服务无条件在场（node.ts:3518-3526）
而 hooks 默认不启用且有明文约定「defaultEnabled 仅限内容型插件」，
official-plugin-definitions.ts:308-310）：

- **阶段一（本轮）**：宿主能力（面板/四服务/VaultSearch/新工具）缺省**保持在场**，
  由**独立的宿主能力开关**控制（默认开，不随插件 hooks 启用位，D1a）；hooks 缺省
  维持关闭（现状语义与约定均不变，D1b）——存量用户体验零回退。
- **阶段二（backlog，D1c）**：是否收敛为单一启用位（禁用插件即下线宿主能力），
  待产品裁定后另行声明行为变更。

禁用/卸载语义分层（现状机制实证，`bootstrap/src/plugins.ts:796-802`）：
**禁用（宿主能力开关关闭）= 能力下线 + 数据全保留**；**卸载 = 写 suppressedBuiltins
抑制标记 + 清 enabledPlugins/options + `keepData!==true` 即递归删插件数据目录**——
vault-config.json/vault-focus.json 正在该目录内，且 UI 侧 `IPluginsService.uninstallPlugin`
无 keepData 参数（services/plugins.ts:36-42），「卸载必保留数据」**不是**现状行为，
处理方案三选一见 §6 与决策点 D6。同时按插件体系真实承载力诚实分层，不假装迁移
无法承载的能力。

**非目标（本轮明确不做）**：

1. 不把知识数据面（SQLite/向量/模型/onnxruntime）物理迁出 host 进程——插件体系缺口
   未解（见 §7 对照表），强迁即破坏跨进程 lease、Web/远程可用性与 UI 直连 RPC。
2. 不改任何既有行为语义：安全不变量 9 条（`specs/obsidian-plugin.md`）、L0-L3 分级
   写入、Evidence 复验语义、VaultSearch 契约全部原样。
3. 不做多 vault、不改 vault-config.json schema。

## 1. 形态裁定：扩展现有 `apps/drora-cli/packages/obsidian-plugin`

不新建插件包。依据：插件数据目录 `<~/.drora>/cli/data/obsidian@drora-plugins-official/`
已经是 vault-config.json / vault-focus.json 的事实源位置
（`obsidianVaultService.ts:44-58` 同式推导），扩展现有包使数据归属天然成立、
零迁移；且 seed/打包/CI 链（`bundled-plugins.ts:39-53`、
`prepare-agent-node-bundle.mjs:248-266`、ci.yml obsidian 构建）已存在，
只需增补清单条目。版本 0.2.0 → 0.3.0（plugin.json / package.json / 官方定义
三处一致，definitions 注释纪律）。

升级后插件构成（组件类型）：

| 组件     | 内容                                                          | 形态                                        |
| -------- | ------------------------------------------------------------- | ------------------------------------------- |
| hooks    | SessionStart / PermissionRequest(W01 收窄) / UserPromptSubmit | 不变（manifest hooks）                      |
| skills   | skills/obsidian/SKILL.md + 本轮新增能力使用指南               | manifest skills                             |
| 宿主面板 | VaultView 四视图（notes/ask/insights/review）                 | ui.surfaces **宿主面板形态**（§4.1 扩展）   |
| 宿主服务 | obsidian-vault / knowledge index/query/review 四服务          | 官方定义 **hostServices** 归属（§4.2 扩展） |
| 宿主工具 | VaultSearch + vault_neighbors（CLI core handler + 反向协议）  | 注册门加宿主能力在场条件（§4.3/§4.4）       |

「宿主」含义：实现留在 host/CLI（物理位置不变），但**可见性由宿主能力开关驱动**
（§3 两层启用位），并在商店/插件设置中归属到 obsidian 插件名下。归属声明是既有
`hostMcpServerNames` 模式（`official-plugin-definitions.ts:193,448`）向服务/面板的
推广；**实现形态上**唯一先例 node_repl 是 stdio 子进程（`mcp-config.ts:34,54`），不是
host 进程内 server——故本轮新工具沿用 CLI core handler + drora-protocol 反向请求
（VaultSearch 同机制），不发明进程内 MCP server（评审 2 轮撤回原 §4.3 方案）。

## 2. 能力边界与归属表

| 能力                                                          | 现状位置                                   | 剥离后归属                                   | 实现位置（本轮不变）                                                                | 裁定状态                                            |
| ------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| vault-config.json 单写门面                                    | services/src/obsidian-vault/               | obsidian 插件                                | host（宿主服务）                                                                    | 本 spec                                             |
| 知识索引/检索/Evidence/审核账本                               | services/src/knowledge/                    | obsidian 插件                                | host（宿主服务）                                                                    | 本 spec                                             |
| VaultView 面板 + 侧栏入口                                     | ui/src/v4/VaultView.tsx + drora-extensions | obsidian 插件                                | renderer（宿主面板）                                                                | 本 spec                                             |
| VaultSearch agent 工具                                        | CLI core handler + 反向协议端口            | obsidian 插件                                | CLI core（宿主工具）                                                                | 本 spec                                             |
| vault_neighbors 新工具（N2/N3 近邻面）                        | 无（本轮新增）                             | obsidian 插件                                | CLI core handler + 反向协议（同 VaultSearch 机制，§4.3）                            | 本 spec                                             |
| knowledgeQuerySource thunk（node.ts:2709 反向分发）           | services/node.ts 装配                      | obsidian 插件                                | host（宿主能力关闭时返回结构化不可用而非解引用服务实例）                            | 本 spec                                             |
| knowledgeHost 装配（Jev/语义/autoIndex 源，drora-extensions） | services/drora-extensions/knowledgeHost.ts | 随 D2（建议留 host，装配时机随 §4.2 条件化） | host                                                                                | 随 D2                                               |
| 证据复验 gate                                                 | CLI bootstrap knowledge-evidence/          | obsidian 插件                                | CLI admission 主管道（激活随 evidenceRefs 在场自然联动，无显式宿主能力门——§4.4/D3） | **已收口 D3（建议值：留 CLI 主管道，B4 对账完成）** |
| 三 hooks + skills                                             | obsidian-plugin                            | obsidian 插件                                | 插件包（已是）                                                                      | 已实现                                              |
| Jev 决策域（decision/）                                       | knowledge/decision + 模型能力档案          | **模型能力域（建议留主程序）**               | host                                                                                | **待裁定 D2**                                       |
| 模型能力设置页 Jev/Embedding 表单                             | ui/settings/model-capabilities/            | 主程序设置域（建议）                         | renderer                                                                            | 随 D2                                               |
| 洞察视图 decision 遥测部分                                    | insightsAggregator                         | 随 D2 联动                                   | host                                                                                | 随 D2                                               |
| 会话知识引用面（citation/来源清单/选区引用）                  | ui/src/lib/conversation\*                  | **主程序 chat 通用机制（建议留）**           | renderer                                                                            | **待裁定 D4**                                       |
| L2 GO 门禁（reviewReleasePolicy）与 write-tier-policy         | services review + CLI write-tier           | 策略留 CLI/主程序，账本随 vault 归属         | 现位置                                                                              | **待裁定 D5**                                       |

## 3. 状态所有者（剥离后）

| 状态                                                 | 所有者（剥离后）                                                                                                                                 | 与现状差异             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| vault-config.json / vault-focus.json                 | 不变：插件数据目录单文件，obsidian-vault 门面唯一写方，hooks/gate 只读                                                                           | 无（数据已在插件目录） |
| knowledge-index.sqlite（v1-v6）                      | 不变：`<数据根>/.drora/knowledge/`，host 进程写 + CLI gate 只读连接（WAL 共存已验证）                                                            | 无（路径不动，见 §6）  |
| 本地语义模型 bge-small-zh-v1.5                       | 不变：`<数据根>/.drora/knowledge/models/`                                                                                                        | 无                     |
| host 内存焦点注册表 / VaultView tab                  | 不变：易失态，不持久化                                                                                                                           | 无                     |
| 宿主能力的「在场」（四服务/面板/VaultSearch/新工具） | **新**：两层启用位拆分（下述），由独立宿主能力开关驱动，缺省 true——存量体验不回退                                                                | 装配条件化             |
| **hooks 的启用**                                     | 不变：`enabledPlugins[obsidian] ?? defaultEnabled(false)`，且受 `suppressedBuiltins` 抑制（卸载即写抑制 + 清条目，bootstrap/plugins.ts:796-801） | 无                     |
| **面板/侧栏入口/主视图 'vault' 路由**                | **新**：由插件宿主面板声明 + 宿主能力开关驱动（开关关闭即无入口无路由）                                                                          | 入口归属插件           |
| **VaultSearch/vault_neighbors 注册**                 | **新**：注册门双条件 = 端口在场 && 宿主能力在场（§4.4）                                                                                          | 注册门扩展             |

**两层启用位与三态合成**（评审 2 轮修订，修复 suppressedBuiltins 语义遗漏）：

- hooks 在场（现状语义不变）：`!suppressedBuiltins 含 obsidian && (enabledPlugins[obsidian] ?? defaultEnabled=false)`。
- 宿主能力在场（新开关，缺省 true）：`!suppressedBuiltins 含 obsidian && hostComponentsEnabled`（用户可关的独立开关，不读 enabledPlugins/defaultEnabled——避免单一启用位耦合两类现状相反的能力）。
- 卸载 = 写 suppression + 清 enabledPlugins/options（bootstrap/plugins.ts:796-801）→ 两个位同时失效；「恢复」入口（restorable，bootstrap/plugins.ts:325-333）清抑制后两者各自按上述合成恢复。
- 读取器必须实现上述三态合成（禁止只按 `enabledPlugins??defaultEnabled` 合成——D1 场景下会把已卸载误判为启用）。

防回环/撕裂纪律（评审 2 轮补全消费方清单；本轮自审补写方与设置面形态）：插件启用状态
的存储文件路径与 schema 键（`~/.drora/cli/config.json` 的 `plugins.enabledPlugins` /
`plugins.suppressedBuiltins` / 新 `plugins.hostComponents` 键）**必须**收口到
`packages/shared/src/`（contracts 常量区）单一出处——现状键定义在 CLI 侧
（`apps/drora-cli/packages/contracts/src/plugins/index.ts` 的 PluginConfig、
`adapters/src/config/file-config.adapter.ts:62-63` 基路径与 :127-137 canonical id
归一），B1 将其**上移 shared 并由 CLI 侧 re-export**（迁移定义，不是建第二份）。
消费方全集：CLI contracts/adapters（现持有方）、host 只读读取器（§4.2）、CLI 注册门
（§4.4）、renderer 插件设置页（开关编辑面）——四方引用同一常量（AGENTS.md
「契约键单一出处」；参照 vault-config-reader 公式注释锁定先例）。
`hostComponents` 的**唯一写方** = renderer 插件设置页经 `IPluginManagementService` 新增
`setHostComponentsEnabled`（实现沿用 file-config 既有原子 temp+rename 写模式，与
`setPluginEnabled` 同链路）。**修订注记（2026-11-11 施工 B1 核实）**：本段与 §10-B1
原文写 `IPluginsService`，经核实该接口是 retired 桩通道（`packages/services/src/plugins/
pluginsService.ts` 变更方法一律 `throwRetiredPluginManagement`，插件设置页活链路是
`IPluginManagementService`——PluginsSection → pluginManagementService →
droraAgentService → RPC `plugins/setEnabled` → bootstrap file-config 原子写），唯一写方
不可落在必然抛错的死通道，按「与 setPluginEnabled 同链路」的实质语义落在
`IPluginManagementService`，属 spec 笔误修正而非设计分歧；**不用 userConfig**——userConfig 值经
`${user_config.*}` 注入 MCP env/args（mcp.ts:219-231），语义是插件进程配置注入而非
宿主装配开关，混用会出现第二写入路径。设置面形态 = 插件设置页已安装视图内 obsidian
条目的独立开关控件（与 hooks 启用位分开呈现，验收场景 6）。
**B7 对账注记（2026-11-11）——设置面控件缺口**：写链路已按本段落地
（IPluginManagementService.setHostComponentsEnabled 接口/pluginManagementService/
droraAgentService RPC `plugins/setHostComponentsEnabled`/bootstrap file-config 原子写
全链在码，packages/services 与 CLI 侧各有回归测试），但 renderer 侧**尚无任何消费方**
——PluginsSection/PluginStoreDetailView 无该开关控件，locale 亦无宿主能力开关文案
（packages/ui 全量 grep `setHostComponentsEnabled|hostComponents` 零命中，B7 实测）。
即 B2「宿主能力开关设置面（含重启生效提示）」的 UI 部分未交付；因开关缺省
true=在场（D1a），存量体验与验收 1-5/7-16 不受影响，受影响的仅验收场景 6/8 的
「设置与切换入口」。该缺口留待后续批次补齐（服务链无需再动，只差 renderer 控件 +
zh/en 文案 + 交互回归），不按现状代码反写本 spec 的契约。

## 4. 接口（先行插件体系扩展 + 新增宿主面）

### 4.1 ui.surfaces 宿主面板形态（缺口 g2 的正面解法）

`PluginUiSurfaceAvailability` 增加 `"app"`；`PluginUiSurfaceDefinition` 增加可选
`hostPanelId?: string`（声明该项为宿主内置面板，无需 `server`/`resourceUri`，解析器
`adapters/src/plugins/ui-surfaces.ts` 按二选一校验）。**声明权限边界（本轮自审补）**：
`hostPanelId` 仅官方插件 manifest 可声明，且值必须命中 renderer 内置注册表白名单——
第三方插件声明 hostPanelId 一律解析拒绝并记诊断（防止第三方冒充宿主面板挂载点挂到
主视图路由）。renderer 侧新增**宿主面板注册表**
（`packages/ui/src/plugin-ui/host-panel-registry.tsx`）：宿主实现按 hostPanelId 注册
组件。renderer 接线**全量锚点**（评审 2 轮补全、终读评审补两处，B3 逐一改造并回归）：
`drora-extensions/WorkspaceMainView.tsx`（主视图注册）、
`app-shell/types.ts:211`（WorkspaceMainView 联合类型含 "vault" 成员——宿主面板声明
驱动下该成员的在场性判定改为随注册表）、
`project-sidebar/contract.ts:153-154` 与 `ProjectSidebarNavigation.tsx:68-76`
（onOpenVault/vaultActive 扩展槽契约，入口在场性随宿主面板声明）、
`WorkspaceShellLayout.tsx:1960-2013`（vaultHasOpened 惰性挂载 + deferredCitationOpens
引用 resolver 预挂载——引用打开时序依赖 Vault 挂载，改注册表时序不得回退）、
`:2379-2381`（侧栏扩展槽接线）、`:3016-3130`（chat 与 vault 同层保活/CSS 隐藏，含
3022、3106-3128、3129 分段）。宿主面板不进沙箱、无 HTML/容量限制，天然支持 Web/远程
（实现随 renderer 分发）——这是沙箱 webview 面板做不到的两点，也是 VaultView
（2232 行 + CodeMirror）本轮**不迁沙箱**的直接理由。

**发现通道与过滤语义（终读评审新增，D1a 的成立前提）**：ui.surfaces 到 renderer 的
唯一既有投影是 `plugins/listUiSurfaces`（`plugin-ui-surfaces.ts:22-24`），现状按
`plugin.enabled` 过滤（注释理由「禁用插件没有运行时 MCP，入口不可用」——该理由只对
需要插件运行时 MCP 的 session 级沙箱面板成立），而 `enabled` 合成是
`enabledPlugins[id] ?? false`（`bootstrap/src/plugins.ts:356`）——obsidian 无
defaultEnabled（D1b 维持 false）→ hooks 缺省关闭时宿主面板声明会被该过滤吞掉，
D1a「存量零回退」不成立。因此 B1 必须同改投影过滤语义：**availability:"app" 且带
hostPanelId 的项改按 §3 三态合成过滤（!suppressed && hostComponentsEnabled），session
级沙箱面板维持 plugin.enabled 过滤（既有语义零变化）**；renderer 宿主面板注册表消费
同一投影，不新增 RPC 通道。验收场景 2 加机械断言（升级后未动开关时投影含 vault 宿主
面板项）。

**citation 空态（D4 联动，评审 2 轮补）**：会话引用面留主程序（D4），宿主能力关闭后
`requestKnowledgeCitationOpen` 事件无 resolver 消费——空态定义：宿主能力关闭时逐轮
citation 仍可渲染（历史 receipt 数据在 UI 投影层），「打开原文」入口点击给出结构化
降级反馈（toast「Vault 面板已关闭」），不静默落空、不报错崩溃；入口不隐藏（历史会话
引用仍应可见可解释）。

**B7 收口注记（2026-11-11）——引用回跳滚动时序加固**：B7 统一回归发现 E2E G28/G55
「引用行必须滚入视口」断言确定性失败（top=2253/2221 恒定）。逐级归因排除 B3 挂载
时序回退（B3 diff 保序），实证根因有二：① v3.17.2 上游合并（b3e44cb2a）重建
styles.css 时丢失 `@import "./v4/vault/vault-live-markdown.css"`（git log -S 实证：
f2c5aba13 加入、b3e44cb2a 消失，css 文件仍在——knip unused-files 命中即此病灶），
编辑器退化为无高度约束的页面式布局（诊断：`.cm-scroller`
clientHeight===scrollHeight===4096 > 窗口 800，无可滚容器），scrollIntoView 确定性
no-op——已恢复该 import；② CodeMirror 初次度量完成前 scrollIntoView 同样 no-op
（诊断：派发瞬间 3840/3840、rAF 后 4096/4096 且 scrollTop 仍 0），属机制脆弱窗口。
为此在 `vault-quote-reveal.ts` 落 pending-reveal 语义（本节约束的实现形态）：
reveal 原子延迟到「容器可见（`whenEditorViewVisible`，§4.1 惰性挂载段 display:none
场景）+ 初次度量完成（`whenEditorViewMeasured`）」后一次性派发，settle 窗口
（700ms，与 vault-scroll-memory 同长）内校验目标行相对「scroller 盒 ∩ 窗口视口」
的可见性并只重放滚动 effect；用户显式交互即停。修后 G28/G55/authenticated-handoff
（G61-G63）单复跑全绿。

### 4.2 官方定义 hostServices 归属 + host 装配条件化

`official-plugin-definitions.ts` 的 obsidian 条目增加：

```ts
componentTypes: ["ui"],
hostServices: ["obsidian-vault", "knowledge-index", "knowledge-query", "knowledge-review"],
```

`hostServices` 为本 spec 新增的官方定义键（宿主实现归属声明，语义同 hostMcpServerNames：
仅官方插件可声明）。

**条件化的对象是「构造 + 注册」整体，不是仅摘 `.register`**（评审 2 轮修订）：
`createKnowledgeServices` 在 node.ts:3202 无条件构造——开 SQLite 库、dispose 记入
`sqliteReposToClose`（:3218）、desktop 注入 autoIndex=true 时启动 4s 对齐定时器——
只摘注册会让宿主能力关闭时仍开库、占 index_lease、跑定时器，违反验收 1。因此：

- 宿主能力在场（缺省）：构造与注册照现状（node.ts:3202-3218 构造 → :3520-3526 注册）。
- 宿主能力关闭：**不调用** `createKnowledgeServices`（不开库/不占 lease/定时器不启动/
  dispose 不入关闭链）、四 `.register` 不执行、`knowledgeQuerySource` thunk
  （node.ts:2709）返回 undefined 使 droraAgentService 反向请求回既有 -32603 结构化
  不可用、desktop host 的 knowledgeOptions 注入（desktop/src/host/index.ts:3925-3941
  经 assembleDroraKnowledgeHost 预解析 Jev/语义/autoIndex 源）整体短路。
- accessor.ts:135-141 与 client/remoteServiceAccess.ts:147-153 的 getter **保留不动**
  （eff2ee71 事故注释 client:143-146——getter 丢失即面板「服务不可用」），仅服务端
  在场性变化；未注册通道的 RPC 调用走现有结构化不可用降级路径。

**装配顺序**（事件顺序，AGENTS.md 纪律）：desktop host `establishOwner` 一次性同步
调用 `createLocalServices`（desktop/src/host/index.ts:3954，插件服务无变更事件——
终读评审修正引证：`services/src/plugins/plugins.ts` 为纯接口文件不作断言对象，核查
对象为实现链 `services/src/plugins/{pluginManagement,pluginManagementService,
pluginsService}.ts` 与 `bootstrap/src/plugins.ts`，rg 扫描 onDidUpdate/watch 全无
匹配，会话内实证）→ createLocalServices 入口先经只读
读取器做 §3 三态合成 → 按结果决定上述构造/注册/thunk/knowledgeOptions 分支。

**运行中切换的生命周期 = 重启生效，不做热切换**（评审 2 轮修订）：现状无插件配置
变更事件、装配一次性完成，本 spec **不发明** watcher/热装配。事件顺序：用户切换
宿主能力开关（插件设置页）→ 配置原子写盘 → UI 提示「重启窗口后生效」→ 下次窗口
重启/Host 重建时按新状态装配。hooks 启用位切换沿用插件体系现状语义（新会话生效）。
验收场景 8 锁定该顺序。

### 4.3 新 agent 工具 `vault_neighbors`：CLI core handler + 反向协议（评审 2 轮撤回原 MCP server 方案）

原方案的「host 进程内 MCP server vault-knowledge」**撤回**：经核，唯一宿主 MCP 先例
node_repl 实为 **stdio 子进程**（`mcp-config.ts:34,54`，type==="stdio"；宿主启动 +
socket 回连，非进程内 server），「宿主实现归属」先例只覆盖归属声明，不覆盖进程内
驻留；CLI MCP client ↔ Electron main 进程内 server 的传输（socket 桥/stdio shim）
**无任何先例**，属未设计的新机制，且 §7-g3 替换条件自认未满足——按「缺口未解决
不得假迁」纪律不得作为本轮交付形态。

本轮等价形态：新工具 `vault_neighbors`（近邻笔记检索，N2/N3 的 agent 面）走
**VaultSearch 同款机制**——CLI core handler（contracts 契约同形）+ `VaultSearchPort`
式反向请求（drora-protocol 经 host thunk 到进程内 IKnowledgeQueryService，零出站）。
契约边界与 VaultSearch 同级：入参仅 `notePath + limit`（无路径遍历/日期扩权），输出
候选白名单（relativePath/title/相似度段摘要，不含 score 内部值/sha/绝对路径）。
注册门同 §4.4 双条件。

**新增契约键的单一出处（本轮自审补，AGENTS.md 纪律的显式点名）**：vault_neighbors
链路新增三处键，全部在生产方与消费方共同引用的既有契约区定义一次——

1. wire method `knowledge/neighbors`：`packages/shared/src/drora-protocol/index.ts`
   的 `droraProtocolMethods` 段（紧邻既有 `knowledgeSearch`，:4973 一带），schema
   同文件严格校验；
2. CLI 侧端口方法：扩展 `VaultSearchPort` 接口（apps/drora-cli/packages/contracts/
   src/interfaces/vault-search.port.ts）增加 `neighbors` 方法，或平行新端口
   `VaultNeighborsPort`——**B5 定案（2026-11-11）：扩展 `VaultSearchPort`**。两工具
   共用同一注入点、同一反向通道族与同一注册门开关来源（§4.4「不另设门」），平行
   端口只会复制 server-operations/runtime-tools/tool types 五处接线而不换任何门；
3. host 侧服务方法：`IKnowledgeQueryService` 增加只读 `neighbors` 方法（候选白名单
   输出与 vaultSearchProtocol.ts 的 KnowledgeRunView→协议结果映射同一收口模式），
   descriptor 通道名不变（knowledge-query）。

写入类新能力（wikilink 插入/标签应用/MOC 写入）**不经任何工具直写**：agent 路径走
既有 L1 hook 授权（原生 Write/Edit），批量治理走 L2 Proposal——工具与 hook 的结构
边界（hook 不覆盖 MCP/工具进程内写盘）是硬边界，spec 禁止宣称工具写入受 hook 保护。

**B5 实现落点（2026-11-11）**：工具名 `vault_neighbors`（snake，先例 `submit_result`）；
近邻实现 = 种子笔记 chunk 向量聚合**质心**（N2「note 级向量聚合」同语义）对其余文档
余弦近邻——逐 chunk 两两对比是 O(种子 chunk × 全库 chunk × 维度)，质心聚合把内循环
压回与既有语义召回同量级；相似下限独立常量 `NEIGHBOR_SIMILARITY_FLOOR=0.3`（与
SEMANTIC_RECALL_FLOOR 同 bge 余弦尺度、独立校准域）；`status` 在 search 七态外增
`note_not_found`（路径不在当前索引）与 `semantic_unavailable`（端口关闭/换模型向量
未回填）两个显式降级态（obsidian-knowledge.md §5f.2 已回填契约）。注册门选项名
`includeVaultNeighbors`（同开关同合成、独立选项供单独断言；runtime-tools.ts 合成）。
N1 Smart Lookup = ask 视图第五意图 `lookup`（仅检索，检索即终点：隐藏轮级 handoff
与候选卡「加入 Agent/就此追问」，保留核验与跳到原文；auto 启发式不产出 lookup），
复用 createRun→search 原链路，交互契约已回填 obsidian-knowledge.md §5c.3。

「MCP server 形态」列入 backlog（§8），替换条件：CLI MCP client ↔ host 进程内服务的
传输机制先设计落地并过架构评审。

### 4.4 CLI 侧注册门联动

- `includeVaultSearch`（core/tool/handlers/index.ts:210-211 + runtime-tools.ts:68-69）
  与新 `vault_neighbors` 注册门，从「端口在场」扩为「端口在场 && 宿主能力在场」
  （§3 三态合成，CLI 侧直接读同一 shared 常量）。
  **B4 实现落点（2026-11-11）**：宿主能力位经既有 `runtimeFeatures` 通道下发——
  bootstrap `resolvePluginRuntimeFeatures(pluginOutcome, configResult.config.plugins)`
  调 shared `resolvePluginHostComponentsPresence`（单一出处的三态合成，CLI 不手写
  第二份判定）得 `obsidianHostComponents`（显式布尔恒下发，缺省 true=缺席即在场，
  与 D1a 极性一致），core `runtime-tools.ts` 注册门取
  `端口在场 && runtimeFeatures.obsidianHostComponents !== false`；插件 id 锚点为
  bootstrap `OFFICIAL_OBSIDIAN_PLUGIN_ID`（official-plugin-definitions.ts）。回归测试：
  bootstrap `tests/plugin-runtime-features.test.ts`（三态合成四态：缺省在场/显式关/
  hooks 位独立/卸载抑制）+ core `tests/tool-contracts.test.ts`（includeVaultSearch
  注册门）。`vault_neighbors`（B5）沿用同一开关与同一合成，不另设门。
- 证据 gate（bootstrap/knowledge-evidence/evidence-gate.ts）**位置不动**（admission
  主管道是 CommandInbox 语义，不可拆为插件注入——插件体系无 admission 注入机制）；
  激活语义 = 会话携带 evidenceRefs 时 gate 在场才放行（fail-closed 语义不变）。
  宿主能力关闭时知识服务不在场、prepareEvidence 无处签发，evidenceRefs 天然不再
  产生——无需给 gate 加显式条件（若裁定 D3 要求显式门，再加）。
  **D3 对账收口（B4，按建议值裁定）**：gate 位置与激活语义与建议值一致——gate 在
  `drora-protocol-entrypoint.ts` 无条件实例化并注入 admission 主管道（sendText
  admission 前 / sendQueuedNow 提升前，`evidence-admission.ts`
  `verifyEvidenceOrThrow`：refs 为空直接放行；refs 在场而 gate 缺席/不可用一律
  拒绝，绝不降级放行）；未新增任何宿主能力显式条件（evidenceRefs 天然随知识服务
  在场性联动，宿主能力关闭时无签发方即无 refs，gate 空转不误伤普通输入）。
  对账发现一处实现回归并修复：上游 v3.17.2 合并（b3e44cb2a）丢失了 sendText 的
  admission 前复验调用（import 残留成未使用导入，evidence-session-wiring 6 用例
  红），B4 按合并前实现原位恢复单行 `verifyEvidenceOrThrow` 调用，语义零变化。

## 5. 安全不变量（不得弱化）

1. `specs/obsidian-plugin.md`「安全不变量」9 条（相对路径拒绝/仅 .md/逐段 lstat 拒软链/
   授权根内/配额/原子写/sha256 CAS/图片魔数/坏注册条目跳过）原样援引，剥离不触碰
   门面实现文件。
2. W01 收窄策略与「matcher 真实边界」声明（不得宣称 hook 阻断 Bash/MCP 写入）原样。
3. L0-L3 分级写入（obsidian-knowledge.md §2）与 S03 NO-GO 现状原样：L2 写路径默认
   关闭，剥离不改变 writePathEnabled 门。
4. Evidence 语义（§5 receipt 创建/解析/复验 fail-closed）原样；gate 不可用即拒绝。
5. 新增面（vault_neighbors 工具）只读、输出白名单、无路径扩权——与 VaultSearch
   同级审查。
6. 宿主面板不引入新数据通道（直连既有 RPC，不经沙箱桥）——不新增不变量负担。
7. 宿主能力关闭/插件卸载是「能力不在场」，不是安全边界的一部分：hook 消失后 vault
   根内文件的运行时级读写权限仍由 Runtime 既有权限系统管（= 回退逐次询问，严格
   不弱于现状——与 allowAgentWrites=false 同一 fail-open-to-user 语义）。
8. **卸载边界（评审 2 轮新增）**：任何卸载路径不得触碰 vault 根内笔记内容（卸载
   只作用于插件数据目录与配置条目），不得删除 host 数据根知识库
   （`<数据根>/.drora/knowledge/`，不在插件数据目录，现状机制天然不删）；插件数据
   目录内配置文件的存留由 D6 裁定，裁定落地前卸载 UI 须提示将清除 Vault 授权配置。

## 6. 数据兼容（不丢数据、零手工迁移）

| 数据                                                                     | 位置                                                                                                                                                                                                                                                                                                    | 接管方式                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vault-config.json / vault-focus.json                                     | `<~/.drora>/cli/data/obsidian@drora-plugins-official/`（插件数据目录）                                                                                                                                                                                                                                  | **零迁移**：位置本就按插件 id 推导，宿主服务继续读写同一路径；插件 0.2→0.3 升级无 schema 变更                                                            |
| knowledge-index.sqlite（含 v2 receipts/v3 审核账本/v5 向量/v6 owner 表） | `<数据根>/.drora/knowledge/knowledge-index.sqlite`                                                                                                                                                                                                                                                      | **零迁移、路径不动**：宿主实现原路径接管；vaultId/指纹/sourceEpoch 链不变（指纹未变不清缓存），禁用→重启用数据保留（插件数据目录与数据根都不随禁用清除） |
| 本地语义模型                                                             | `<数据根>/.drora/knowledge/models/bge-small-zh-v1.5/`（`localEmbeddingPort.ts:26-28` `resolveKnowledgeModelRoot` 实现口径；obsidian-knowledge.md §5b.9 原 `<pluginDataDir>/knowledge/models/` 表述与代码不符，终读评审已改齐——模型在 host 数据根，**不在插件数据目录**，任何 D6 方案含 c 均不会删模型） | 零迁移，同上                                                                                                                                             |
| CLI gate 只读连接                                                        | resolveKnowledgeDatabasePathForGate 指向同一物理文件                                                                                                                                                                                                                                                    | 不变                                                                                                                                                     |

**升级路径**（评审 2 轮修正原错误表述——阶段一宿主能力缺省在场，不随 hooks 启用位）：
0.2 用户（已启用 hooks）升级 0.3 → hooks 原样、宿主能力照常在场，行为零变化；
从未启用 hooks 的存量用户 → 面板/服务/工具**照常在场**（同现状），商店展示升级后的
能力归属与「宿主能力开关」。**回滚**：关闭宿主能力开关（重启生效）即回到「无 vault
面」，数据文件留存。

**卸载语义（现状机制 + D6 三选一）**：现状卸载 = 写 suppressedBuiltins + 清
enabledPlugins/options + `keepData!==true` 即 `rm -r 插件数据目录`
（bootstrap/plugins.ts:796-802），且 UI 链路 `IPluginsService.uninstallPlugin` 无
keepData 参数（services/plugins.ts:36-42）——vault-config.json/vault-focus.json 会
被删。vaultId = realpath 根 sha256 **确定性推导**（sourceRegistry.ts:7 注释），据此
三种方案（D6 裁定，建议 a）：

- **a（建议）官方定义声明 `uninstallKeepData: true`**：B1 扩展卸载链路读定义级
  keepData 默认（细粒度，不动全局默认、不影响其他插件）；卸载保留插件数据目录 →
  「恢复」后 vault-config 原样（configuredAt 不变 → 指纹/sourceEpoch 不变 → 索引、
  向量、receipts、审核账本零损失）。
- b 配置迁出插件数据目录（如 host 数据根）：需给 hooks 提供新的配置发现机制
  （现仅经 DRORA_PLUGIN_DATA env），改动面大，不推荐。
- c 接受默认 rm：卸载删配置 = 解除 vault 集成（笔记与知识库仍不删，§5.8）；恢复后
  需重新授权，同根重配 vaultId 相同但 configuredAt 新 → 指纹变 → sourceEpoch+1
  重建索引缓存（可重建缓存；v2/v3 账本表不清但 receipts 因 sourceEpoch 失效）——
  数据不「丢」但需重配+重建，违背「零手工迁移」目标，仅作 fallback 声明。

任何方案下 vault 根内笔记与 host 数据根知识库均不删（不在插件数据目录）。

未来若实现下沉插件进程（§7 替换条件满足后），DB/模型迁移策略另立 spec
（候选：vault-config 记录数据路径 + 首启搬迁，或原位共享 + lease 移植）——本轮不预建。

## 7. 插件体系缺口对照（诚实边界：不能迁的与替换条件）

对照承载力调研 8 缺口，逐条回应。原则：**缺口未解决的能力不迁**，spec 记录替换条件。

| #   | 缺口                           | 本轮处置                                                                                                                                                | 替换条件（满足后才可下沉）                                                                               |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| g1  | app 级常驻/文件 watcher        | 不迁：索引服务留 host（autoIndex=desktop 装配，现两处触发点不变）                                                                                       | 插件体系支持 app 生命周期常驻 server + fs watcher                                                        |
| g2  | session 无关面板 + Web/远程    | **解**：宿主面板形态（§4.1），实现随 renderer 天然 Web/远程可用                                                                                         | 面板下沉沙箱才受此限，本轮不受                                                                           |
| g3  | 内置工具迁插件等价形态         | 部分解：VaultSearch 与新工具 vault_neighbors 均留 CLI core + 反向协议（deferred+UI 共享链路不可替代；进程内 MCP server 无传输先例，撤回，§4.3）         | CLI MCP client ↔ host 进程内服务传输机制设计落地 + 插件 MCP 工具支持 deferred tool                       |
| g4  | 沙箱面板数据通道（≤8MiB/分页） | 不适用：宿主面板不经沙箱桥                                                                                                                              | 面板下沉沙箱时按 office 分块读取先例重设计                                                               |
| g5  | 后台保活/CSP/wasm 申报         | 不适用：宿主面板无沙箱                                                                                                                                  | 同上                                                                                                     |
| g6  | 自定义设置页                   | 不解：vault 授权引导留宿主面板，Jev/Embedding 表单留主程序设置（D2）                                                                                    | manifest settings 从 diagnostic-only 转正式扩展                                                          |
| g7  | 原生模块/大模型资产打包        | 不迁：onnxruntime 随 host 分发（现状）                                                                                                                  | 下沉时 runtimeTopLevelPaths + electron-builder asarUnpack 核对（obsidian-knowledge.md §5b.9 已列核对项） |
| g8  | 跨进程共享索引 DB 并发治理     | 不迁：插件进程不直连 DB（新工具经反向协议到 host 进程内服务）；现状单写 host + gate 只读已验证；autoIndex 定时器留 host 构造内（§4.2 条件化含构造整体） | 任何「插件进程直读 DB」设计必须先移植 index_lease/fencing                                                |

## 8. 新能力圈选（本轮实施集 + backlog）

来源：社区候选调研 15 条。圈选标准：高价值 × 低中难度 × 直接复用现有索引/检索 ×
落在安全边界内（只读或走既有 L1/L2 写授权）。

### 本轮实施（4 条，随剥离批次交付；写入分支均受 S03 NO-GO 约束，见 N3/N4 注记）

| #   | 能力                          | 难度   | 形态                                                                                                                                                                                                        | 复用                                                           |
| --- | ----------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| N1  | Smart Lookup 自然语言检索入口 | low    | ask 视图新增「仅检索」模式（不发起 QA run，直接混合召回+定位跳转）                                                                                                                                          | querySearchPipeline 词法→语义混合召回原样                      |
| N2  | 相关笔记发现（Connections）   | medium | notes 视图侧栏「相关笔记」区（note 级向量聚合 + 近邻列表 + 一键插入 `[[wikilink]]`；面板写入 = **用户动作经面板门面 CAS 直写**，不经 L1——L1 特指 agent PermissionRequest hook 自动放行，评审 2 轮术语修正） | chunk_vectors v5 近邻查询；vault_neighbors 工具供 agent 面复用 |
| N3  | 缺失双链建议                  | medium | vault_neighbors 工具（近邻候选）+ agent 定位句子 → 建议清单；**单文件**确认插入走 L1（agent 原生 Edit 经 hook 授权）或面板 CAS；**批量**分支交付 Proposal 只读 + apply fail-closed                          | 近邻检索 + L1 单文件 / L2 Proposal（批量，见注记）             |
| N4  | Vault 健康体检                | medium | 洞察视图新增体检段（孤儿/断链/空笔记纯图计算）+ agent 建议；单文件清理动作走 L1/面板 CAS；批量归档/删除同 N3 批量分支                                                                                       | 索引 coverage/wikilink 结构抽取                                |

**S03 NO-GO 对账（评审 2 轮新增，N3/N4 交付边界）**：L2 写路径默认关闭
（obsidian-knowledge.md §5e.12，writePathEnabled 门不变，apply/undo 一律
`write_path_disabled` fail-closed）。因此 N3/N4 本轮交付形态为：建议生成（只读）
＋单文件确认写入（L1/面板 CAS 可达）＋批量 Proposal 只读；批量 apply 在
writePathEnabled=false 时返回结构化 `write_path_disabled` 错误——该 fail-closed
行为本身是验收点（§9 场景 16），不是缺陷。批量执行的可交付性以 S03 GO
（WRITE_SAFETY_NO_GO 重评）为前置，不在本战役解锁。

排序依据：N1 是索引资产最低门槛变现；N2 是 Smart Connections 式最高频价值；
N3/N4 组成「写入建议类」安全闭环样板（复用 L1/L2 既有路径，不新增写通道）。

**B6 实现落点（2026-11-11）**：N2 面板 = notes 视图侧栏 `KnowledgeConnectionsPanel`
（消费 `IKnowledgeQueryService.neighbors` 同链，插入 = 门面 CAS 直写文末
`- [[path]]`，冲突结构化反馈）；N3 建议清单 = 近邻 − 已链接纯函数过滤
（`knowledgeConnectionsModel.ts`），agent 面沿用 B5 vault_neighbors + 技能指南增补，
批量分支 = 既有 createProposal 账本面（只读）+ apply fail-closed（无新写通道）；
N4 = `index/healthReport.ts` 纯图计算（孤儿/断链/空笔记口径见 obsidian-knowledge.md
§5h.3）+ `getInsights` additive `health` 段 + 洞察视图体检段 + 空笔记清理提案入口
（delete changes ≤20 条/提案）；交互契约已回填 obsidian-knowledge.md §5h。

### Backlog（后续轮次，按优先级）

1. 语义查重与合并建议（medium，近邻+阈值，diff 预览走 L2）
2. 自动标签/frontmatter 建议（medium，近邻标签分布 + FTS meta 列正循环）
3. MOC/索引笔记生成与增量维护（medium，reconcile 复用）
4. 每日/每周 AI recap（medium，索引 job 变更事件复用）
5. Inbox 语义分流（medium）
6. Bases 视图理解 `.base` 解析（medium，社区增长快）
7. 编辑器选区 Quick Ask（medium，纯 UI 交互，排检索类之后）
8. 批量重命名+全库引用更新（high，与 VaultView 改名衔接后做）
9. PDF/附件内容索引（high，需新抽取管线）
10. 召回后段落级 rerank（high，检索内功）
11. 主题聚类与知识孤岛洞察（high，新 insight 类型）
12. agent 工具面 MCP server 化（§4.3 撤回方案的复活条件：CLI MCP client ↔ host
    进程内服务传输机制设计落地并过架构评审；落地后 vault_neighbors/VaultSearch 可
    统一收敛为插件 MCP 工具）

## 9. 验收场景

剥离正确性：

1. 宿主能力开关关闭（重启生效后）：侧栏无 vault 入口、主视图无 "vault" 路由、四服务
   RPC 结构化不可用（不崩溃）、VaultSearch/vault_neighbors 不在 agent 工具列表；
   **且 knowledge-index.sqlite 未被打开、index_lease 未被占用、autoIndex 定时器未
   启动**（构造级条件化，§4.2）；插件数据目录与数据根数据完整保留。**可执行判定
   （终读评审补，E2E 机械判红绿）**：①四服务 RPC 返回既有结构化 unavailable 错误
   形状（与「服务不可用」降级同形，非崩溃）；②E2E 计时窗内 `knowledge-index.sqlite`
   及其 `-wal`/`-shm` 伴生文件 mtime 均不变（未开库）；③E2E 用只读连接断言
   `index_lease` 无持约行、`index_jobs` 无新行（lease 未占 + autoIndex 未跑的代理
   断言）。
2. 宿主能力开关缺省（升级后未动开关）：面板/服务/工具在场，行为与现状逐项一致
   （存量体验零回退）；**机械断言：`plugins/listUiSurfaces` 投影含 vault 宿主面板项
   （§4.1 过滤语义修正后 app 级项按三态合成而非 plugin.enabled，hooks 缺省关闭不吞
   面板声明——D1a 成立前提，终读评审补）**。
3. 在场但未配置 vault：面板展示引导，服务 getStatus configured=false——与现状
   「未配置」语义一致。
4. 在场 + 已有数据（0.2 用户升级）：vault-config/焦点/索引/向量/账本全部原位可用，
   vaultId 与 sourceEpoch 不变（指纹未变不重建）。
5. 卸载（按 D6 裁定）：a 方案 = 卸载后插件数据目录留存，「恢复」入口重装后
   vault-config/索引/账本零损失直接可用；任何方案 = vault 根内笔记与 host 数据根
   知识库完好；卸载 UI 提示与 D6 实际行为一致。
6. 商店/插件设置页：VaultView、四服务、vault_neighbors 工具归属 obsidian 条目展示；
   宿主能力开关与 hooks 启用位分开呈现与编辑。
7. 三态合成：卸载（suppressedBuiltins）后宿主能力与 hooks 均不在场；恢复后按 §3
   合成各自恢复（hooks 回落 enabledPlugins/defaultEnabled，宿主能力回开）。
8. 运行中切换顺序：切换开关 → 配置原子落盘 → UI 提示重启 → 重启前能力在场性不变、
   重启后按新状态装配（§4.2 事件顺序，无热切换假象）。
9. D4 空态：宿主能力关闭后历史会话 citation 仍渲染，「打开原文」给出「Vault 面板
   已关闭」反馈，不静默落空不崩溃。
10. D2 表单降级：宿主能力关闭后模型能力设置页 Jev/Embedding 表单可见但操作按钮
    禁用并显示「知识服务不可用」（表单不隐藏——档案字段属模型能力域）。

安全不回退：

11. obsidian-plugin.md 验收场景 1-21 全量复跑通过（hook 语义零变化）。
12. obsidian-knowledge.md §5/§5b/§5e 验收映射对应测试全量通过（行为零变化）。
13. 宿主能力关闭后对 vault 根内文件的 Runtime 写询问回退逐次询问（不弱于现状）。

新能力：

14. N1：ask 视图检索模式返回候选并可跳转定位，断网/语义不可用时显式降级。
15. N2：打开笔记后相关笔记区 ≤1s 出近邻（已索引时），面板一键插入 wikilink 经
    门面 CAS 写入成功、冲突返回 conflict 不覆盖（面板写路径，不经 L1）。
16. N3/N4：单文件确认写入经 L1（agent）或面板 CAS（用户）可达；批量 Proposal 在
    writePathEnabled=false 时 apply 返回结构化 `write_path_disabled`（fail-closed
    本身即验收点，S03 NO-GO 边界不破）；无任何未经确认的落盘。

## 10. 实施批次与 gate

每批独立可验证，顺序体现依赖（1→2→3∥4→5→6→7）。

| 批  | 范围                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B0  | 本 spec 落盘 + 两份既有 spec 互链（含评审 2 轮修订）                                                                                                                                                                                                                                                                                                                                                                                                                          | 无代码改动；文档评审 + oxfmt 定向 + architecture:check --changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B1  | 插件体系扩展：ui.surfaces app 级宿主面板形态（含 hostPanelId 官方白名单校验）+ **listUiSurfaces 投影过滤语义（§4.1：app 级宿主面板项按三态合成，session 级维持 plugin.enabled）** + 宿主面板注册表骨架 + 启用状态键上移 shared（CLI re-export，含 hostComponents 新键、三态合成读取器与 IPluginManagementService.setHostComponentsEnabled 唯一写方——接口名按 §3 修订注记修正，原文 IPluginsService 系笔误）+ 官方定义 hostServices 键 + 定义级 uninstallKeepData 机制（D6-a） | `pnpm typecheck` && `pnpm lint` && `pnpm architecture:check --changed` + CLI adapters/contracts 定向 node:test（`pnpm test:upstream-cli` 内相关包，含 file-config 迁移与 DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS 机械对照单测不破 + plugin-ui-surfaces 投影过滤新分支用例）                                                                                                                                                                                                                                                                                                                          |
| B2  | obsidian-plugin 0.3.0：manifest(componentTypes:["ui"] + ui.surfaces 宿主面板声明)/package.json/官方定义（含 uninstallKeepData，**不改 defaultEnabled**——hooks 缺省启用维持 false，D1b）/seed 清单/打包 staging 增补 + 宿主能力开关设置面（含重启生效提示）                                                                                                                                                                                                                    | 同 B1 四 gate + obsidian-plugin 包测试（`test/agent-access` 等既有套件）+ bundled-plugins 播种测试                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B3  | host 装配条件化（**构造级**）：createLocalServices 入口三态合成 → createKnowledgeServices 构造/注册/thunk(node.ts:2709)/knowledgeOptions(desktop host:3925-3941)整体条件化；renderer 全锚点改注册表驱动（§4.1 全量锚点清单，含 app-shell/types.ts:211 与 project-sidebar/contract.ts:153-154）+ listUiSurfaces 投影过滤语义（§4.1）+ citation 空态 + Jev/Embedding 表单禁用态；drora-extensions contract 更新                                                                 | 四 gate + **services 测试双面执行**：node:test 面 = `node --import tsx --test` 跑 `packages/services/test/knowledge*.test.ts packages/services/test/obsidian*.test.ts` 全集中 **24 个 node 文件**（排除 5 个 vitest 面文件：knowledgeJevAdapter/JevAssembly/JevConnection/JevHotReload/SystemOneTransport——rg `from "vitest"` 实测归类，混入必红）；vitest 面 = `pnpm exec vitest run --project drora <上述 5 个 Jev 文件>`（均在 drora-test-files.json 清单）+ `pnpm exec vitest run packages/client/test/remoteServiceAccess.test.ts packages/ui/test/vaultQuoteRevealCodeMirror.test.ts` 定向 |
| B4  | CLI 注册门联动：includeVaultSearch 与 vault_neighbors 注册门双条件（§4.4）+ gate 激活语义对账（D3 裁定后收口）                                                                                                                                                                                                                                                                                                                                                                | 四 gate + CLI 定向 node:test：vault-search-handler / tool-contracts / knowledge-evidence-gate / evidence-session-wiring                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B5  | vault_neighbors core handler + 反向协议端口 + N1 Smart Lookup                                                                                                                                                                                                                                                                                                                                                                                                                 | 四 gate + `node --import tsx --test packages/services/test/knowledgeE2EFullChain.test.ts packages/services/test/knowledgeIndexQuery.test.ts` + 新 handler 契约测试（node:test，登记 ci 清单）                                                                                                                                                                                                                                                                                                                                                                                                    |
| B6  | N2/N3/N4（Connections/双链建议/体检 + VaultView 视图段 + 洞察扩展；批量分支按 §8 S03 注记交付 fail-closed）                                                                                                                                                                                                                                                                                                                                                                   | 四 gate + `node --import tsx --test packages/services/test/knowledgeInsights.test.ts packages/services/test/knowledgeReview*.test.ts` + `pnpm exec vitest run --project drora packages/ui/test/knowledgeReviewView.test.tsx` + ui knowledge\* 定向（对齐 ci.yml:56-57 清单）+ desktop e2e `obsidian-knowledge-positive` 冒烟                                                                                                                                                                                                                                                                     |
| B7  | 收尾对账：drora-test-files.json 登记对齐（现状 services knowledge 仅 5 条 Jev 测试在清单，逐一对账补齐）、i18n vault.\* 键增补（zh/en 同步）、knip 清理、文档（obsidian-plugin.md/knowledge.md 回填实现状态）                                                                                                                                                                                                                                                                 | `pnpm verify:pre-push` + `pnpm knip`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

> 注 1（评审 2 轮修正、终读评审再修正）：B3/B5/B6 的 services 测试 gate 必须按
> **测试面归属分流执行**——`knowledge*.test.ts`/`obsidian*.test.ts` 共 29 文件，其中
> 24 个为 node:test 面、5 个（Jev 系列）为 vitest 面（rg `from "vitest"` 实测归类，
> node runner 跑 vitest 面文件必红）。`pnpm test:drora` 无参仅跑 vitest drora 工程
> 且其清单（drora-test-files.json:181-185）只含那 5 个 Jev 测试；ci.yml:62 是
> **11 文件冒烟子集**（非全集口径），B3 gate 是全集超集。分流机制
> （run-drora-tests.mjs:38-40,70-80）需显式文件参数才走 node 面。清单对账在 B7
> 收口，此前批次 gate 一律用显式命令不依赖清单。
> 注 2：B5/B6 的 desktop E2E 全量（r1-r9/G 系列）按 KNOWLEDGE_E2E_PHASE1_SMOKE 既有
> 套件在 B7 前统一回归一次；manual-review/pending/g-hint-and-plain-selection 待按新
> FileManager 流程重写的既有欠账不在本战役偿还。
>
> 注 3（B7 收尾对账记录，2026-11-11）：① **登记对账**——30 个 services
> knowledge/obsidian 测试逐一对账完毕：vitest 面 5/5 在 drora-test-files.json（契约内
> 无缺口）；node:test 面 25/25 由保留集自动发现覆盖，显式 CI 登记自 11 补齐至 25
> （ci.yml node --test 步骤，另登记 3 个 ui node 面文件并把 vitest 行里 2 个上游已删
> 文件的死条目剔除）。② **i18n**——vault 族 zh/en 各 341 键零 diff、组件引用零缺失、
> 战役增补 34 键精确成对，无键可补。③ **verify:pre-push 等价证据**——整链因工作树
> 未提交（用户约束：战役全程禁止 commit，等用户审阅后手动提交）结构性不可达
> （check-push-worktree.mjs 硬性要求 porcelain 全空、无逃生口）；链内实质步骤逐项
> 真实执行全绿：check:e2e-remote-targets / lint（0 errors）/ docs:stale-phrases /
> db:schema:check / test:architecture / architecture:check --changed（violations 0）+
> test:engineering:affected --files 模式 exit 0（scope.mjs 合法绕过干净前置；选择命中
> 整个工程套件按 Vitest 语义跳过执行并成功）。**提交前待办：用户提交后须重跑完整
> `pnpm verify:pre-push` 原文链**。④ **knip 基线**——`pnpm knip` exit 1 为 pre-campaign
> 全仓既有状态（996 未用文件 / 4011 未用导出 / 3118 未用类型 / 1209 未声明 `link:`
> 子路径依赖，三次复跑稳定，另有 18 条 per-workspace entry Configuration hints）；
> knip 不在任何 CI/pre-push 门禁定义（package.json 仅为诊断入口，dep-refs.mjs 注释
> 定位为手工排查辅助）；exit 0 需全仓 knip 拓扑配置工程，列专项待办不在本战役。
> campaign 归属 findings 4 项全部清零并复跑验证（其中 vault-live-markdown.css 未用
> 文件命中即 §4.1 B7 注记的根因病灶，修复后 997→996）。

## 11. 决策点（建议值先行，裁定推翻则回改）

评审 2 轮修订：原 D1「defaultEnabled=true=开箱等价现状」论证不成立（现状 = 宿主能力
无条件在场 + hooks 默认关，两类能力现状相反），拆为三个独立决策；新增 D6 卸载数据
语义。**裁定时序（本轮自审修正原「未裁定前对应批次不动」的死锁表述）**：各决策的
「建议」值即对应批次的实现缺省，批次按建议值先行启动，不等裁定；任一决策裁定与建议
相反时，按表末回写条款调整对应批次（D6 翻转波及 B1/B2 的 uninstallKeepData 实现与
卸载提示文案，属小改；D1a 翻转波及面最大——B3 装配缺省、测试基线与存量迁移声明，
此时 B3 暂停待重排）。

| #   | 决策                                                                                                                                                                                           | 建议                                                                                                                                                                                                                  | 影响批次                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| D1a | 宿主能力（面板/四服务/VaultSearch/vault_neighbors）在场缺省：独立开关缺省 true（存量体验零回退），不随 hooks 启用位                                                                            | **true + 独立开关**（阶段一模型，§0/§3）                                                                                                                                                                              | B1/B2/B3（缺省值与测试基线）               |
| D1b | hooks 缺省启用：维持 false（守「defaultEnabled 仅限内容型插件」约定，definitions:308-310；DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS 机械对照单测不动）                                               | **false（现状不变）**                                                                                                                                                                                                 | B2                                         |
| D1c | （阶段二，非本轮）是否收敛为单一启用位：禁用插件即下线宿主能力，等效 defaultEnabled=true + 全量行为变更声明                                                                                    | **暂不做**，待产品裁定后另立增量 spec（涉 B3 装配缺省、存量用户面板消失的迁移声明与 E2E 基线更新）                                                                                                                    | 无（backlog）                              |
| D2  | Jev 决策域归属：随 vault 进插件，还是留模型能力/设置域（jevAssembly 数据源=模型能力档案 + credentialService，设置页反向依赖 knowledgeIndexService）                                            | **留主程序**（模型能力域）：decision/ 与 knowledgeHost 装配留 host，洞察 decision 部分随留；**宿主能力关闭时设置表单降级 = 可见但操作禁用 + 「知识服务不可用」提示，表单不隐藏**（档案字段属模型能力域，验收场景 10） | B3/B6                                      |
| D3  | 证据 gate 归属：留 CLI admission 主管道（建议），还是随插件走（需插件 admission 注入机制，插件体系现无此扩展）                                                                                 | **留 CLI 主管道**（CommandInbox 语义不可拆；激活随 evidenceRefs 在场自然联动）。**已按建议值收口（B4 对账确认位置与激活语义一致；对账修复一处上游合并丢失的 sendText 复验调用，见 §4.4 收口注记）**                   | B4                                         |
| D4  | 会话知识引用面（conversationKnowledgeSources/citation/选区引用）归属：留主程序 chat 通用机制还是随插件走                                                                                       | **留主程序**（knowledge 是其消费方之一；宿主能力关闭时引用 UI 空态按 §4.1 定义——历史 citation 可渲染、打开给反馈不静默落空）                                                                                          | 不阻塞（B3 只做空态）                      |
| D5  | L2 审核策略与 write-tier 归属：账本/引擎随 vault 宿主实现（建议），GO 门禁 reviewReleasePolicy 与 write-tier-policy 留 CLI/主程序                                                              | **策略留、账本随**（S03 跨 CLI/runtime 与 vault 两域，拆走门禁会弱化 NO-GO 边界）                                                                                                                                     | B3                                         |
| D6  | 卸载数据语义三选一（现状 keepData!==true 即 rm 插件数据目录，UI 链路无 keepData 参数，§6）：a 定义级 uninstallKeepData=true；b 配置迁出插件数据目录；c 接受默认 rm 配置（重装需重配+索引重建） | **a**（B1 扩展官方定义 uninstallKeepData 键，卸载链路读定义默认；不动全局 keepData 语义、不影响其他插件；b 需给 hooks 新配置发现机制不推荐；c 违背零手工迁移目标仅 fallback）                                         | B1/B2（a 方案落地）；B2 卸载 UI 提示随裁定 |

D1a/D1b/D2/D3/D4/D5/D6 若裁定与建议相反，须回写本表、§0/§2/§3/§6 对应段落并重排
批次；D6 选 b/c 时 §6 卸载语义段与验收场景 5 同步改写。
