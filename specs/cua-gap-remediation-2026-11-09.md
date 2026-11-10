# CUA 差距修复方案（2026-11-09 差距审查产出）

> 输入：差距审查工作流（run dwfrun-7c7706ec → dwfrun-29201688 修订版）23 条定案
> （high 3 / medium 11 / low 9），主报告卡片「CUA 与官方原版差距审查报告」+「差距清单」表。
> 本文件是修复的权威方案；实施批完成前不动代码之外的任何承诺。
> 全程遵守既定纪律：不 commit；还原资产（切段/官方参照/官方字节）不可改。

> **状态：已收官（2026-11-10 勾销，R1–R6 全落）**。逐项登记见
> `docs/cua-restoration-manifest.md` 第七十三轮（含第十七轮 R1.3 勘误内注）；
> 桥接键双轨=有意分歧见 `specs/drora-divergence-ledger.md` 台账 17；状态矩阵见
> `docs/cua-alignment-status.md`。
> **遗留 backlog（R3 注·paste reader 钉扎，low）**：官方 native 同样忽略第三参、
> 两侧拦截语义均未生效，JS 接线待官方语义生效证据再随线。
> win32 recipe 桥接未延后——已随 R1.2 实施（services `node.ts` 常量区 + 注入），无对应 backlog。

## 一、总原则（从既有裁定与先例推导，不新造）

1. **冻结还原资产不可改**：0.6.5 切段是"发行物原样"冻结资产，其"env 键保 ZCODE 名"
   是 P3 有意决策（段头注释明示）。桥接一律走**注入侧/env 路由**，先例=第二十八轮
   方案 A（`desktopHostProcess.ts:302` 经 `ZCODE_HOME=resolveDroraHome()` 把 Drora
   数据根路由进豁免区，零改动冻结资产）。本方案不推翻该先例。
2. **契约键单一出处**：所有跨进程 env 键（含桥接用的 ZCODE_ 别名键）在
   shared/contracts 或 services 常量区定义一次，注入方与文档引用同一常量；禁止
   字符串散写。桥接键注释必须引用先例轮次与消费方（切段行号）。
3. **逐条证据锚**：每项修复带审查发现的官方锚点（SEA offset / asar 偏移 / 官方路径），
   修复注释用中文说明原因+依据（AGENTS.md bugfix 注释规则）。
4. **记档同步**：所有"记档失实"项（afterSign 注释、spec §一、manifest 第十七轮、
   切段头注释 ghost 归属）与对应代码修复同批落，不留口径分叉。
5. **验证矩阵每批跑**：helper tsc + 构建打包 + zcode-cua 五测试链 + 本批新增回归；
   涉及共享模块的批次加 win32 无损套件 + architecture:check。

## 二、批次划分

### R1（high）跨进程契约键桥接批

**R1.1 `--launcher-pid` 键名撕裂（审查 H3）**
- 现状：`desktopHostProcess.ts:296` 注入 `DRORA_CUA_LAUNCHER_PID` 全仓零消费者；
  运行链消费者（0.6.5 切段 `:7153` resolveLauncherPid、node-repl-host dist
  `mcp/server.js:78448`）读 `ZCODE_CUA_LAUNCHER_PID`，缺省回退 host 自身 pid。
- 修复：注入键改为 `ZCODE_CUA_LAUNCHER_PID`（与同块 `ZCODE_HOME` 同款先例注释：
  说明"键名服从冻结切段消费面，路由先例见第二十八轮"）；原 DRORA_ 名不保留双写
  （零消费者，直接切换，避免两名字义）。`desktop/out` 产物随之重建。
- **前置取证（实施第一步）**：报告未证边界——正式签名链 Helper 端拿到错误 pid 的
  具体处置（isLauncherTrustedZCode 拒启/peer 拒连）需先在受控环境实测一次，确认
  修复后（正确 main pid + 自签 Developer ID 缺失的现状）签名门的真实行为，再决定
  是否需要配套放行链；不预设结论。
- 验证：新增单测锁注入键名；mac-launch-contract 已有链回归。

