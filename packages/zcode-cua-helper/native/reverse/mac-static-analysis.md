# ax_native_mac.node(macOS)静态逆向分析

> 分析对象:`packages/zcode-cua-helper/native/ax_native_mac.node`
> (原样拷贝自发行物,Mach-O arm64 dylib,937,936 字节)。
> 与 win32 版不同,mac 发行物保留了**完整符号表**(3,700 个符号),
> 本报告全部结论来自符号表 demangle + 字符串扫描,置信度高。

## 1. 源文件布局(全局构造器符号)

| 源文件 | 职责(依符号推断) |
| --- | --- |
| `ax_macos.mm` | 主体:AX(UIA 等价物 Accessibility API)、应用/窗口枚举、AX 元素读写、输入注入、信任探测 |
| `background_input_macos.mm` | 后台(pid/window 定向)输入:`BackgroundInputWorker`、`begin/endBackgroundWindowInput*`、`QueueBackgroundInput`、`LegacyBackgroundInputRejected` |
| `ghost_cursor.mm` | 虚拟光标覆盖层:`GhostInit/Show/Hide/Move/MoveTarget/ClickRipple/RenderPng/SetCapture/SetControllerStatus/SetEnabled/State`、`OptionalGhostTarget*` |
| `pip_window.mm` | PiP 画中画窗口:`ZcPip*` ObjC UI、`Pip*` NAPI 面、事件 tap 交互 |
| `window_event_mask_macos.mm` | 窗口事件掩码(AXManualAccessibility / 事件观察) |

上游包路径与 win32 相同(`@zcode/zcode-cua/src/native/`),构建为单 dylib。

## 2. NAPI 入口全集(137 个 C++ 函数)

### 2.1 匿名命名空间(96 个,`ax_macos.mm` 主体)

应用/窗口:`ListApplications` `ApplicationInfo` `ApplicationIconPngAsync`
`ListWindows` `GetWindowId` `ActivateApplication` `ActivateWindow`
`OpenApplicationInBackground(Async)` `TerminateApplicationVerified`
`ActivateAppFrameSurface` `Displays` `CursorPoint`

AX 读写:`ElementAtPoint` `ReadElement` `ResolveRef` `PerformAction` `SetValue`
`SelectText` `SetFocused` `ClickElementAtPoint` `PolicyIdentityAtPoint`

全局输入:`ClickAtPoint` `MoveTo` `Drag` `ScrollAt` `MouseDown` `MouseUp`
`PressKeyGlobal` `TypeTextGlobal` `HoldKeyGlobal(Async)` `KeyDownGlobal` `KeyUpGlobal`
`CancelPendingInputHolds` `CancelInputHoldsForSessionNapi`

定向输入(pid/window,verified 带 bundle 校验):`ClickToWindow(Async)` `DragToPid`
`DragToWindow(Async)` `HoldKeyToPid` `HoldKeyToPidVerified` `MouseDownToPid`
`MouseDownToWindow` `MouseDownToWindowDetailedAsync` `MouseUpToPid` `MouseUpToWindow(Async)`
`MoveToPid` `MoveToWindow(Async)` `PressKeyToPid` `PressKeyToPidVerified`
`ScrollToPid` `ScrollToWindow(Async)` `TypeTextToPid` `TypeTextToPidVerified`

截图取证:`CaptureApp(Async/Diagnostic)` `CaptureWindowImage(Verified/Async)`
`InspectPngContent` `AckCaptureEpoch` `ReleaseCaptureEpoch`
`ScreenCaptureProbeWindows` `ScreenCaptureStatus` `RequestScreenCaptureAccess`

信任/权限:`IsTrusted` `ProbeAccessibility` `ProbeAccessibilityStatus` `PromptTrust`
`ReadTccDbGranted` `VerifyProcessCodeSignature(WithAuditToken)` `GetPeerCredentials`
`IsFocusStealPrevented` `PreventActivation` `ReenableActivation`

后台输入:`BeginBackgroundWindowInput` `BeginBackgroundWindowInputDetailed(Async)`
`EndBackgroundWindowInput(Async)` `QueueBackgroundInput` `LegacyBackgroundInputRejected`

内部工具(NAPI 签名):`ParseWindowTarget` `ParseOptionalKeyboardWindowId`
`ParseOptionalDimension` `ProjectFrameContentForTest`

### 2.2 file-static(41 个,`pip_window.mm` / `ghost_cursor.mm`)

