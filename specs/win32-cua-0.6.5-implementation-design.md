# win32 CUA 0.6.5 完整实施设计（2026-11-10）

> 本文 = `specs/win32-cua-0.6.5-alignment-plan.md`（分析蓝图）的**实施设计**：四层结构（L0 本仓准备 / L1 addon 逆向重建 / L2 helper JS 还原线升级 / L3 换装交付）+ 证据坐标 + 施工序 + 验收矩阵。
> 裁定引用：③ win32 实施由用户在 win 机器执行（本设计的 L1/L3 与全部 [E] 验证在其上）；① addon 逆向重建不走拷贝；官方形态为权威（`feedback-official-form-is-authority`）。
> 关联：`specs/cua-3.17.2-alignment.md`（mac 战役方法论与先例）、`specs/drora-rename.md`（品牌豁免）。

## 一、断代现状：win CUA 在当前工作树是死链（本轮实证）

三层断代同时存在，任一层都独立致命：

| # | 断层 | 证据 | 后果 |
|---|---|---|---|
| 1 | **IPC 断代** | 切段 0.6.5 客户端 `CUA_BROKER_IPC_VERSION = 3`（upstream/zcode-cua-0.6.5.index.js:37437、authenticate 携 clientApiVersion:3）；vendored 0.6.3 win helper 服务端 =2（runtime/cua-helper/dist/windows-helper.js 内 `CUA_BROKER_IPC_VERSION = 2`）；门语义=clientVersion>服务端即拒 | version_mismatch，authenticate 即死 |
| 2 | **Electron ABI 断代** | desktop 已 electron 44.7.0（v3.17.2 合并带入，packages/desktop/package.json:126）；vendored addon 为 electron 41 ABI（runtime-manifest electronVersion 41.0.3） | fork 宿主（ELECTRON_RUN_AS_NODE 的 electron 44）加载 41 ABI addon 必败；产品 manifest electronVersion 校验面同断（dev 模式虽不校验版本，ABI 逃不掉） |
| 3 | **argv 断代** | 我方还原 win main 要求 `args.length !== 4 → exit 2`（windowsDevHelperMain.ts:29-33）；切段 0.6.5 fork 传 5-6 args（+`--ghost-cursor-overlay`/`--disable-multi-cursor-overlay`，切段 :45066-45076） | 即便前两层修好，entry 启动即 exit 2 |

**结论**：win 实施不是"升级"，是**复活 + 对齐**。且三层断在 W1 一批内可同修（换装三件套），无需分层解锁。

## 二、三面账与差距总账（2026-11-10 勘误定谳）

数据基座 `native/reverse/data/win32-3.17.2-napi-functions.json` 已改账（原 added=24 为扫描漏账，49+24≠94 自相矛盾）：

| 面 | 数量 | 说明 |
|---|---|---|
| 官方 0.6.5 win addon | **96** | 94 三源定谳 + displays/drag PE 复核（sha 11f8bc9c…，/tmp 参照实测） |
| vendored 0.6.3 官方 addon | **52** | strings 逐名双扫实证（sha 92533fe5…） |
| 我方还原线 ax_native_win.cc | **49** | 0.5.13 期参照建造（README §还原边界），**欠 vendored 0.6.3 就有的 3 个**：activateWindow / launchApplicationAsync / listInstalledApplicationsAsync（vendored 0.6.3 JS 引用 7/3/1 次） |

**真实增量（vendored 0.6.3 → 官方 0.6.5）= 44，纯增零移除**，按域：
- **ghost 16**（win 无 ghostMotion/GeometrySelftest 两自检，其余 mac 血统同族全在——ghost 非 mac 专属）
- **pasteboard 4**（Begin/Finish/MarkDispatched/AwaitRead）
- **postMessage 投递 5**（Click/Drag/Scroll/Char/Key Async）
- **读回/模式梯 4**（elementPatternCallAsync / elementValueReadAsync / setValueReadbackAsync / hitTestInvokeAtPointAsync）
- **surface/投递域 7**（enumerateSurfacesForFrame / frameWindowContext / getDispatchWindowId / getForegroundRootWindowId / getWindowId / restoreForegroundWindow / classifyPostMessageDelivery）
- **杂项 8**（captureWindowPngCompositeAsync / hasActiveInputHolds / invokeAcceleratorAsync / scrollElement / clickAtPointAsync / typeTextGlobalAsync / winAxElementFromToken / winAxElementRelease）