**R1.2 懒启动发现链桥接（审查 H2）**
- 现状：切段按 `ZCODE_CUA_BUNDLED_HELPER_APP_PATH`（`:45007`，直接 appPath）→
  `ZCODE_HOME||~/.zcode` + `"ZCode Computer Use.app"`（`:6907/7220`）找 Helper；
  我方注入与安装全在 DRORA_ 名/`~/.drora`。本机实测 `~/.zcode/computer-use/`
  存在官方 ZCode Helper 会被拉起（跨产品错配）。
- 修复（注入侧，三件）：
  1. services agent env 增注 `ZCODE_CUA_BUNDLED_HELPER_APP_PATH`，值 = 随包
     （desktop 场景，`bundled-cua-helper` 内绝对路径）或已安装（CLI 场景，
     `~/.drora/computer-use/Drora Computer Use.app`）Helper 的**实际 .app 路径**，
     由单一出处解析函数给出（复用/收拢现有 install-root 解析，桥接模块
     `drora-helper-locations.js` 已有 DRORA_ 侧映射可吸收）。切段拿到直接路径
     即绕过 `ZCode Computer Use.app` 名字匹配，desktop 与 CLI standalone 双场景闭环。
  2. 同批增注 `ZCODE_CUA_HELPER_INSTALL_VARIANT`（值对齐官方注入语义，实施时从
     切段 `:6913` 消费点反查取值面）与 `ZCODE_CUA_WIN_HELPER_RECIPE`（桥接现
     `DRORA_CUA_WIN_HELPER_RECIPE` 注入值——纯接线修复非 win32 行为实现，不触
     裁定③边界；如实施时发现消费面复杂则降级为记档+延后，见 R6）。
  3. `ZCODE_HOME` 透传：desktopHostProcess 已注入 host env；核实 agent spawn env
     构造是否透传，缺则补（值仍 `resolveDroraHome()`）。
- 常量落点：上述 ZCODE_ 桥接键统一在 services 常量区（与现有
  `DRORA_CUA_BUNDLED_HELPER_APP_PATH_ENV` 相邻）定义并注释消费方行号；原 DRORA_
  名键保留（host 侧 `drora-helper-locations.js` 消费面不动），形成"DRORA_ 名=我方
  内部面、ZCODE_ 名=切段桥接面"的双轨注释说明。
- 验证：新增发现链 e2e——模拟无托管 host：①桥接后切段能找到我方 Helper
  （**第二轮 R9 勘误**：bundled 分支 installer 身份校验结构性不可过——expectedBuildId
  =pipeline-326130 无 env 通道（embeddedBuildId 恒优先）、bundleId/teamId 期望为官方值；
  "拉起"由 R2 pre-launch 占位/托管 host 链承担，切段 bundled 分支仅承担发现，勿再以
  "切段直接拉起"为验收口径）；②**同机官方 ZCode 在场负测**：切段不得命中
  `~/.zcode/computer-use/`（桥接路径优先级覆盖）；③ bundled 路径缺失时不再静默
  （评估补日志的注入侧可行性——切段 `:45019` 静默 return 不可改，桥接层保证
  路径恒有效即等效消除静默面）。
- 风险：官方 ZCode 同机共存——env 是进程级的，我方注入不影响官方 app 自身链路；
  负测覆盖防回退。

**R1.3 设置页状态发射链补 token（审查 H1）**
- 修复：`node.ts:2108-2116`（launchStandaloneCuaHelperForStatus）改用姊妹函数
  `buildStandaloneCuaHelperLaunchArgs`（`:1274-1299`，已含 tokenFile 且被
  `cuaHostInstallerBuildIdentity.node-test.mjs:96-122` 锁定形态）——主函数直接
  调用提取函数，消除"注释称已提取、主函数未改用"的脱节；manifest 第十七轮记档
  描述同步勘误（R6）。
- 验证：产品态（`ZCODE_RUNTIME_ENV=production`）下该链可成功发射并返回权限真值
  的回归测试（审查中两次 exit 2 实测转为断言基准）。

### R2（决策点 D1）切段懒启动 vs token 模型鉴权贯通

> 状态更新（2026-11-10 R10）：官方 0.6.5 全线零 token，token 占位语义已随认证模型换代退役；本节保留为历史方案记录

- 结构性背景：0.6.5 切段=官方 v2 peer 鉴权模型（argv 无 token、连接走 peer 身份）；
  我方 Helper=保留的 3.11.2 token 模型（`--token-file` 强制门 + authenticate token
  校验）。R1.2 桥接后切段能**找到**我方 Helper，但 `open` 拉起不透传 env、argv 无
  token → 撞 `helperMain.ts:645-651` 门 exit(2)；即便放行启动，切段 client 的
  authenticate 形态对我方 token 校验的兼容性**未取证**。
