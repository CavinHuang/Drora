# Plugin Marketplace 对齐（原版 ZCode 行为复原）

> 2026-09 审查结论：插件体系整体为原版逐行移植，但市场身份面有四处收窄。本 spec 记录
> 复原后的产品规则与状态所有权。对照源：`D:\software\ZCode\resources\glm\zcode.cjs`
> （下称"原版 bundle"）与解包桌面 chunk。

## 产品规则

### 1. 默认市场种子（两个）

- `drora-plugins-official`：官方市场，CDN 源（原版 `zcode-plugins-official` 的改名桥接）。
- `claude-plugins-official`：anthropics 社区目录（GitHub `anthropics/claude-plugins-official`），
  描述文案与原版一致，`pluginCount` 初始 0，首次浏览/安装时懒刷新。
- 种子由 `ensureDefaultPluginMarketplaces`（adapters/plugins/marketplace.ts）按
  `DEFAULT_PLUGIN_MARKETPLACES`（packages/shared）补齐缺失 id，不覆盖已有记录。
- 公开商店分段仍只有 `drora-plugins-official`（原版 `itr=[gz]`，claude 市场不进公开商店）。

### 2. 官方保留市场 id（三个身份）

`isOfficialMarketplaceId` 接受：`drora-plugins-official`（canonical）、
`zcode-plugins-official`（上游 CDN 别名）、`claude-plugins-official`。

- 用户侧新增市场（不传 `trustedId`）若 manifest 声明任一保留 id → 拒绝（"reserved for the
  official marketplace"）。原版 `UQ` 即双 id 判定；Drora 因改名桥接多一个上游别名。
- 受信刷新（`trustedId = record.id`）时，manifest 名归一到 canonical 后必须等于
  `trustedId`，防止刷新中途被改名冒用。
- 保留 id 同时用于：workspace 声明同 id 异 source 的 fail-closed 投影、
  marketplace summary 的 `isOfficial` 标记（claude 市场在原版即标记为 official）。

### 3. icon-sources 图标补给（仅 claude 市场）

- 数据源：`https://cdn-zcode.z.ai/zcode/official-plugin/assets/icon-sources.json`（与官方
  市场共用 CDN 基建，非品牌资源）。
- 条目校验：`name` 符合插件名 pattern；`icon` 为相对多段 `.png` 路径（禁绝对路径/反斜杠，
  每段符合插件名 pattern）；`mimeType` 缺省或 `image/png`；`sha256` 缺省或 hex64。合法条目
  解析为 CDN 绝对 URL。
- 加载（`loadClaudePluginIconSources`）：10s 总超时；成功且非空则写入
  `<pluginStorageRoot>/icon-sources.json` 本地缓存（写失败静默）；失败/空结果回退读缓存。
- 注入（`applyClaudePluginIcons`）：仅对 claude 市场清单中**缺 icon** 的条目补齐，已有
  icon 不覆盖；无变化时保持对象引用不变。
- 启动修补（`enrichCachedClaudeMarketplaceIcons`）：每个进程对每个 storageRoot 至多一次，
  仅当 claude 市场 manifest 已缓存；读路径（pluginsOverview / pluginsReferenceCatalog 协议
  入口）触发但不等待（fire-and-forget）；写回经 `withPluginStorageLock` 串行，直接原子写
  marketplace manifest 路径（与原版 `E8s` 一致，不走 staging 激活）。

### 4. claude 市场 30s 刷新 deadline

- `addMarketplace` 以 `trustedId === claude-plugins-official` 为界创建 30s deadline scope：
  到期 abort 内部 signal 并置 `timedOut`。
- 超时错误：`TimeoutError`（name），文案 `Claude marketplace refresh timed out after 30
seconds`；若底层错误带插件诊断码（PluginSourceMaterializationError），保留诊断码、替换
  文案，保证 refresh failure 持久化的分类不丢。
- 非 claude 市场 scope 为信号直通，无 deadline。成功/失败路径都必须 `cleanup()`（清 timer
  与外部 abort 监听）。