JS/装配层差距（`data/win32-3.17.2-js-family-diff.json`，已验证）：IPC v2→v3；BROKER_METHODS 42→43（唯一增 element_scroll）；argv +2；错误码 +83（=win 行为面地图）；envKeys 11 键零增删；electron 41.0.3→44.7.0；node_modules = express 系 + @img/sharp-win32-x64 系 + detect-libc。

## 三、官方面证据坐标表（[S] 主源；施工直接引用）

参照物：官方 0.6.5 win32-x64 运行时（cua-helper.zip 解包，W0 入仓为 gitignored reference 后以仓内路径为准）。

| 证据 | 坐标（解包路径 cua-helper/ 下） | 消费层 |
|---|---|---|
| argv 契约逐字 | dist/windows-helper.js:34054-34090（allowedFlags 过滤→positional 恰 4→`{socketPath,parentPid,ghostCursorOverlay?,disableMultiCursorOverlay?}`） | L2 |
| 延迟原生初始化 | runWindowsDevHelper :34138 起（deferNativeInitialization / onTransportReady / `transport_ready` 控制消息 / runHelper 传 deferBackendInitialization:true） | L2 |
| 鉴权门 | :19866 `WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN = true`；:34181-34185 开门 stderr 告警文案；:34104-34107 assertPeerIdentityAuthCapable 文案（"Windows peer verification lands separately; for local development set ZCODE_CUA_DEV_MODE=1."） | L2 |
| token 退场 | 官方 entry 全文 `authToken` **零出现**、configSchema 无 token 字段（0.6.3 有）→ win 0.6.5 鉴权=版本门+管道命名空间 | L2 |
| ghost 接线 | enableGhostCursorOnNative :34163-34167（`ghostSetEnabled?.(true)` + `ghostSetMultiCursorEnabled?.(!disable)`，全可选链） | L2 |
| 切段 fork 消费面 | 我仓 upstream/zcode-cua-0.6.5.index.js:45057-45101（recipe 字段校验/argv 组装/env 组装 HELPER_ADDON_ENV+ELECTRON_RUN_AS_NODE） | L3 验收基准 |
| addon 96 面 | data/win32-3.17.2-napi-functions.json（本仓已勘误） | L1 |
| PE 构建 | cppwinrt 2.0.250303.1 / SDK 10.0.26100.0 / 上游单编译单元 screen_capture_win.cc / D3D11 双 worker（ScreenCaptureCompositeWorker+ScreenCaptureWorker）/ UTF-16 窗口类指纹 10 族 / 内嵌引擎分类学 3 类 | L1 |
| manifest 形态 | runtime-manifest.json（0.6.5 / 44.7.0 / sha 双钉扎；package.json 无 droraCuaRuntime 块——该块为我方 dev-root 解析契约，**有意分歧保留**） | L3 |
| node_modules 闭包 | 解包 node_modules/ 顶级清单（express 全家 + @img/sharp-win32-x64 系 + detect-libc + iconv-lite 等） | L3 |

## 四、四层实施设计

### L0 数据与工具基座（本仓，mac 可做，W0）

1. ~~数据勘误~~ ✅ 已随本设计落地（napi-functions.json 三段式 faces/added-44/missing-3 + 蓝图 §二改账）。
2. **生成器脚手架** `native/reverse/generate-win-rebuilt.py`：**不泛化** mac 生成器（两平台证据模型差异大：win 无符号表、注册表由 data JSON 驱动；mac 的 selftest/palette 内嵌不适合直接复用文件结构）。结构 = 固定实现区（现 ax_native_win.cc 0.6.3 语义底座整体迁入）+ 按批填充的新增实现区 + 注册表以 `data/win32-3.17.2-napi-functions.json` 驱动生成（96 面）。产物仍写 `src/ax_native_win.cc`（消费方零改动）。
3. **ghost 共享常量单一出处** `data/ghost-shared-constants.json`：从 generate-mac-rebuilt.py 内嵌表提取（palette 44 / motion 8 采样 / **geometry 14 键**〔2026-11-10 W0 复核勘误：原写 13 为设计笔误，JSON 实测 keys 14 项、经 mac 生成器 --verify 字节级闭环背书〕/ StableSessionIndex 探针表），双生成器消费同一 JSON（win 侧消费 W2 批接线，`generate-win-rebuilt.py` 留有 TODO(W2) 锚）——win ghost 与 mac ghost 是同一官方实现族，防双份漂移。
4. **探针** `tools/probe-one-win.cjs`：移植 mac probe-one 纪律（fresh-process 单例、timeout 包裹、官方 vs 自建同机同场对照、差异 JSON dump）；吸取 probe-raw 教训——原始 dump 不做深度归一（mac 上曾因 normalizer depth>6 摧毁树形）。
5. **字面量门**：换装前门=vendored 0.6.3 JS ↔ 官方 0.6.5 JS 族差分（已产 js-family-diff）；换装后门=自建 entry ↔ 官方 0.6.5（check-bundle-key-parity 输入换文本即可）。
6. **参照资产入仓**（gitignored，mac 先例=cua-helper-3.14.3-reference）：`native/reverse/reference/win32-0.6.5/` ← /tmp/cua-helper-win32-inspect/cua-helper（.gitignore 登记一行）。win 机开工时同仓自带参照。