PiP:`PipStart(Verified/VerifiedAsync/VerifiedCompositeAsync)` `PipStop(StopTarget)`
`PipSetActiveGroup` `PipFreezeGroup` `PipGetLeadTarget` `PipBeginTurn` `PipTaskCompleted`
`PipClearDismissed` `PipDismiss` `PipIsDismissed` `PipIsRunning` `PipIsInteractionReady`
`PipSetEnabled` `PipStackCount`(JS 面)+ 测试钩子
`PipSimulate*`(TimeoutDrainRecovery / PersistentCaptureFailures /
UserInputDisableReleaseRace / ForeignContinuationPassThrough /
SyntheticAdmissionTimeoutFencing / SyntheticReservationInterleaving)、
`PipStartInteractionTestPanel` `PipMoveInteractionTestPanelToPoint`
`PipSampleInteractionOwnershipAtPoint` `PipGetStackTargets` `PipGetWindowBounds`
`PipEvaluateDoubleClickActivation` `PipVerifyInitialHitSurface`
`PipSetLiveLegacyCaptureDelay` `PipGetLiveLegacyCaptureDiagnostics`

Ghost:`GhostInit` `GhostShow` `GhostHide` `GhostMove` `GhostMoveTarget`
`GhostClickRipple` `GhostRenderPng` `GhostSetCapture` `GhostSetControllerStatus`
`GhostSetEnabled` `GhostState`

## 3. 内部结构(符号证据)

- **Napi::AsyncWorker 子类**:`ApplicationIconWorker`、`BackgroundInputWorker`、
  `InputWorker`、`VerifiedPipStartWorker`(各含 `Execute/OnError/OnOK`)。
- **AX 基础设施**:`RetainedAxElement`(引用句柄,`StoreToken(__AXUIElement, int, optional<uint64_t>)`
  —— ref token 注册表)、`ResolveRef`、`CopyActions`、`CopyDictionaryInt64`、
  `FreshAXIsTrusted`、`RunAccessibilityProbe`(lambda 接 `NSRunningApplication`)、
  `LiveFrontmostPid`、`AutoHidePointer`。
- **截图取证状态**:`AxCaptureDiagnosticState`(按 `uint64_t` epoch 键的
  `unordered_map`,`AckCaptureEpoch`/`ReleaseCaptureEpoch` 管理生命周期)。
- **输入串行化**:`unordered_map<int, shared_ptr<timed_mutex>>`(pid → 输入 hold 锁)、
  `unordered_map<int, vector<uint64_t>>`(pid → 活跃 hold token)、
  `vector<pair<int,uint64_t>>`(释放序)。
- **几何/编码**:`BoundsToJs(Env, CGRect)`、`BoundsArray`、`EncodeImage(Env, CGImage,
  string, double)`(格式 + scale)、`FillAppInfo(Env, Object, int)`。
- **PiP 栈语义**(file-static):`PipStackPushFront/Remove/Contains/PromoteImmediately/
  PromotePanel/SchedulePromotePanel/ApplyStackCascadeOffset/SetPublishedBounds`、
  `PipGroupIsActive(NSString*)`、`PipTargetKey(int, uint32_t, NSString*)`、
  `PipRunOnMainSync(block)`、`PipInteractionEventCallback(CGEventTapProxy, CGEventType,
  CGEvent, void*)`、`PipIsTargetDismissed`、`PipClearTargetDismissalsForGroup`、
  `PipFindPanelForVerifiedPresentation`、`PipStopAllPanels`。

## 4. Objective-C 类(5 个,137 个方法)

| 类 | 职责 | 代表方法(符号) |
| --- | --- | --- |
| `ZCodeOneShotStreamOutput` | ScreenCaptureKit/AVSampleBuffer 一次性流输出 | `stream:didOutputSampleBuffer:ofType:`、`stream:didStopWithError:`、`frameHandler`/`errorHandler` |
| `ZcPipController` | PiP 面板控制器(交互世代/可见性世代语义) | `acceptsGeneration:`、`acceptsInteractionGeneration:`、`acceptsInteractionVisibilityEpoch:`、`enqueueImageForPresentation:generation:`、`enqueueInteractionDeltaX:deltaY:visibilityEpoch:`、`commitInteractionMonitorForGeneration:panelWindowId:bounds:`、`activateTargetForDoubleClick`、`expectedPid`/`expectedBundleId` |
| `ZcPipImageView` | 帧渲染视图 | —— |
| `ZcPipCloseButtonView` | 关闭按钮(自绘) | `drawRect:`、`hitTest:`、`setHover:` |
| `ZcPipCompletionBadgeView` | 完成徽章(自绘) | `drawRect:`、`hitTest:` |

## 5. 结论

mac 发行面为全量功能(117 JS 导出);win32 发行面为其 Windows 子集(约 45 个,
见 `win32-static-analysis.md` §3)。两侧共享同一上游包
(`@zcode/zcode-cua/src/native/`),平台差异:
win32 用 UIAutomation(COM 动态解析)+ SendInput + DXGI/WinRT 截图;
mac 用 AX API + CGEvent + ScreenCaptureKit/AVFoundation + 自绘 NSView。