### 5. 远端 Agent 官方插件资产合同（13 包）

`REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES` 恢复原版 13 包（Drora 命名：`zcode-guide-plugin`
→ `drora-guide-plugin`，其余原名）。生产部署校验、开发态 SSH 复制白名单、健康检查共用这份
合同。与原版的已确认差异（记录，不视为偏差）：

- `node-repl-host` 不进合同（Drora 已抽包，原版合同本就不含它）。
- cua 插件 2026-09-25 起对齐原版 0.6.3 形态（见 5a 节），`docs/computer-use.md` 与
  `scripts/computer-use-client.mjs` 两条 required path 已与原版 13 包合同逐条一致。

### 5a. Computer Use 0.6.3 对齐（SDK 引导契约修复）

症状：启用电脑控制后 node_repl 内核引导报 `Cannot find module .../browser-use/0.5.1/scripts/computer-use-client.mjs`。根因是代际错配：

- Drora 的 node-repl 宿主是 0.6.0 架构（bridge globals + kernel client SDK），CUA 的
  使用契约 = 0.6.x 引导：cell 内 import CUA 包的 `scripts/computer-use-client.mjs` 挂
  `agent.computerUse`，文档经 `agent.documentation.get("computer-use")` 读 CUA 包的
  `docs/computer-use.md`。
- 但 bundled computer-use 停留在 0.5.14（旧自包含宿主形态）：无 client、无 docs、
  SKILL.md 无引导段——模型只能自行拼引导 cell，且原版引导的 env 链只认
  `ZCODE_*/CLAUDE_*`，在 Drora 全不命中。

修复规则：

- CUA 插件包内容对齐原版 0.6.3：`scripts/computer-use-client.mjs`、`docs/computer-use.md`、
  0.6.3 SKILL.md、plugin.json/package.json version=0.6.3；seed 清单
  （OFFICIAL_CUA_REQUIRED_SEED_PATHS）钉住 client/docs。旧 `dist/mcp/server.js`
  （0.5.x wrapper 产物，无消费方）与 node_modules 按发行物布局保留。
- SKILL.md 与 docs 的引导 env 链前置 `DRORA_CUA_PLUGIN_ROOT ?? DRORA_PLUGIN_ROOT`
  （Drora 宿主注入，built-in-node-repl.ts），保留 `ZCODE_*/CLAUDE_*` 兜底。
- 宿主 cua-bridge 的 bridge 以 Symbol.for 注册表键挂入 kernel globals：除 Drora 键
  `drora.node-repl.computer-use-bridge` 外双挂原版键 `zcode.node-repl.computer-use-bridge`
  （市场安装的上游 client 用该键取 bridge，逐字可用）。
- 宿主 pluginRoot fallback 链对齐原版：`DRORA_PLUGIN_ROOT ?? CLAUDE_PLUGIN_ROOT ?? cwd`。

### 5b. Windows helper 凭据链修复（broker_unavailable → bridge 无 broker）

继 5a 引导修复后的第二层症状 `Computer Use is unavailable for this node_repl session`
（bridge 已找到但 `input.broker` 为空）。凭据链：
Desktop/Host 启动 Helper（windows-helper.js + ax_native.node）→ agent spawn env 注入
`DRORA_CUA_PERMISSION_BROKER_SOCKET` + `DRORA_CUA_PLUGIN_AUTHORITY` → CLI sanitize 前捕获
快照 → 定向注入 `node_repl` server env → `__drora-plugin-host` 恢复 → 宿主
`captureComputerUseRuntimeFromEnvironment` 建 runtime/broker。链上两处发行版缺陷：

1. **打包映射缺失**：helper runtime staging 到 `resources/glm/tools/cua-helper`
   （prepare-agent-node-bundle），但 `resolveWindowsCuaRuntime` 产品模式只读
   `resources/tools/cua-helper`；electron-builder Windows extraResources 需要显式映射
   `../zcode-cua-helper/runtime/cua-helper → tools/cua-helper`。该映射由 54ffe82 引入、
   被 599a427（mac 签名提交）误删——Windows Computer Use 在受影响发行版上永远
   fail-closed。规则：动 extraResources 时按 tool 清单逐项核对（ripgrep/ugrep/cua-helper）。