### L1 addon 逆向重建（win 机主战场，三批，每批独立验收）

通用纪律：证据优先级 [S] 官方 0.6.5 addon strings（参数校验文案/错误码）→ 官方 0.6.5 entry JS 消费契约（可读未混淆）→ vendored 0.6.3 行为（老面语义）→ [E] 探针；行为对齐不追字节等价（README 既定边界，PrintWindow/BitBlt 先例）。构建 = node-gyp `--target=44.7.0 --dist-url=https://electronjs.org/headers`（VS2022 + SDK 10.0.26100 + cppwinrt 与官方同版），binding.gyp 已在 reverse/。

- **W1 批（追赶 3 + ABI 切换）**：实现 activateWindow / launchApplicationAsync / listInstalledApplicationsAsync（AUMID 激活链；行为直接对官方 0.6.5 探针——纯增量零移除，老面语义跨代未变的信心来自 removed=[] 与错误码 same 185）；全量 52 面在 electron 44 ABI 下重编。验收=内省 52/52 + 老面三套件（57 只读 + 28 写路径 + 123 矩阵 = 221 断言）在 win 机移植回归。
- **W2 批（mac 血统 22）**：ghost 16（GhostGroup 状态机/badge/palette/multi-session——mac 战役已还原的同族语义，常量走 L0.3 共享 JSON；win 渲染后端=逐函数 [S]/[E] 取证，[I] 面如实标注）+ pasteboard 4 + getWindowId + hasActiveInputHolds。验收=probe-one-win 对照 + ghost 肉眼（overlay/涟漪/badge/multi-session）。
- **W3 批（win 专属 22 深水区）**：按 JS 错误码族反推行为面逐域施工——
  - postMessage×5：窗口类指纹（UTF-16 表 10 族）→ 嵌入引擎分类学（embedded_chromium / embedded_chromium_wpf / winui3_exempt）→ 投递通道判定与 provenance 二次校验（错误码 delivery_unknown / dispatch_unproven / embedded_chromium_wpf / post_message…）；
  - UIA 模式梯×4：elementPatternCall/ValueRead/Readback/hitTestInvoke + provenance 校验（uia_ancestor / hit_test_entry / readback_job_unavailable / native_write_uncertain…）；
  - surface 域×7：enumerateSurfacesForFrame / frameWindowContext / getDispatchWindowId / getForegroundRootWindowId / getWindowId / restoreForegroundWindow / classifyPostMessageDelivery（前台保存-恢复与投递窗口解析）；
  - 杂项×8：captureWindowPngCompositeAsync（D3D11CaptureFramePool 双 worker——行为等价即可）、invokeAcceleratorAsync、scrollElement（官方 win 有真导出，element_scroll 走真路径非降级）、clickAtPointAsync/typeTextGlobalAsync（async 化补齐）、winAxElementFromToken/Release（元素句柄对，注意与既有 ref 注册表 `rt:<pid>:<runtimeIds>` 的关系取证）。
  - **JS 侧字面量余债量化（2026-11-10 W0 后对比实测）**：官方 win entry 独有 snake 字面量 59 个＝本域 JS 语义未还原面（delivery_unknown/dispatch_unproven/provenance 族/UIA 梯族/menu 族/root_wgc_plus_popup_wgc_premultiplied_composite 复合模式等；R8 记档的 delivery 轨迹框架/assertWindowsPhysicalAssociation/element_provenance 二次校验即其中主干）；官方 276 vs 我方 274，两向差各约 59/57——我方独有 57 为 mac 血统共享码+dev 面编译进 win 产物（死代码级形态差，W1 处置）。W3 各域施工时逐族消化，验收=官方独有清零（或逐项记档有意分歧）。

### L2 helper JS 还原线升级（本仓 TS 源可写 + node:test 可测，win 机只做 E2E）