- 选项（按推荐序）：
  - **A（推荐）pre-launch 占位**：CLI/服务侧在切段懒启动触发前，用现有 token 链
    （services 已有完整机制）先把 Helper 拉起并占住桥接 socket（socket 路径本就由
    我方 env 注入控制），切段发现 socket 已存活即直连。零安全弱化、零冻结资产改动、
    复用已验证机制。实施第一步=取证切段"已有 socket 时的行为"（探测/复用/还是仍
    要自己拉起）与切段 client 的 authenticate 载荷形态，据实微调。
  - B Helper 门分级放行：对"经路由 socket + peer 凭据可信（同 uid+pid 树内）"的
    launcher 场景放行无 token 启动。涉及门语义弱化，需独立安全评审与 spec 修订，
    不在本方案默认路径。
  - C 接受现状 fail-loud + 记档：desktop 托管 host 链为主路径（已全绿），CLI
    standalone 懒启动在 token 模型下暂不可用，切段撞门时 exit.log 有明确文案。
    零工作量但保留 H2 修复的"找得到、起不来"半残状态，仅作 A 受阻时的兜底。
- 无论选型：desktop 托管链不受影响（现状全绿）；此项与 R1.2 验证 e2e 绑定。
- **R2 实施取证结论（2026-11-09，选项 A 落地时实测，切段只读引用）**：
  ① socket 已存活时切段逐调用新建连接直连复用、绝不自己拉起——
  `ensureBrokerAvailable` 仅挂在 `callWithWarmupRetry` 的 broker_unavailable+not_sent
  重试前（切段 :38652-38687、:44897），authenticate 被拒（permission 错误）不触发重试；
  故占位必须先于 agent spawn 完成 socket 监听（services resolveSpawnEnv 懒启动分支
  即该时点），否则切段重试窗内仍会自行 open 撞 token 门并抢 LaunchServices 单实例。
  ② 切段 client 的 authenticate 载荷恒为 `{clientApiVersion:3}`，无 token 且无任何
  env 传递通道（`authenticateParams` 在 0.6.5 全段零调用方，:37522/:37551-37556）；
  pre-launch 占位后 token 只经 `DRORA_CUA_PERMISSION_BROKER_TOKEN`（懒启动分支已有
  注入位）下发给 token 感知客户端（内置 drora-cua MCP）；切段自身（node_repl 链）
  连上后在 Helper token 校验处 fail-closed（brokerServer `not_authorized`，实测文案
  `invalid or missing broker auth token`）——这是官方 v2 peer 模型与我方 3.11.2
  token 模型的结构性终态（门语义放行=选项 B，D1 已排除），非本批缺口。
  ③ 附带实测：~/.drora/computer-use 已安装份为 3.14.3 旧装（broker IPC v2），v3
  客户端在版本门即被拒（`version_mismatch`），到不了 token 校验；占位/验收链必须用
  IPC v3 构建份（当前 dist-cua-helper staging `drora-adhoc-profile`）。

### R3（medium 11 项中 6 项）Helper 行为面机械还原批

全部按官方 SEA offset 逐字还原 + 证据头注释 + 单测，一批一文件域：