2. **manifest 包名校验错位**：入库的上游 0.6.3 runtime 资产的 `runtime-manifest.json`
   由上游生成，`packageName` 为 producer 原名 `@zcode/zcode-cua`（豁免区契约）；dev 路径
   校验的则是本仓 producer 包名 `@drora/drora-cua`。两条路径不得共用一个常量——
   `EXPECTED_PACKAGED_MANIFEST_PACKAGE_NAME`（packaged，认上游原名）与
   `EXPECTED_PACKAGE_NAME`（dev，认本仓 scope）已拆分。

用户当前安装的热修（勿重复执行）：把 `resources/glm/tools/cua-helper` 整树拷到
`resources/tools/cua-helper`，并把两处 manifest 的 `packageName` 临时改为
`@drora/drora-cua` 迁就发行版 host 旧常量；新版本安装覆盖后自动还原自洽。

### 5c. CUA 执行链深度审查修复（producer 工具层 + env 键撕裂）

45 轮五方向审查（node_repl 宿主/Helper 链/打包资产/spawn env 链/CUA 方法面）交叉确认并
于同轮修复：

1. **broker socket env 键改名撕裂（P0）**：写侧 `packages/zcode-cua` broker 常量保留旧名
   `ZCODE_CUA_PERMISSION_BROKER_SOCKET`，读侧（shared 捕获/注入/宿主）全用 DRORA 名——
   Host 发射的 socket 进不了凭据快照，且旧键不在 sanitize 名单泄漏给子进程。修复：写侧
   常量（含 UNAVAILABLE、死代码 producer）全部改 DRORA 名；该键现已进 sanitize 覆盖面。
2. **CUA producer 工具层缺失（P0）**：原宿主内嵌上游 `@zcode/zcode-cua@0.6.3` 完整工具层
   （14 工具→42 项 broker 协议方法翻译、会话注册表、CUA_NOT_READY 信封、possibly_sent
   收据、app-associations 元数据）；本仓还原稿是透传（SDK 工具名直发 helper，10/14 方法
   会 `method_not_found`）。修复：按"发行物原样"原则切取原版宿主 dist 的上游段
   （[3643401, 4982704)，自包含）入库为 `packages/zcode-cua/upstream/zcode-cua-0.6.3.index.js`
   （env 键改名 + loadSharp 加 DRORA 档 + express 还原真 require + 补 export），宿主构建
   经 esbuild onResolve 精确 alias `@drora/drora-cua` 指向切段；端到端冒烟
   （`packages/zcode-cua/test/cua-tool-layer-smoke.mjs`，假 helper NDJSON）验证翻译、
   握手序（authenticate→broker_info→authenticate→list_applications）与 envelope。
3. **win32-arm64 包代际撕裂（P1）**：browser-client.mjs 是改名残留旧版（zcode.\* 键）。
   已从源码同步；另 browser bridge 双挂 `zcode.node-repl.browser-control-bridge`（与
   cua-bridge 同一兼容模式），保证市场安装的上游 client 逐字可用。
4. **P2**：bundled-skills 补 README（品牌改名）；plugin-host token 恢复补对称 finally
   清理 + 修正"无 token"的过时注释。

用户当前安装的热修（勿重复执行）：`resources/tools/cua-helper`（44 轮）+ 插件缓存
node-repl-host dist 同步 + **app.asar 字节级 in-place 替换**（`ZCODE_CUA_PERMISSION_
BROKER_SOCKET` → `DRORA_...`，等长 4 处；备份在 `resources/app.asar.bak-cua-hotfix`；
builder 未启用 asar integrity fuse，等长替换不动 header）。新版安装覆盖后自动回归仓库
修复形态。

### 6. `${ZCODE_SKILL_DIR}` 兼容别名