**已完成盘点**（mac 战役顺带落在共享源，win 直接受益）：GHOST_SESSION_SCOPED_METHODS（nativeAxSource.ts:866）、scrollElement 能力门控（:847，mac addon 无导出→降级；win 有→真路径）、elementPatternCallAsync 优先（:903）、postMessage 路径 + ABI 缺失回退（electronInputHandlers.ts:1221-2814）、element_scroll 方法、IPC v3、错误码族、HELPER_GHOST_CURSOR_OVERLAY_ARG（helperConstants.ts:25）。

剩余 win 面（全部有官方 0.6.5 逐字锚，见 §三坐标表）：
1. **argv 面 0.6.5 化**：windowsDevHelperMain 的 parseWindowsDevHelperConfig 按官方 :34054-34090 逐字还原（allowedFlags 过滤 + positional===4 + ghost 双旗返回）；当前 4-arg 严格门是断代源之一。
2. **token 退场**：configSchema 去 token 字段；startBroker 调用去 authToken（前置验证项：我方 runHelper/brokerServer 共享源对 `authToken === undefined` 的路径——官方 entry 全文无 authToken，共享源必有无 token 分支，以官方 runHelper 定义核对补齐）。我方 host 侧多注入的 broker token env（62 轮 delta）对 token-less helper 无害，暂留。
3. **鉴权门同构**：WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN=true + 开门 stderr 告警 + assertPeerIdentityAuthCapable 的 PeerIdentityAuthGateError 文案（含 gateDetail 拼接进启动失败消息）。文案按改名豁免：品牌词 ZCode→Drora；env 键 `ZCODE_CUA_DEV_MODE` 是契约键**不改**（refresh-marker.ts pre 常量同源）。
4. **延迟原生初始化**：deferNativeSurface/deferredSystem（createDeferredSurface）+ runHelper 传 deferBackendInitialization:true + onTransportReady 里 loadNative→门校验→enableGhostCursorOnNative→setTarget；`transport_ready` 控制消息类型补进 WINDOWS_DEV_CONTROL_PROTOCOL。
5. **ghost 旗 plumb**：enableGhostCursorOnNative 等价（ghostSetEnabled + ghostSetMultiCursorEnabled，可选链——旧 addon 缺导出时 no-op 天然降级）。
6. **win 专属消费契约**：frameWindowContext/getDispatchWindowId/invokeAcceleratorAsync 等在 windowsSystemSurface / nodeAutomationAdapter 的调用面，从官方 entry 对应调用点提取（多数共享源已有特征探测骨架）。

**测试**（本仓即可）：restored-smoke 扩 win 用例；argv 契约（新 5-6 args 接受/旧坏参数仍拒）、token-less 启动、gate 文案、ghost plumb 的注入式断言（fake native）。**mac 无损**：全部共享源改动跑 mac 五测试链 + win32 tsc + node-repl-host build.mjs 零漂移（feedback-win32-no-break 纪律双向适用）。

### L3 换装与交付链（win 机）

1. **三件套换装**（= win 版裁定① 应用，mac 先例）：
   - `runtime/cua-helper/dist/windows-helper.js` ← 自建 entry（L2 源码 build.mjs/esbuild 产物）；
   - `runtime/cua-helper/build/Release/ax_native.node` ← L1 自建 96 面 addon（electron 44 ABI）；
   - `runtime/cua-helper/package.json` version → 0.6.5（droraCuaRuntime 契约块保留=有意分歧，登记台账）。
   - 仓内溯源：`native/ax_native_win.node` 入仓镜像自建产物（mirror mac ax_native_mac.node 模式），供 CI parity 与钉扎。
2. **runtime-manifest.json**（仓内 dev 探源记录）：packageVersion 0.6.5 / electronVersion 44.7.0 / 新 sha 双钉扎。产品 manifest 不消费它——`prepareWindowsCuaHelperAssets` 在 staging 重生成（用 electron-builder 实际 electronVersion）、签名后 `finalizePackagedWindowsCuaHelper` 重算哈希闭环。**staging/afterPack 链零改动预期，仅过验**。
3. **node_modules 闭包**：staging 从 workspace 收 express + sharp-win 系（resolveSharpRuntimePackageNames 已支持 win32-x64）。依赖前提核对：workspace 需可解析 `@img/sharp-win32-x64` + `@img/sharp-libvips-win32-x64`（optionalDependencies 安装态），对照官方闭包清单（§三）。
4. **版本一致性门**（W0 本仓做）：check-version-coherence.mjs 及全部硬编码 0.6.3 期望（grep 清单）→ 0.6.5。
5. **打包冒烟**：electron-builder win x64 全链（afterPack verifier：manifest 形状/PE machine/entry+addon 哈希/闭包/module type——已健全）+ 真机首用链（recipe fork→socket→authenticate v3→工具面冒烟→ghost 肉眼）。

