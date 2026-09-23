# ax_native 原生插件逆向产出

本目录是对 Computer Use Helper 原生插件二进制(`ax_native.node`)的逆向工程产出。
上游从未发布 C++/Objective-C 源码,以下内容全部由发行二进制的静态证据重建。

## 目录

| 路径 | 内容 |
| --- | --- |
| `win32-static-analysis.md` | win32 PE64 分析:导入表(实现路径证据)、JS 导出面、参数校验消息表、错误码、与 helper 契约的交叉验证 |
| `mac-static-analysis.md` | mac Mach-O 分析:源文件布局(5 个 .mm)、137 个 NAPI 入口全集、AsyncWorker 类、PiP 栈语义、5 个 ObjC 类 |
| `src/ax_native_win.cc` | win32 语义还原 C++ 源码(N-API 注册表 + 各能力域实现,逐段标注证据来源) |
| `data/win32-pe-analysis.json` | PE 导出表/导入表/符号(机器可读) |
| `data/win32-strings.txt` | win32 全部 ASCII 字符串(1260 条) |
| `data/mac-napi-functions.json` | mac NAPI 函数清单(96 匿名命名空间 + 41 file-static) |
| `data/mac-demangled-symbols.json` | mac demangle 后符号(1416 条) |
| `data/mac-objc-methods.txt` | mac ObjC 方法(137 个) |

## 证据链方法

每个还原结论按四级证据标注(见 `src/ax_native_win.cc` 头注):

- **[S] 字符串**:参数校验消息(如 `clickAtPoint(x, y, button, clicks, modifiers?) expects …`)
  直接编码了参数解析逻辑;注册属性名集合即 JS 导出面;错误码与结构键定义返回契约。
- **[I] 导入表**:win32 侧系统调用的确定性证据(SendInput、DXGI/D3D11、
  SHGetPropertyStoreForWindow、OpenProcessToken、OpenInputDesktop 等)。
- **[T] 消费契约**:helper 适配层 `src/native/win.ts`、`native/ax_native.d.ts`
  (117 导出接口声明,第一轮运行时内省产出)。
- **[E] 运行时实测**:与原版发行物 E2E 对齐观察到的实际返回值
  (如 `dpiAwarenessInfo` → `{awareness:2, per_monitor_v2:true, scope:"process"}`)。

mac 侧符号表完整保留(3700 符号),函数名/类名/方法名置信度最高;
win32 侧 release 剥离了符号,但 PDB 路径字符串证实上游源文件
`@drora/drora-cua/src/native/screen_capture_win.cc` 与单编译单元布局。

## 重编译与能力对齐(第五轮,2026-09-22)

`src/ax_native_win.cc` 已从报告级骨架推进为**可编译、能力对齐**的重建版:

- 编译:`node build-rebuilt.mjs`(node-gyp + VS2022,链接 user32/shell32/advapi32/
  ole32/oleaut32/uiautomationcore/dwmapi;node-addon-api 以 seed 依赖放本目录
  node_modules)。产物 `build/Release/ax_native_win.node`(约 240KB)。
- 验收:`node parity-native.mjs` —— 原版与重编译版双加载、57 项能力逐项对比,
  **57/57 MATCH**(只读套件):49 个导出面、18 项参数校验(TypeError 消息逐字)、
  displays/cursor/dpiAwarenessInfo/listApplications/listWindows/probeWindows
  (键形状 + 值/集合)、AX 错误路径、readElement round-trip(ref 注册表解析)、
  剪贴板互写互读(round-trip 且恢复用户剪贴板)、captureApp(invalid)→null、
  preventActivation 状态机。
- 行为对齐过程中的关键实测修正(全部有原版证据):TypeError(非带 code 的
  Error)、`{ok,axError}` 结果对象模式、bounds 数组形态、GetDpiForMonitor 在
  **shcore.dll**(非 user32)、进程级 PerMonitorV2 需在模块注册时设置、
  probeWindows 过滤 DWM cloaked 窗口而 listApplications 保留、cancel 输入返回
  布尔 true、isFocusStealPrevented 恒 false、ref 格式 `rt:<pid>:<runtimeIds>`
  且 readElement 经**元素注册表**(AddRef 保活,同构 mac 侧 StoreToken)解析。
- 与原版的实现差异(如实):截图走 PrintWindow/BitBlt(原版为 WinRT
  Graphics.Capture),返回同为合法 PNG Buffer;role 映射为 UIA
  ProgrammaticName 直译表。

## 写路径能力对齐(第七轮,2026-09-22)

`parity-native-full.mjs` 以受控记事本为目标,把**写路径能力**全部纳入端到端对齐
(**28/28 MATCH**;与只读套件合计 85 项):

- **captureApp 的真实语义是 AX 快照**(非截图):`{app, window, elements}`,
  elements 为整棵 UIA 子树的 **BFS 平铺、上限 400**(ZCode Electron 大树恰好
  触顶 400,explorer 206 未触);截图由 `captureWindow*`/`captureMonitor*` 承载。
- **截图三兄弟接真 WinRT Graphics.Capture 管线**(cppwinrt,与本机原版编译同版
  SDK 10.0.26100):本机 Win11 24H2 对未打包进程拒绝 item 创建,两边一致
  fail-closed(`{ok:false,error:"invalid_target"}` / null)— 同源失败对齐。