技能内容变量展开（skill.ts）支持 `CLAUDE_SKILL_DIR`、`DRORA_SKILL_DIR`、`ZCODE_SKILL_DIR`
三者：为原版 ZCode 编写、体内使用 `${ZCODE_SKILL_DIR}` 的技能可原样运行。hooks/shell/MCP
上下文中该变量与 `DRORA_SKILL_DIR` 同样被拒绝（无技能目录语义）。

### 7. 并行会话合并（468c160..1048256，第 38-43 轮）

远程并行会话独立完成了同向对齐（CUA 0.6.3 整代迁移含 63 表死代码删除、claude 市场补录、
mac Resources/app 解包副本、natives 按平台 staging、Helper 缺失打包告警），与 42-46 轮
改动合并时按以下裁定统一：

- **icon-sources 实现**：两套语义等价（原版 cdn/f8s/mdn 同构），按「唯一写者」统一到
  本仓原版对照实现（parsePluginIconSources / applyClaudePluginIcons /
  enrichCachedClaudeMarketplaceIcons，含 addMarketplace 内联预取 + storage lock + 30s
  scope）；并行会话的 parseIconSourceIndex / mergePluginEntryIconSources /
  syncClaudePluginsOfficialIcons 及 bootstrap 调用点删除，其测试文件改写为引用统一实现。
- **claude 市场常量名**：统一用 `CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID`
  （shared 导出，UI/已提交代码引用面）；contracts 的 `CLAUDE_PLUGIN_MARKETPLACE` 同值
  保留（字面量自洽）。
- **CUA bridge symbol**：并行会话把常量改回原版 `zcode.node-repl.computer-use-bridge`
  单挂（比双挂更逐字对齐原版），采纳；bundled 与市场的 computer-use client 均读该键。
- **seed paths**：采纳并行会话的删除（`dist/mcp/server.js` 不再列入——配合死代码清理，
  0.6.3 无 dist）；保留 docs/SKILL 的 DRORA env 链补丁（并行会话版本缺失，已重放）。
- adapters package.json 的 test script 合并为两套测试串联。

## 状态所有权

- `known_marketplaces.json` / marketplace manifest / `icon-sources.json` 的唯一写者是
  adapters/plugins/marketplace.ts（CLI bundle）；bootstrap/协议层只调用，不复制状态。
- icon 补写与市场刷新共用 `withPluginStorageLock(storageRoot)` 串行，防止并发改写
  marketplace 目录。
- 每进程一次的修补标记（storageRoot 集合）是进程内内存态，不持久化。

## 验收场景

1. 全新 storageRoot：`ensureDefaultPluginMarketplaces` 种出两条 known 记录（drora + claude）。
2. 用户粘贴官方 CDN URL 新增市场 → 报保留名错误，不产生平行市场。
3. 用户粘贴 `anthropics/claude-plugins-official` → 同样报保留名错误（原版行为：默认已种）。
4. claude 市场刷新：icon-sources 拉取失败时清单仍正常入库（无 icon 降级）；超过 30s 报
   TimeoutError 且 refresh failure 保留原诊断码（若有）。
5. 已缓存 claude 清单 + 本地 icon-sources.json：进程首次 overview 请求后清单条目获得
   icon，第二次请求不再重复修补。
6. 远端部署：13 包 required path 校验驱动重部署判定；缺任一即重装。

### 8. CLI /model 的 main|lite 别名（有意分歧记录）

原版 3.14.3 的 /model 支持 `[list|main|lite|provider/model]`（main/lite 是官方商业
Coding Plan 的模型别名，模型选项带 alias/name 字段，别名在 app 层解析）。Drora 不实现：
无商业别名模型，help usage 为 `/model [list|provider/model]`，输入 main 报
"Model is not available"。切换响应保留 reasoningLevel 后缀（本仓实现自洽）。
后续从 3.14.3 merge 时不要把 main/lite 当缺口误补；若未来引入 Coding Plan 别名模型，
需同时补协议字段（DroraModelOption.alias/name）与解析。

### 9. server-remote（kind:"server"）桌面连接面（有意分歧记录）