## 五、施工序（W0-W4）

| 批 | 场地 | 内容 | 出口判据 |
|---|---|---|---|
| **W0** | 本仓 | ✅ **已完成（2026-11-10 收口，逐项勾销见下「W0 收口记录」）**：L0.1/2/3/5（换装前门）/6 + L2.1-L2.6 + 新增单测全落地；未达 1 项 = L0.4 probe-one-win（未建，随 win 机开工补）；版本门硬编码字面量经盘点重组为 W1 换装批原子项（见下「W1 换装批清单」） | 门禁逐项达成情况见「W0 收口记录」（本轮复跑 3 项 + 批次报告 7 项） |
| **W1** | win 机 | 追赶 3 实现 + electron44 ABI 重编 + 52 面探针 + **三件套换装** | fork 链 E2E（argv→socket→authenticate v3→工具冒烟）＝win CUA 复活，三断同修 |
| **W2** | win 机 | mac 血统 22（ghost 核心 16/pasteboard 4/getWindowId/hasActiveInputHolds） | probe 对照 + ghost 肉眼验收 |
| **W3** | win 机 | win 专属 22 深水区（postMessage/UIA 梯/surface/复合截图/async 补齐/scrollElement） | 逐域 probe 对照 + 错误码族行为面 |
| **W4** | win 机 + 本仓 | 96 面全量矩阵 + 221 断言移植全绿 + 字面量门 0 差 + 打包冒烟 + manifest/status 文档收口 | 验收矩阵全绿（§六） |

每批产物独立可验收、可回退（addon 纯增量 + JS 特征探测降级，任一批未达不阻塞已换装面）。

### W0 收口记录（2026-11-10，勾销依据）

**已落地项**（收口会话逐项实测复核，file:line 均为当日实测）：

- **L0.1 数据勘误** ✅：`data/win32-3.17.2-napi-functions.json` 三段式 faces 96/52/49 + delta added-44/removed-[]（§二改账）。
- **L0.2 生成器** ✅：`native/reverse/generate-win-rebuilt.py` 在仓。收口会话复跑 `--verify` 逐字节一致（产物 65976B，exit 0）、`--list-pending` 输出 W1=3 / W2=22 / W3=22、合计 47=96−49——`validate_data()` 全模式必过（napi 96/96 唯一、W1 恰等于 delta_repo_reverse_line_vs_vendored_0_6_3.missing、W2∪W3==added(44)）。
- **L0.3 ghost 共享常量** ✅：`data/ghost-shared-constants.json` 在仓，win/mac 双生成器同源消费（grep 实测：win 2 处 / mac 3 处引用）。
- **L0.5 字面量门（换装前门）** ✅：`data/win32-3.17.2-js-family-diff.json` 在仓；换装后门（自建 entry ↔ 官方 0.6.5，check-bundle-key-parity 输入换文本）定义上随 W1 起效。
- **L0.6 参照入仓** ✅：`native/reverse/reference/win32-0.6.5/` ← /tmp/cua-helper-win32-inspect/cua-helper（dist/build/node_modules/package.json/runtime-manifest.json 五项齐；批次会话 `cp -R` 后 `diff -rq` 退出 0=字节一致，24MB）；`.gitignore:84-85` 登记注释 + `packages/zcode-cua-helper/native/reverse/reference/`。参照 34337 行，只读。
- **L2.1 argv 面 0.6.5 化** ✅：`windowsDevHelperMain.ts:91-138` parseWindowsDevHelperConfig（allowedFlags={--ghost-cursor-overlay,--disable-multi-cursor-overlay} 先滤出、positional 恰 4、extras 拒绝、ghost 双旗条件展开），退出码 2=argv。
- **L2.2 token 退场** ✅：configSchema 无 token 字段、entry 全文 `authToken` 零出现（:83/:253 注释锚）。
- **L2.3 鉴权门同构** ✅：`PeerIdentityAuthGateError` :142 / `assertPeerIdentityAuthCapable` :145-152（品牌词 ZCode→Drora，env 键 `ZCODE_CUA_DEV_MODE` 契约键不改）、`WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN` 开门 stderr 告警 :242-249、gateDetail 拼接 :303-305（仅 PeerIdentityAuthGateError 拼后缀，退出码 1=gate/启动失败）。
- **L2.4 延迟原生初始化** ✅：`windowsDevHelperMain.ts:253-288`（deferBackendInitialization:true、onTransportReady 顺序=transport_ready 控制消息→loadNative→门校验→ghost→createSystemSurface→setTarget；未注入 startBroker 恒延迟）+ `helperMain.ts`（createDeferredBackend :469/:541、严格 ===true 才延迟 :231/:466）。
- **L2.5 ghost 旗 plumb** ✅：enableGhostCursorOnNative 等价（ghostSetEnabled?.(true) + ghostSetMultiCursorEnabled?.(!disable)，全可选链，旧 addon 缺导出 no-op 降级）。
- **L2.6 win 专属消费契约** ✅：可选链接线——`nodeAutomationAdapter.ts:144-168`（守卫域 ABI wrap：hasActiveInputHolds/activateWindow/getForegroundRootWindowId/frameWindowContext/restoreForegroundWindow 等）、`electronInputHandlers.ts:1363/:2760-2808`（frameWindowContext/classifyPostMessageDelivery 消费面 + 官方 classify fallback）。
- **追赶 3 的 JS 消费面（已有接线，W0 批不动）**：activateWindow wrap `nodeAutomationAdapter.ts:164`、surface 导出块 :928-931；消费者 `electronInputHandlers.ts:639-657` activateConcreteWindow（与官方 24635-24652 逐字一致，含 "atomically raised, focused, activated, and verified"）、windowsForegroundWindowGate :1208-1210（官方拒文案 "could not be brought to the foreground…"）。
- **新增单测** ✅：`test/win-entry-065-face.mjs`（L2.1-L2.5 逐面断言 + 产物字面量钉扎）；r3/r8 既有链在位。

