# win32 CUA 0.6.5 对齐分析与施工蓝图（2026-11-10）

> 参照锚：`cua-helper.zip` = 官方 `@zcode/zcode-cua` **0.6.5 win32-x64** 运行时
> （runtime-manifest 自带 SHA-256 与实测一致；electron 44.7.0；构建 2026-11-02）。
> 裁定③：win32 实施由用户在 win 机器执行；本文=数据基座 + 逆向策略 + 施工序设计。
> 关联：specs/cua-3.17.2-alignment.md（mac 战役方法论）、specs/drora-rename.md（改名豁免）。

## 一、数据基座（本轮已产，native/reverse/data/）

| 文件 | 内容 |
|---|---|
| win32-3.17.2-napi-functions.json | **94 导出面**定谳名单 + 对我仓 0.6.3 面（49）增量（方法=PE 字符串∩(mac136∪旧面∪helper JS 引用)；PE 符号已剥离无 nm 途径，win 无 mac 的 demangle 通道） |
| win32-3.17.2-pe-analysis.json | PDB 路径（gitlab-runner d5-EUcYuG）、上游 `src/native/screen_capture_win.cc` 系、C++/WinRT 2.0.250303.1、SDK 10.0.26100、**UTF-16 窗口类指纹族**（Chrome_WidgetWin_/CefBrowser/HwndWrapper/TkTopLevel/gdkWindow/gdkSurface/WinUIDesktopWin32WindowClass/ApplicationFrameWindow/CoreWindow）、内嵌引擎分类学（embedded_chromium(_wpf)/wpf/tk/gtk/vcl/winui3_exempt）、D3D11 复合截图 worker 族 |
| win32-3.17.2-js-family-diff.json | vendored 0.6.3 vs 官方 0.6.5 helper JS 四族差分 |
| win32-3.17.2-strings.txt | 全量字符串 dump |

**坑（本轮新增）**：窗口类指纹是 UTF-16LE 字面量，ASCII strings 扫描不命中，必须双编码扫描。

## 二、差距总账（0.6.3 vendored → 0.6.5 官方）

- **JS 引擎**：986KB→1,354KB；IPC **v2→v3**（与 mac 同款断代坑：切段 v3 客户端配 v2 runtime 必互拒——win 换装必同步）；BROKER_METHODS 42→43 唯一增 `element_scroll`（与 mac 同步）；argv +2（--ghost-cursor-overlay/--disable-multi-cursor-overlay）；GHOST_SESSION_SCOPED_METHODS win 版 50 元素在树；**错误码 +83**＝win 侧行为面地图（G1-G3 守卫族 win 形态：window_gone/window_identity_unverified/window_source_unavailable/activation_failed/input_hold_active/text_truncated/text_injection_failed/element_focus_unavailable + win 专属投递/UIA 域：delivery_unknown/post_message/uia_ancestor/operation_association/xaml_accelerator_entry/menu_* 族/provenance 族/embedded_chromium_wpf）；envKeys 11 键零增删。
- **addon 面 52→96（2026-11-10 勘误定谳）**，增量 44 纯增零移除，五类：①**ghost 核心 16**（非 mac 专属，win 也带 native 面；win 无 ghostMotion/GeometrySelftest 两个自检导出，mac 血统同族其余 16 全在）；②**pasteboard 4**；③**win 专属 postMessage 投递 5**（Click/Drag/Scroll/Char/Key Async）；④**读回/模式梯与 surface 域 11**（elementPatternCallAsync/elementValueReadAsync/setValueReadbackAsync/hitTestInvokeAtPointAsync/classifyPostMessageDelivery/winAxElementFromToken(Release)/frameWindowContext/getDispatchWindowId/getForegroundRootWindowId/getWindowId/restoreForegroundWindow/enumerateSurfacesForFrame）；⑤杂项 8（captureWindowPngCompositeAsync/hasActiveInputHolds/invokeAcceleratorAsync/scrollElement/clickAtPointAsync/typeTextGlobalAsync + winAx 对已在④）。**注意三面账**：官方 0.6.5=96、vendored 0.6.3 官方=52、我方还原线=49——还原线还欠 vendored 0.6.3 就有的 3 个（activateWindow/launchApplicationAsync/listInstalledApplicationsAsync，0.5.13 期参照遗留欠账）。原「49→94/added 24」为扫描漏账（ghost/pasteboard 等 23 名漏计），详见 data/win32-3.17.2-napi-functions.json 勘误注。
- **形态**：electron 41.0.3→44.7.0；node_modules 栈 express 系 + @img/sharp-win32-x64 + detect-libc（win 版清单门要覆盖）。