| # | 缺件 | 官方锚点 | 我方落点 |
|---|---|---|---|
| R3.1 | cps 旋钮接收侧：`--disable-cps-activation` 解析（1/true/on/yes）→ `native.setCpsActivationDisabled?.()` + `console.error("[cua-cps-activation] disabled via argv")` | SEA offset 85321464（常量）/402099（解析器）/402327-402330（下推） | helperConstants.ts + helperMain.ts |
| R3.2 | 多光标旋钮接收侧：`--disable-multi-cursor-overlay` → `native.ghostSetMultiCursorEnabled?.(!disabled)` | SEA strings 463842 / 492471-492472 | 同上 |
| R3.3 | socket 第三兜底：`BROKER_SOCKET_ENV`/`BROKER_SOCKET_FILENAME`/`resolveBrokerSocketPath` 四返回路径（explicit→win32 pipe→options.dir→runtime 默认），主入口 `--socket ?? env ?? resolve()` | SEA 463742-463754 / 492300 | socketPath.ts + helperMain.ts:616-622 |
| R3.4 | paste 全局串行化：模块级 `pasteSerialTail` promise 链，providedPaste 分支整体包裹 | SEA offset 85520900 + strings 468185-468186 | electronNativeBackend.ts:1861-1936 |
| R3.5 | paste 收尾协议：`restored = await finish(token)`；失败 → `paste_provided_cleanup_failed` warn（reason=pasteboard_restore_failed/clipboard_restore_pending/action_sent）+ 抛错 | SEA offset 85546274/85546427/85546470/85546575 | electronNativeBackend.ts:1933-1935 |
| R3.6 | exit-log 管道：`helperLogLines`（逐行 JSON 重写含 timestamp/level/module/pid）+ 目录 mkdir + `pruneHelperLogs`（`zcode-cua-helper-YYYY-MM-DD.jsonl` 保留 7 天，`HELPER_LOG_RETENTION_DAYS`） | SEA offset 86549645/86550881 + strings 402029-402038 | helperMain.ts:532-543 |

- 注：paste reader 钉扎（审查降级 low）不在本批——官方 native 同样忽略第三参、
  两侧拦截语义均未生效，JS 接线待官方语义生效证据再随线，R6 记档。
- 验证：每项单测（含 R3.3 裸启动可起、R3.4 并发 paste 串行断言、R3.6 保留清理）；
  构建后我方 SEA 字面量计数对齐官方（SOCKET 族 3、cps 三字面量 1/1/1 等——
  `check-bundle-key-parity.mjs` 复跑应收敛：original-only SOCKET 差分消失）。

### R4（medium 剩余项）版本/元数据解锁批（与 R5 联动，受决策点 D2 控制）

| # | 项 | 修复 |
|---|---|---|
| R4.1 | bootstrap definition 冻结 0.6.3 | `official-plugin-definitions.ts:478` bump 0.6.5（解除条件已满足，注释同步改写） |
| R4.2 | 版本门硬退 | `check-version-coherence.mjs` 在 runtime 包不可用时给出显式诊断路径而非裸硬退（保持非零退出但可辨识） |
| R4.3 | 包根 mcp 引擎 0.5.14 工具面 | 按 P3.4 原计划"还原草稿按 0.6.5 证据刷新"：`src/mcp/tools.ts` TOOL_NAMES 对齐官方 14 工具（含 paste、剔除 17 个非官方项）、`server.ts:69-70` 硬编码版本改 0.6.5、session 补 element_scroll——以切段为证据源逐字刷新（保持还原稿形态，不改为转发切段：包入口独立性是既有结构） |
| R4.4 | 占位包元数据失实 | `package.json` description 真实化 + `droraCuaPlaceholder:false`——**解锁三处调用方行为**（dev:desktop 注入 Helper env 并构建、CUA dev 暂存 Sharp、打包门 `shouldPackageComputerUseHelper→true`），故与 R5 同批验证 dev:desktop 全链 |
| R4.5 | 切段头注释 ghost 增量归属失实 | 头注释改写：ghost 会话域实际位于 Helper native AX 桥（`nativeAxSource.ts:866-969`），切段内仅 pip/element_scroll 属实。改写在段头净插 6 行，本文件与各注释中的切段行号锚已于 2026-11-10 统一按改写后工作树基准校正（≥切段 :6898 的行 +6；更早行不受影响） |
| R4.6 | zod 双内联（low） | `link:` → `workspace:*` 装配修正（node-repl-host package.json:26-27），验证 bundle 单内联；受阻则记档接受 |
| R4.7 | cmd+v 字面量（low） | `"cmd+v"` → `"command+v"` 对齐官方（offset 85542433），别名表本就同构 |