**官方证据基座**（L2 入口，行号+字节偏移双锚，字节偏移为批次会话 `grep -bo` 实算）：parseWindowsDevHelperConfig@1345013、createDeferredSurface@1343453、configSchema@1344726、PeerIdentityAuthGateError@1346643、assertPeerIdentityAuthCapable@1346700、enableGhostCursorOnNative@1348932、runWindowsDevHelper@1349140、transport_ready@1350913、gate 常量@761722（WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN）。主源=仓内参照 `native/reverse/reference/win32-0.6.5/dist/windows-helper.js`（34337 行，只读）；契约文档 `data/win32-0.6.5-js-contract.md` E 节行号与该参照逐点复核一致。

**门禁达成**：
- 收口会话本轮复跑通过：win 生成器零漂移（`generate-win-rebuilt.py --verify` exit 0）、mac 生成器零漂移（`generate-mac-rebuilt.py --verify` exit 0，136 exports 逐字节一致）、新 win 入口测试（`node test/win-entry-065-face.mjs` 全绿 "ALL win-entry-065-face checks passed"）。
- 批次会话报告通过、收口会话未复跑（如实登记）：helper typecheck、helper 包测试（tsc+r3）、r8 输入守卫回归、zcode-cua 六链、node-repl-host 构建、services CUA 三件、architecture:check。

**未达项（如实）**：
- **L0.4 `tools/probe-one-win.cjs` 未落地**（收口会话全仓 find 无果）——win 探针纪律（fresh-process 单例/timeout 包裹/官方 vs 自建同机对照）随 W1 win 机开工移植；不阻塞换装（换装验收走 fork 链 E2E）。
- **版本门重组**（原 §四 L3.4 "W0 本仓做"）：盘点结论=全部硬编码 0.6.3 代码期望与 vendored 字节绑定（版本-字节一致性门 :604/:635/:638、sha256 双钉扎、注释配对语义），提前单改即失配，须随 W1 换装批原子翻转——清单登记见下节；W0 交付物=盘点分类 + 本设计登记。
- **盘点 bumpNow=true 共 9 条，经收口会话复核均为裁定/历史记录类，保留不改**（内容截至 W1 换装前仍为事实）：复核覆盖全仓 0.6.3 命中（排除 node_modules/upstream 冻结/reference/bundled-agents）——裁定记录类（specs/cua-3.17.2-alignment.md、specs/drora-divergence-ledger.md、specs/upstream-v3.16.1-migration.md 等）与历史报告类（glm-parity-pass27/28、upstream-sync、agent-team-feasibility、plugin-marketplaces 5a 节）的 0.6.3 表述今日仍为事实，改动即篡改裁定记录；唯一"现行状态"句 docs/cua-alignment-status.md:24 已由盘点定为随 W1 翻转（上表 #9）；其余命中为无关版本（iconv-lite@0.6.3，THIRD-PARTY-NOTICES.md:1427/:20152、third-party/inventory.json）或代码/测试 fixture（非文档类）。〔收口会话裁定，非盘点原文〕

