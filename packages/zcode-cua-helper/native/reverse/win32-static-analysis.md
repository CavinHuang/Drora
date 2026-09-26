# ax_native.node(win32)静态逆向分析

> 分析对象:`packages/zcode-cua-helper/build/Release/ax_native.node`
> (原样拷贝自 `D:\software\zcode\resources\tools\cua-helper\build\Release\ax_native.node`,
> PE64,387,480 字节,DigiCert G4 代码签名 + 2025 时间戳)。
> 提取手段:导出表/导入表(pefile)、字符串扫描;符号表在 release 构建中已剥离,
> 无 COFF 符号。本文所有结论均标注证据来源。

## 1. 模块形态

- 导出表仅 2 项:`napi_register_module_v1`、`node_api_module_get_api_version_v1`
  —— 标准 N-API(C) 原生模块,注册逻辑全部在 `napi_register_module_v1` 内
  通过 `napi_set_named_property` 完成(字符串表中可见该 API 名)。
- 编译器:MSVC(字符串含 `Base Class Descriptor at (`、`.?AV...` MSVC RTTI 名、
  `__CxxFrameHandler` 系列 SEH 符号风格)。
- C++ 标准库:静态链接(libc++ 风格的错误消息表:`bad function call`、
  `invalid hash bucket count` 等,即 MSVC STL 静态拷贝)。
- C++/WinRT 头库:RTTI 含 `winrt::hresult_access_denied/canceled/changed_state/
class_not_available/class_not_registered/illegal_state_change/invalid_argument/
no_interface/not_implemented/out_of_bounds/wrong_thread` 全套;引用
  `winrt/Windows.Foundation.h`、`winrt/Windows.Graphics.Capture.h`
  (Windows SDK 10.0.26100 cppwinrt 路径字符串)。
- 上游构建路径(PDB 字符串):
  `C:\Users\codegeex\gitlab-runner\builds\...\z-code\node_modules\@zcode\zcode-cua\src\native\screen_capture_win.cc`
  —— 证实上游为单编译单元 addon,源码位于 `@drora/drora-cua` 包的 `src/native/`,
  截图模块文件名为 `screen_capture_win.cc`。

## 2. 导入表(实现路径的直接证据)

| DLL                   | 关键导入                                                                                                                            | 还原出的实现路径                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| USER32                | `SendInput`、`GetCursorPos`、`SetForegroundWindow`、`BringWindowToTop`、`ShowWindow`、`AttachThreadInput`、`VkKeyScanW`             | 坐标输入注入(点击/滚动/拖拽/键盘),chord 解析后经 SendInput;前台切换走 AttachThreadInput+SetForegroundWindow                                                      |
| USER32                | `EnumWindows`、`GetWindowThreadProcessId`、`GetWindowRect`、`GetWindowTextW`、`IsWindowVisible`、`IsIconic`、`GetWindowLongW`       | `listWindows` / `applicationInfo` / window_id↔pid 归属                                                                                                           |
| USER32                | `EnumDisplayMonitors`、`GetMonitorInfoW`、`GetSystemMetrics`                                                                        | `displays` 返回显示器拓扑(bounds/scale_factor,字符串见 `scale_factor`)                                                                                           |
| USER32                | `OpenClipboard`/`GetClipboardData`/`SetClipboardData`/`EmptyClipboard`/`CloseClipboard`/`IsClipboardFormatAvailable`                | `readClipboardTextAsync` / `writeClipboardTextAsync`                                                                                                             |
| USER32                | `OpenInputDesktop`、`GetThreadDesktop`、`GetUserObjectInformationW`、`CloseDesktop`                                                 | `isInteractiveSession`:输入桌面隔离检测(屏保/UAC 安全桌面下拒绝驱动输入)                                                                                         |
| USER32                | `GetAwarenessFromDpiAwarenessContext`、`SetThreadDpiAwarenessContext`、`AreDpiAwarenessContextsEqual`、`SetProcessDPIAware`         | `dpiAwarenessInfo`(E2E broker_info 实测 `{awareness:2, per_monitor_v2:true, scope:"process"}`)与坐标 DPI 归一                                                    |
| SHELL32               | `SHGetPropertyStoreForWindow`、`SHCreateItemFromParsingName`                                                                        | AUMID 面:`activateApplicationByAumid`、`applicationInfoByAumid`(窗口 property store 读 `System.AppUserModel.ID`)                                                 |
| ADVAPI32              | `OpenProcessToken`、`GetTokenInformation`、`GetSidSubAuthority(Count)`、`IsValidSid`                                                | `isTargetElevated`(token elevation)、SID 组分解                                                                                                                  |
| KERNEL32              | `OpenProcess`、`QueryFullProcessImageNameW`、`K32GetModuleFileNameExW`、`ProcessIdToSessionId`、`GetCurrentProcessId`               | `processExecutablePath`、pid 校验、会话隔离判断                                                                                                                  |
| d3d11                 | `D3D11CreateDevice`、`CreateDirect3D11DeviceFromDXGIDevice`                                                                         | Windows.Graphics.Capture 截图管线的 D3D 设备创建(C++/WinRT interop)                                                                                              |
| ole32/OLEAUT32        | `CoInitializeEx`、`CoCreateInstance`、`CoCreateFreeThreadedMarshaler`、`SafeArray*`、`CreateStreamOnHGlobal`/`GetHGlobalFromStream` | COM 初始化(UIAutomation 为运行时 `LoadLibraryExW`+`CoCreateInstance` 动态解析,导入表无 UIAutomationCore —— IID 以二进制 GUID 嵌入);SafeArray 用于剪贴板/ VARIANT |
| api-ms-win-core-winrt | `RoGetActivationFactory`、`RoOriginateLanguageException`                                                                            | WinRT 激活(Windows.Graphics.Capture.\*)与错误传播                                                                                                                |