原版 3.14.3 桌面支持三种远端 target：ssh / wsl / docker 之外还有 **server**（连接
自托管 drora-server 的 HTTP+WS 桌面链路：fetchServerInfo → fetchHostCapability →
WebSocket RPC，host 侧 createServerRemoteWorkspaceServiceCollection 复用本地服务）。
上游开源 drop（872ad96 起）即未包含该 connector，本仓跟随开源树同样缺失；但协议契约
（packages/shared/src/server-remote.ts）、server 端实现（packages/server/src/http.ts、
drora-server-cli）与 main 侧残留的 kind:"server" 分支仍在——**半拆除状态**。

现状：桌面无法连接自托管 server；rendererActionTrace 的 remote_kind 枚举仍含 server。
后续二选一：(a) 按 bundle 反汇编复原 connector（host/index.js @1475243 起）；
(b) 完成拆除（删除协议广播与 main 死分支）。在此之前，server-remote 属"已知缺口，
非本仓引入"。

### 10. preview 更新通道与 rewards 商城桥（有意分歧记录，批 4 main 审查）

- **preview 通道**：切换到 GitHub 更新源（update-feed-github.md）时丢失了通道目标化——
  原版 manifest provider 会按 preview 设置拉 preview manifest；现在 electron-builder
  detectUpdateChannel:false 且 CI 只产 latest\*.yml，"接收 preview 版本"的用户与 stable
  拉同一份清单，通道跟踪/skip 键按 preview 持久化但不生效。要恢复需 CI 产出 preview.yml
  并把 resolveUpdateReleaseChannel 落到 autoUpdater.channel。
- **rewards 商城 webview 桥**：原版有 rewardsWebview.cjs preload + will-attach-webview
  分支 + 渲染端商城页；本仓跟随开源基线裁剪（renderer 零引用、删除自洽），但
  vite.config.ts 残留死配置 VITE_REWARDS_WEBVIEW_ORIGIN。上游同步时若 renderer 恢复
  商城页，需一并恢复 preload 桥。

### 11. 闭源专属能力缺口与遥测分歧记录（批 5 审查）

- **system-reminder 闭源专属来源**：原版 bundle 的 per-request 来源清单含
  `memory_update`（后台记忆整理通知，"Background memory consolidation updated your
  memory directory"）与 `relevant_memory`（memoryRecall 预取召回管线）——闭源专属
  记忆管线，上游 OSS 两版（872ad96/29628c9）的 source.ts 均无此二者，本仓跟随 OSS。
  相关键：`memory_update`、`relevant_memory`、`sr.memory_update`、
  `sr.relevant_memory`。无运行时影响（本仓无生产方/消费方）；bundle parity 差分时
  按本条豁免。同族文案分歧：memory section 收尾句的指令文件名本仓用 AGENTS.md
  （开源基线语义），闭源 bundle 保留 CLAUDE.md——跟随 OSS，有意分歧。
- **ARMS/RUM 遥测**：原版桌面无条件 init 且租户端点内嵌 bundle；本仓 env 驱动
  （DRORA_TELEMETRY_ENABLED + DRORA_ARMS_RUM_ENDPOINT，未配置即停用）——跟随开源
  基线，不内嵌租户设施。
- **UI i18n 裁剪键族**（约 250 键）：rewards/marketingTouch/manualClaimPlan/
  chat.captcha/mode.label.{claude,codex,gemini,opencode}/settings.modelProvider._
  /appHeader.goToProviderConfig_/taskList.newTask.{claude,opencode,gemini,codex}/
  server.\_ 等——对应被裁剪的商业特性（商城、营销、多 provider 接入向导）与被
  bot-channel 替代的 WebRemoteControl 桌面键族；feedback.background.\* 为措辞修正。
  webRemoteControl.description 文案随 bot-channel 方向（specs/mobile-web-remote.md）。
  feedback.background.defaultDetail 为精确化修正而非语义反转：实际行为是上传为
  in-process fetch、退出即止，en/zh 双语已一致表述（"stops if you quit the app"）。