### W1 换装批清单（随批执行）

三件套换装、runtime-manifest 重生成与 node_modules 闭包步骤**引用 §四 L3.1-L3.3 已有内容，不在此重复**。本清单为盘点出的随批版本期望（bumpNow=false：任何一项提前单改即与 vendored 字节/门禁失配，须与三件套同一批原子执行）：

| # | 位置 | 随批动作与依据 |
|---|---|---|
| 1 | `packages/zcode-cua-helper/runtime/cua-helper/package.json:3` | vendored 运行时包版本 0.6.3，与 manifest/字节同体；`windows-cua-helper-assets.mjs:604` 强校验 pkg.version===manifest.packageVersion，必须随 W1 换装批原子更新 |
| 2 | `packages/zcode-cua-helper/runtime/cua-helper/runtime-manifest.json:4,11-12` | packageVersion 0.6.3；:11-12 entry sha256 b8ee2bb9… / addon sha256 92533fe5… 直接绑定 vendored 字节——任何提前单改即失配，随 W1 整批换官方 0.6.5 manifest |
| 3 | `packages/desktop/scripts/windows-cua-helper-assets.mjs:604,635,638` | 版本-字节一致性门本身（无 0.6.3 字面量）：:604 pkg.version===manifest.packageVersion、:635/:638 sha256(entryBytes/addonBytes)===manifest；W1 以新字节+新 manifest 整批过门，W0 不动 |
| 4 | `packages/services/src/cua-permission-broker/windowsCuaDevRuntime.ts:294-332,552-565` | manifest 兼容门（无 0.6.3 字面量）：:294-332 校验 packageName/packageVersion 非空/arch/electronVersion===expected/sha256 形状，:552-565 校验 dev 包 version 非空；W1 注意 manifest.electronVersion 41.0.3→44.7.0 与宿主期望值联动，随换装批验证 |
| 5 | `packages/desktop/electron-builder.config.js:1021` | 注释『CUA helper 运行时(0.6.3,Electron 41.0.3 构建)』描述当前 vendored 字节事实，提前改注释即失真，随 W1 改写 |
| 6 | `packages/desktop/scripts/prepare-agent-node-bundle.mjs:613` | staging 注释『CUA helper 运行时(0.6.3)』同上描述现行字节，随 W1 |
| 7 | `packages/zcode-cua-helper/src/broker/server/helperMain.ts:177,293` + `nativeAxSource.ts:859` + `ghostCursorTurnLifecycle.ts:7` | 『配 0.6.3 addon 时透传原对象/可选链 no-op』行为配对注释：描述与现行 0.6.3 addon 的配对语义，W1 换 0.6.5 addon（ghost 面在场）后语义翻转，须随批复核改写 |
| 8 | `packages/desktop/src/main/cuaAccessibilitySettings.ts:207` | 『（0.6.3 原始形态）』还原类型注释，若 W1 后 installer 契约随 0.6.5 改形则同步，随批复核 |
| 9 | `docs/cua-alignment-status.md:24` | 现行状态板『win32 行为面 ⚠️ 维持 0.6.3（裁定③）』——live 状态记录，W1 落地时同步翻转，不提前改 |
| 10 | `scripts/upstream/classify-preservation.mjs:22` | D-frozen zone 判定文案『0.6.3 不随上游 0.6.5』（裁定③的机械化表述），W1 后随裁定更新复核 |
| 11 | `packages/desktop/bundled-agents/darwin-arm64/glm/packages/node-repl-host/scripts/build.mjs:41,52` | gitignored 生成物（.gitignore:12）内残留 0.6.3 切段引用（源 build.mjs 已指 0.6.5 段），重新 prepare 时自动对齐，**禁手改** |
| 12 | `packages/zcode-cua/upstream/zcode-cua-0.6.3.index.js`（文件名+内部 3 处）与 `zcode-cua-0.6.5.index.js`（内部 5 处） | 冻结官方切段资产，**零触碰**；0.6.3 段按 `specs/cua-3.17.2-alignment.md:41` 保留至 0.6.5 切段验收，处置随 W1 批裁定 |
| 13 | `scripts/architecture/upstream-snapshot.json:24216,24407` | 架构快照登记 runtime-manifest.json 与 0.6.3 切段的 mode+hash，W1 改字节后由架构工具再生成，不手改 |
| 14 | `packages/zcode-cua-helper/package.json:3`（附注，防误改） | 非 0.6.3 命中：helper 工作区包版本 0.6.1；win32 W1 换装对象是 runtime/cua-helper 的 vendored 包，此字段不在换装批内 |
| 15 | ✅ 已随 R10 认证模型换代提前解决（2026-11-10，判据已官方逐字化）——原记录：runHelper 的 pipSessionEnabled 判据口径差：我方 `Boolean(options.presentationAuthToken)`（mac 血统既有形态）vs 官方 0.6.5 `options.peerIdentityAuth === true`（W0 保真复审发现；行为面当前零差——win 两输入均缺省→false，peerIdentityAuth 字段全仓零调用方）。W1 换装 E2E 时按官方语义复核改判或记档有意分歧 |
| 16 | ✅ 已随 R10 提前解决（types.ts 已裁官方 43 双平台同表；22 个 3.11.2 血统超集已移除）——原记录：**win helper 方法表 65 vs 官方 win 43**：我方携 mac 血统全表（screen_size/get_skyshot 等 16 个 mac 面方法 + 6 个 pip_live_probe_*）；官方 win v3.1 已按攻击面瘦身 49→43（官方 entry :19750 墓碑注释实证，6 个探针方法整体删除）。官方 43 ⊆ 我方 65（used surface 零差），W1 换装时裁定：平台分表裁到 win 43 面，或保留超集并按上游对齐纪律记档有意分歧 |