## 三、逆向策略与生成器扩展设计

1. **生成器化优先**（mac 教训直接移植）：不手改 `src/ax_native_win.cc`（mac 两起手编残体事故教训）——新建 `generate-win-rebuilt.py`（或把 generate-mac-rebuilt.py 泛化为 `--platform` 双出口），固定实现区 + 按 data/win32-3.17.2-napi-functions.json 生成注册表。0.6.3 还原底座（ax_native_win.cc 57/57 parity 线）作为实现区的起点整体迁入。
2. **[E] 探针纪律须在 win 机**：win addon 无法在 mac 运行；把 mac 的 probe-one 纪律（fresh-process 单例 + timeout + 官方同场对照）移植成 `probe-one-win.cjs`，官方 addon 与 rebuilt 同机对跑。**mac 可代跑的门**：两代 helper JS 的字面量族差分（check-bundle-key-parity 输入是 JS 文本，win vendored 与官方 0.6.5 均可离线比对）。
3. **win 专属深水区**（按 JS 错误码族反推行为面）：postMessage 后台投递（窗口类指纹→投递通道判定）、UIA 模式梯（elementPatternCall/ValueReadback/hitTestInvoke）、provenance 二次校验、复合截图（D3D11CaptureFramePool+双 worker）、AUMID 激活链。每域先 JS 侧消费契约（windows-helper.js 可读未混淆）后 native。
4. **品牌面**：win 同样走 ZCODE_→DRORA_ 改名豁免规则；`dev.zcode.cua-helper` 身份族对应 win 侧 launcher/peer 门待 win 机取证。

## 四、施工序（win 机，建议 W0-W5）

- **W0**：参照资产入 win 机 + probe-one-win 基座 + 字面量门基线（JS 族差分已给）
- **W1**：注册面 94 + 参数校验器（[S] strings，含 0.6.5 新面的 TypeError 文案——从官方 addon strings/win JS 引用双源提取）
- **W2**：老面 49 行为保持（0.6.3 底座回归）
- **W3**：mac 血统增量 22（ghost 核心/应用枚举/捕获门控——同 mac 战役证据法）
- **W4**：win 专属域（postMessage 5/读回梯/复合截图/操作场景）+ 守卫链（错误码 +83 的 JS 侧对应——win helper JS 同样需 vendored 0.6.3→0.6.5 还原，那才是 [S] 主源）
- **W5**：换装（vendored runtime 0.6.3→0.6.5 + 自建 addon 钉扎 + IPC v3 配套 + electron 44.7.0 + node_modules 清单门 + prepare-windows-cua-helper.mjs 对接 + 打包冒烟）

每批验证=探针矩阵 + 字面量门 + win 侧测试链（restored-smoke 等在 win 机跑）；共享模块改动仍跑 mac 无损套件。

## 五、与 mac 线的联动

- win helper JS 换 0.6.5 后 IPC v3/element_scroll/ghost 会话域与 producer 切段（全平台同 bundle）自动对齐；`DRORA_CUA_WIN_HELPER_RECIPE` 桥接（R7.5 后仅 ZCODE_ 名）待 win fork 链实测。
- mac 线已记档项（StableSessionIndex 兜底等）在 win 侧按 win 实测独立判定。