- 注：R4.6 走兜底**记档接受**（2026-11-10 整改批核实）：协议替换在仓库结构下
  不可行——`apps/drora-cli` 是独立的嵌套 pnpm workspace（自带 pnpm-workspace.yaml
  与 pnpm-lock.yaml），`@drora/shared`/`@drora/drora-cua` 属**根** workspace 项目，
  `workspace:*` 协议只在声明方所在 workspace 的项目集内解析；实测
  `pnpm install --lockfile-only` 报 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`
  （"@drora/shared@workspace:*" … no package named "@drora/shared" is present in
  the workspace）。跨层引用 `link:../../../../packages/*` 是既有装配惯例
  （adapters/core/contracts/cli/bootstrap/debug/tui 等 11 处同构）。目标半项
  "bundle 单内联"已独立达成：按 build.mjs 同配置取 esbuild metafile，zod 输入
  203 文件全部来自同一份 `zod@4.6.5`（drora-cli store，lockfile 已把 `^4.4.3`
  收敛到 4.6.5），shared 内 import zod 的模块（validation/channel-mention/
  conversationSelection）经 tree-shake 未进 bundle——无需装配修正。

### R5（medium 打包门）主规则与 staging 对齐批

- 现状：config 主规则 from=`bundled-cua-helper/<arch>/Drora Computer Use.app` 恒
  ENOENT（staging 落根目录无 arch 段），实际入包全靠 existsSync 兜底，门被架空。
- 修复：**staging 布局加 `<arch>` 段**（`prepare-cua-helper.mjs` staging 到
  `bundled-cua-helper/<targetArch>/`）而非 config 去 arch——面向未来多 arch 打包
  保持官方形态语义；config 兜底分支补"绕过告警"日志并受门控审查（兜底保留但
  必须可见）。
- 同批：addon 入包 chmod 755（对齐官方权限位）；顶层 CodeResources 属官方旧签名
  形态残留，不仿制，config 注释记档说明。
- 验证：R4.4 之后门=true 时主规则命中（打包 dry-run 资产清单核对）；完整 release
  打包仍属 P6 用户参与项，本批以 config 解析+staging 布局断言为准。
- afterSign 记档失实（medium 尾项）：注释与 `specs/mac-cua-helper-app-alignment.md`
  §一改口"钉扎自建产物（裁定①）"，删除"官方字节"表述。

### R6 记档收口批

manifest 新轮次（修复批逐项登记+审查 run 溯源）、台账新条目（桥接键双轨=有意分歧
记录：ZCODE_ 键面=冻结切段消费面，先例第二十八轮）、`cua-alignment-status.md`
状态矩阵更新、本 spec 勾销、记忆存档。paste reader 钉扎与 win32 recipe 若延后，
此处记档 backlog。

## 三、执行序与验证矩阵

```
R1.1 前置取证 → R1.1+R1.2+R1.3（含发现链 e2e/负测）
→ R2（按 D1 裁定实施+e2e）
→ R3（机械还原 6 件+SEA 字面量门收敛验证）
→ R4+R5（联动批：placeholder 解锁+打包门+dev:desktop 全链验证）
→ R6 收口
```
每批：helper tsc/构建 + 五测试链 + 本批新增回归；R1/R3 触共享模块 → win32 无损
套件 + architecture:check。全程不 commit。

## 四、决策点（已裁定 2026-11-09，用户）

- **D1（R2 鉴权贯通）= A pre-launch 占位**：我方先用现有 token 链拉起 Helper 并
  占住桥接 socket，切段发现存活即直连；实施首步取证切段对已有 socket 的行为与
  authenticate 载荷形态，据实微调。零安全弱化、零冻结资产改动。
- **D2（R4.4 解锁时机）= 本轮随批解锁**：`droraCuaPlaceholder:false` 随 R4 批落，
  dev:desktop 开始要求 Helper 构建（prepare 链已验证），打包门与 R5 同批验证。

## 五、第二轮修复（2026-11-10，三路复验产出）

> 输入：修复施工后三路并行复验（asar renderer/main 面 / env+MCP 链复验 / Helper SEA
> 行为面细扫）。大面积转绿面（MCP 协议 token 级全同、R3 六件逐字对齐、i18n 164 键
> 零差、权限浮窗/IPC/fork env/host 参数向量一致）不再列。

### R7 快修批（簇一+簇三）✅ 已落地（2026-11-10，七十三轮）

| # | 项 | 修复 | 证据锚 |
|---|---|---|---|
| R7.1 | `ZCODE_RUNTIME_ENV` 全链零注入（生产态信任门恒判 dev，两路交叉证实） | desktopRuntimeEnv 增注 `ZCODE_RUNTIME_ENV`（与 DRORA_RUNTIME_ENV 同值同源）；桌面 tsup/vite 增 `__ZCODE_LOCAL_DEVELOPMENT_RUNTIME__` define（与 __DRORA_ 版同值）；桥接测试改真链路形态 | 官方 out/main/index.js offset 48548（Yi 末段 `[xh]:LM()`）+ host Mr() offset 736190 |
| R7.2 | 还原钉扎双漂移 | helper-installer qc "3.14.3"→"3.17.2"；refresh-marker WC "pipeline-293504-ab4d5e6b"→"pipeline-326130-a2d1ba73" | 官方 out/host kp="3.17.2" @767360、Mx="pipeline-326130-a2d1ba73" @~729600；本仓切段 :6943 同钉 326130 |
| R7.3 | 安装链落盘名 xt 未 Drora 化 | xt 常量族 →"Drora Computer Use.app"（2026-09-28 裁定 specs/drora-rename.md:42-48"散落字面量随常量走"） | 我方现存 ~/.drora/computer-use/Drora Computer Use.app + 发现侧 cuaStandaloneStatusLaunch.ts:14 已 Drora 名 |
| R7.4 | 发射向量缺 --disable-multi-cursor-overlay | JC buildHelperOpenArgs 补参 + helper-host 读 env ZCODE_CUA_DISABLE_MULTI_CURSOR_OVERLAY | 官方 out/host zx @~743300 + 切段 :7176-7177/:45046；Helper 端消费已落（R3.2） |
| R7.5 | DRORA_CUA_WIN_HELPER_RECIPE 死键 | 删除注入（0.6.3/0.6.5 切段均不读 DRORA_ 名；ZCODE_ 名桥接已在 R1.2 落） | env 复验逐键表 |
| R7.6 | CLI standalone ZCODE_HOME 零注入 | services agent env 构造补 ZCODE_HOME=resolveDroraHome()（desktop 先例 desktopHostProcess.ts:312 同款） | 第二轮 env 复验发现 3 |

### R8 输入守卫还原批（簇四，electronInputHandlers 域）✅ 已落地（2026-11-10，七十三轮）

官方 SEA unminified 可直读源码，按 R3 纪律逐字还原（**勘误**：typeTextGlobalAsync/clickAtPointAsync 不在 136 导出面——官方 helper JS 以 typeof 门控回退同步原语，不补导出即官方行为）：
- G1 文本注入语义：焦点预检（element_focus_unavailable/@85452514）+ typeTextGlobalAsync
  截断双语义（text_truncated/@85453452 部分落地勿重放、text_injection_failed/@85453721
  零落地可重试）+ 收尾排水 max(120, 字符数×20)ms（@85454109 区）
- G2 活窗四段门禁：window_source_unavailable/@85356277、window_identity_unverified/
  @85356605、window_gone/@85356992、activation_failed/@85357494 + activateConcreteWindow
  @85388374 + assertExpectedPidIsFrontmost @85380580
- G3 key-hold 防误路由：@85407196/85407343 + click/scroll/drag 变体 @85472831/85484612/85490603
- G4 clickAtPointAsync 异步通道 + 缺 ABI 拒绝文案 @85471771
- G5 app-scoped 激活拒绝诊断 @85389303/@85389381；G6 hit-test 并发指引 @85360793
- native 面：typeTextGlobalAsync/clickAtPointAsync 等 async 原语官方 addon 已导出（136
  面含），helper 侧 ABI 调用接线随还原

### R9 记档批（簇二）✅ 已落地（2026-11-10，七十三轮）

- 切段 bundled 分支身份校验**结构性不可过**：expectedBuildId=pipeline-326130（embeddedBuildId
  恒优先，env 通道数学上不可达）、expectedBundleId=dev.zcode.cua-helper、expectedTeamIdentifier
  =8A5X4JJ39T——buildId 无 env 通道、bundleId/teamId 全仓零注入。**接受记档**：bundled
  自愈分支不可用，主路径（pre-launch 占位/托管 host）承担；bundleId/teamId 桥接可缓解
  两道但不改变结论，暂不做。
- R1.2 验证①表述勘误："桥接后切段能找到并拉起" → "桥接后切段能找到（bundled 分支
  installer 恒 verification_failed，拉起由 pre-launch 占位/托管链承担）"。
- bundled-agents 内旧切段副本含 pipeline-293504 钉扎（陈旧产物随 release 重打）。