- **browser meta 键改名映射**：原版 responseMeta 前缀词是 codex/browserUse 与
  zcode/browserTurnScreenshot（原版自身双前缀），本仓统一为 drora/\*——该映射不在
  drora-rename.md 规则表内，后续 parity 归一化脚本需单独映射。

### 12. 构建残留清理记录（批 4 构建链审查 P3 收口）

- release.yml 死变量 `$FLAGS` 行已删（flags outputs 计算保留）。
- bootstrap.mjs 的 git submodule 初始化行已删（apps/drora-cli 自 2026-09 为 in-tree）。
- prepare-prebuilds.mjs 注释指路 .gitlab→.github/workflows。
- drora-rename.md 豁免区路径笔误（apps/zcode-cli→apps/drora-cli）已修。
- bundled-skills 两处 topLevelPaths 差异（desktop 含 README / remote 不含）已注记为有意。
- clean.mjs 覆盖面扩展：apps/drora-cli/\*_ 的 dist/node_modules、desktop out/dist/
  bundled-agents/bundled-tools/mock-cdn、zcode-cua-helper dist_。
- 未采纳：cli-sea 构建循环加 obsidian-plugin（SEA 资产清单不消费，徒增构建时间）。

### 13. RPC 帧协议：已加固项与登记为继承的项（批 3 RPC 审查收口）

- **已加固（有意分歧）**：`packages/rpc/src/protocol.ts` 读帧前校验 body length
  上限 32MiB，超限 log + `socket.end()`——伪造 length 的静默卡死 DoS 面闭合。
  原版无此校验（上游继承），属本仓先行加固；上游同步时保留本块。
- **登记为继承（不修）**：`ChannelServer.collectPendingRequest` 超时不清理 pending、
  `ChannelClient.requestEvent` 早取消泄漏、ws 传输非 OPEN 态丢帧且无背压观测、
  反序列化异常无隔离、`sendFlowState` 无生产端（LAN 直连架构取舍，
  specs/mobile-web-remote.md）。修复任一项都会造成与上游的持续 diff 成本；
  待上游修复后跟随。
- flow-state 生产端若未来接入（server ws bufferedAmount 水位 → `scope.setTransportFlowState`），
  消费端链路（host → connectionScope → CLI pausedConnections）已全量在位。

### 14. 自研新增键族登记（仅本仓存在，非还原缺口）

方法名/meta 键差分中 only-ours 的项，全部自洽（生产=消费同仓）：

- `drora/isSkill`、`drora/skillName`（shared/src/hooks.ts——hook meta 标注）
- `drora/nodeReplEmittedImage`（node-repl-host result.ts——合成图元数据）
- `drora/session`（ui workbenchDragDrop——UI 拖拽 payload kind，非 wire 协议）
- `drora/toolSurface`、`drora/browserUse`、`drora/browserTurnScreenshot`
  （原版双前缀 codex/zcode 的统一，见 drora-rename.md 浏览器键映射节）
- drora-server-cli 打包路径族（runtime/licenses/agent 等，非协议）
- MobilePairing 三方法 + webRemoteControl.qr.\* i18n 键（LAN 直连远控，
  specs/mobile-web-remote.md）
- session.events 的 malformed_tool_call 与 blockedReason 细化值（闭源 bundle 为
  自由 string，本仓收紧为枚举——消费端 UI 已适配）

bundle parity 归一化脚本按本节豁免 only-ours 检查项。

### 15. Node 版本矩阵记录（批 4 构建链审查 P3-6 收口）

- 仓库开发/CI/根类型构建：Node 24.14.0（mise.toml 单点钉扎）。
- SEA 构建：process.versions.node（随 CI 的 24.14.0）。
- 远端 mock-cdn Node 运行时（scripts/prepare-prebuilds.mjs nodeVersion v22.16.0）：
  远端部署的独立 Node 与 SEA opentui FFI 绑定（specs/sea-tui-node-alias.md）是两条
  独立链；22.16.0 钉扎为远端运行时的既有决策，保持并在本条留痕。
- 桌面内置 Agent（drora.cjs）运行于 Electron 41 的 Node（无独立 pin）。