**缓办项**（施工 notes 移交，随 W1 批消化）：接线员 W1+ 分类、复审未修 findings——接线缓办项与复审未修 findings 的全量明细见 `docs/cua-restoration-manifest.md` 第七十六轮（主会话收尾登记）。

## 六、验收矩阵

| 层 | 门 | 场地 |
|---|---|---|
| L0 | 数据 JSON 校验（96/96 唯一、44 增、3 欠账）；生成器 dry-run 注册面=目标面 | 本仓 |
| L2 | restored-smoke + 新 argv/gate/ghost 断言；mac 五测试链（restored-smoke/mac-launch-contract/adhoc/cua-tool-layer/services node-test）；win32 tsc + build.mjs 零漂移；架构三零 | 本仓 |
| L1 | 内省面逐批 52/74/96；probe-one-win 官方 vs 自建同场对照；221 断言移植回归；ghost 肉眼（W2） | win 机 |
| L3 | 换装后字面量门（自建 entry↔官方 0.6.5）0 差；runtime-manifest 三值一致；electron-builder win afterPack verifier 全绿；真机首用链 + ghost 肉眼 | win 机 |
| 全局 | `scripts/check-bundle-key-parity.mjs` 双向 0 退出码非 0 项；文档收口（manifest 轮次/status 矩阵 win 行转对齐） | 双场地 |

## 七、风险与注记

1. **官方开门态（安全注记，非裁决项）**：官方 0.6.5 win 生产 Helper 即"peer 身份门临时全开"（常量 true + stderr 告警 + token-less）——任何本地进程可驱动 CUA，仅管道命名空间 `\\.\pipe\` 为界。按官方形态权威如实还原并登记 `specs/drora-divergence-ledger.md`；如需自研硬化=独立用户裁决项，不混入对齐批。
2. **ghost win 渲染后端 [I] 面**：渲染通道（layered window/DComp）不可从 strings 完全取证，以 JS 消费 + 探针行为反推；[I] 标注如实留档（win 无 ghostMotion/GeometrySelftest 自检导出，自检覆盖窄于 mac）。
3. **复合截图**：D3D11 双 worker 允许实现差异（PrintWindow/BitBlt 先例），可观测契约（返回形状/错误码/fail-closed 行为）对齐即可。
4. **electron 联动**：desktop electron 再升 → addon 须按新 ABI 重编（manifest 由 staging 用真实 electronVersion 生成，天然跟随；addon 是唯一硬耦合）。
5. **arm64**：官方仅发 x64；manifest/verifier 已兼容 arm64，本轮 x64 only，arm64 随官方发布再启。
6. **vendored 0.6.3 行为探针宿主**：41 ABI addon 无法在 electron44 宿主加载——W1 起统一以官方 0.6.5 为行为参照锚（removed=[] + 错误码 same 185 支撑老面语义跨代未变假设；如探针发现老面行为漂移，即停批取证）。