UIAutomation 证据(间接):控制类型字符串 `TabItem`、`editable`,以及
`elementAtPoint`/`readElement`/`performAction`/`setValue`/`selectText`/`setFocused`
等 AX 导出名与 `invalid_element`、`has_menu`、`scroll_into_view`(action 名)字符串。

## 3. JS 导出面(注册属性名字符串 + 参数校验消息)

从 rdata 字符串提取的注册名与各自的参数契约消息(消息原文即参数解析逻辑):

| 能力域    | 导出                                                                                                                                                                                                                 | 参数校验消息(原文)                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 应用/窗口 | `listApplications` `listWindows` `applicationInfo` `applicationInfoByAumid` `activateApplication` `activateApplicationByAumid` `applicationIconPngAsync` `processExecutablePath`                                     | `applicationInfo(pid) expects a number`;`applicationInfoByAumid(aumid) expects a string`                                                                                                                                                                                                                                                                                                                                    |
| AX/UIA    | `elementAtPoint` `readElement` `performAction` `setValue` `selectText` `setFocused`                                                                                                                                  | `elementAtPoint(x, y) expects two numbers`;`readElement(ref) expects a string`                                                                                                                                                                                                                                                                                                                                              |
| 输入注入  | `moveTo` `clickAtPoint` `scrollAt` `mouseDown` `mouseUp` `typeTextGlobal` `pressKeyGlobal` `keyDownGlobal` `keyUpGlobal` `holdKeyGlobal` `holdKeyGlobalAsync` `cancelPendingInputHolds` `cancelInputHoldsForSession` | `moveTo(x, y) expects two finite numbers`;`clickAtPoint(x, y, button, clicks, modifiers?) expects two numbers, a button string, a click count, and an optional modifiers chord`;`scrollAt(x, y, delta, direction) expects three numbers and a direction`;`mouseDown(button) expects a button string`;`pressKeyGlobal(text) expects a key chord string`;`holdKeyGlobal(text, durationMs) expects a key chord and a duration` |
| 焦点策略  | `preventActivation` `reenableActivation` `isFocusStealPrevented`                                                                                                                                                     | ——                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 截图      | `captureApp` `captureMonitorPngAsync` `captureWindowImage` `captureWindowPngVerifiedAsync` `screenCaptureProbeWindows` `screenCaptureStatus` `isScreenCaptureSupported` `inspectPngContent`                          | `captureApp(pid) expects a number`                                                                                                                                                                                                                                                                                                                                                                                          |
| 剪贴板    | `readClipboardTextAsync` `writeClipboardTextAsync`                                                                                                                                                                   | `writeClipboardTextAsync(text) expects one string`                                                                                                                                                                                                                                                                                                                                                                          |
| 环境/信任 | `isTrusted` `probeAccessibility` `probeAccessibilityStatus` `isInteractiveSession` `isTargetElevated` `displays` `cursorPoint` `dpiAwarenessInfo` `startupError`                                                     | ——                                                                                                                                                                                                                                                                                                                                                                                                                          |

注:win32 发行面为 0.5.13 的 Windows 子集(约 45 个导出);mac 发行面为全量
(117 个,含 pip/ghost)。mac 独有:`pip*`、`ghost*`、`*ToPid*`、`*ToWindow*`、
`*Verified*`、`getPeerCredentials`、`verifyProcessCodeSignature*` 等。

## 4. 错误码与结构键(字符串证据)

- 错误码:`invalid_data` `invalid_element` `invalid_target` `action_unsupported`
  `cannot_complete` `target_changed` `capture_failed` `device_lost` `encode_failed`
  `write_failed` `too_large` `api_disabled` `unknown startup failure`
- 结构键:`ownerPid` `ownerName` `ownerBundleId` `ownerActive`(elementAtPoint 的
  owner 归属四元组)、`window_id` `windowId`、`bounds`、`scale_factor`、
  `per_monitor_v2`、`has_menu`、`onScreen`、`bundle_id`、`editable`、`startupError`
- 键盘 chord 词表:`ctrl`、`meta`(win 键)、`capslock`/`pagedown`(变体名)、`Enter`、`Tab`

## 5. 与 helper TS 层的契约交叉验证

`packages/zcode-cua-helper/src/native/win.ts`(适配层)确认返回形状:

- app:`{pid, bundle_id(=exe 路径), name, active, aumid, icon_png}`,
  且 `ApplicationFrameHost.exe` 的 executable_path 被置 null(UWP 壳进程);
- element:`{ref, role, title, value, bounds, enabled, focused, editable, actions, has_menu, ownerPid, children?}`;
- window:`{title, bounds, window_id, main, focused}`。

E2E 实测(与原版发行物 broker_info 对齐)证实 `native_dpi_awareness`、
`accessibility_bridge:"native_ax"`、`capabilities.ax_observation:true`。

## 6. 结论与还原边界

- 结构、导出面、参数契约、系统调用路径均可高置信还原(见 `src/ax_native_win.cc`)。
- 无法从二进制还原的字节级细节:SendInput 结构的精确字段次序、UIA CacheRequest
  的精确缓存属性集、PNG 编码参数(推测 GDI+/WIC,导入表无独立编码 DLL,
  走 WIC(`SHCreateItemFromParsingName`/WinRT interop)或内置 stb 风格编码 —— 待反汇编确认)。
- 官方签名(DigiCert)不可复现;还原源码重编译产物与原版二进制不做字节等价声明。