- **返回语义全面对齐**(原版实测):输入/操作类返回布尔(scrollAt 本机恒
  false、preventActivation 返回 false);AX 写成功返回 `{ok:true, axError:null}`;
  selectText 需三参 `(ref, start, end)`,单参 → illegal_argument;moveTo 用
  SetCursorPos 绝对像素。
- **交叉验证**:orig 写 setValue/typeTextGlobal → rest AX 读回(反之亦然),
  证明注入真实进入系统而非自说自话;剪贴板互写互读且恢复用户原值。

## 深层能力对齐(第八轮,2026-09-22)

`parity-native-full.mjs` 扩展到 **41 项**(与只读 57 项合计 **98 项,五轮连跑全绿**):

- **typeTextGlobal 用 KEYEVENTF_UNICODE 逐字符注入** —— 决定性发现:vk 路径
  (VkKeyScanW+SendInput)在中文 IME 下数字键被候选选字吞掉(实测固定丢 '1'),
  原版注入干净,证明其走 UNICODE 注入;修正后两边逐字符一致(含逐字符节奏
  防前台丢键)。
- **非法参数一律返回布尔 false**(mouseDown/Up 坏按钮、scrollAt 坏方向、drag
  坏按钮、pressKeyGlobal 空串)— 不抛 {ok,axError};modifier-only chord
  ("shift"/"ctrl")合法返回 true。
- **probeWindows 排除最小化窗口**(经典 -32000 坐标)与 DWM cloaked 窗口;
  listApplications 均不过滤(三条枚举策略:全量/cloak+minimized 过滤)。
- **captureApp 大树对齐**:Electron 窗口两边 BFS 平铺数量一致(主窗口触顶
  400)、首元素一致;AXPress 真实按压(菜单开合)形态一致;setValue 不可写
  元素 → action_unsupported;cancelInputHoldsForSession → false(与
  cancelPendingInputHolds → true 不同)。
- 错误参数第二矩阵(单参/坏按钮/坏方向/空串)全部 TypeError/布尔路径一致。
- 死代码清理:InspectPngContent/AckCaptureEpoch/ReleaseCaptureEpoch/
  CaptureAppAsync/PrintWindow 版截图函数移除(mac 面或被 WinRT 管线替代,
  原版 win32 导出面无此项)。

## 输入×输出全矩阵对齐(第九轮,2026-09-22)

`parity-native-matrix.mjs`(第三验收套件):49 个导出 × 123 种调用形态
(缺参/类型错/边界值/垃圾参数),原版与重编译版逐格比对(动态值函数做结构
归一)— **123 格结构差异 0**;三套件合计 **221 项断言全绿**。矩阵揭示的完整
输入输出契约(此前未知):

- **一半的导出根本没有参数校验**:activateApplication/isTargetElevated/
  captureWindowImage/captureWindowPngVerifiedAsync/captureMonitorPngAsync/
  applicationIconPngAsync/activateApplicationByAumid/performAction/setValue/
  setFocused/selectText/readClipboardTextAsync 等 —— 无效输入一律走失败路径
  (false / null / `{ok:false,axError:"illegal_argument"}`),不抛 TypeError。
  TypeError 仅出现在带 "(x) expects ..." 消息的那些函数(与字符串表一致)。
- **带参翻转函数**:isScreenCaptureSupported(带参 → false)、screenCaptureStatus
  (带参 → "unknown")、cancelInputHoldsForSession(带参 → true)。
- **reenableActivation 恒 true**(prevent 恒 false)。
- **截图三兄弟为发行物级 fail-closed stub**(任何输入恒 null /
  `{ok:false,error:"invalid_target"}`)—— 本进程 WinRT 管线实际可用(能截到
  帧),但原版发行物在同一进程环境下仍恒失败,证明 stub;对齐其可观测表现。
- **边界值**:clickAtPoint clicks<1 → false、modifiers 类型错 → false(不抛);
  holdKeyGlobal 负 duration → false;typeTextGlobal 空串 → false;
  elementAtPoint 元素空 Name → null(非空串);applicationInfoByAumid 空串
  参数 → null(不得与无 AUMID 的普通窗口互配)。
- **零尺寸窗口过滤**(真实运行暴露):shell 宿主的 0x0 弹出窗口(bounds 全 0)
  不出现在原版 probeWindows;这是窗口枚举的第四条排除规则(TOOLWINDOW /
  DWM cloaked / 最小化 -32000 / 零面积)。
- **挂死根因修复**:ShellExecuteExW 对无效 AUMID 同步弹 shell UI 阻塞(改
  ApplicationActivationManager);Sleep((uint32)-1) 长眠(负 duration 先判 false)。

## 还原边界(如实声明)

- `src/ax_native_win.cc` 是**语义还原**:结构、导出面、参数契约、系统调用路径
  与字符串/导入表证据一致;但结构体字段次序、UIA CacheRequest 精确属性集、
  PNG 编码器参数等字节级细节不可从导入表证实(需反汇编)。
- 官方 DigiCert 代码签名不可复现;重编译产物与原版二进制**不做字节等价声明**。
- win32 发行面是 0.5.13 的 Windows 子集(约 45 导出);mac 为全量(117 导出)。
  运行时仍使用原版二进制(`build/Release/ax_native.node`),本源码供阅读、
  审计与后续重编译实验,不参与 helper 构建。
