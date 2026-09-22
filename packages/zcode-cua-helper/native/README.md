# ax_native 逆向说明

本目录的 `ax_native_mac.node` 是 macOS 侧原生插件副本（C++ / Napi + Objective-C）；
Windows 侧同名插件位于 `build/Release/ax_native.node`（helperAddonLoader 的 in-tree 路径）。
原生插件是 Computer Use Helper 的平台能力底座，
承载所有需要原生能力的功能面。本目录的 `ax_native.d.ts` 是对其 **117 个 JS 导出**
的完整接口声明，与运行时枚举结果 1:1 对齐（校验脚本见 `tools/`）。

## 逆向方法

| 手段                                | 产出                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| 运行时内省（require + Object.keys） | 117 个导出函数名（完整 JS 面）                                                  |
| `nm` + `c++filt` demangle           | 55 个 C++ 函数（Napi::CallbackInfo 签名）、ObjC 类                              |
| strings / 消息面                    | 信任模型（trusted / warm / untrusted / denied）、AXManualAccessibility 属性写入 |
| helper 源码调用点交叉比对           | 各函数的参数形状与返回语义                                                      |

## 能力域分组（117 个导出）

| 能力域                                                     | 代表导出                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 权限与信任（TCC / 代码签名）                               | `probeAccessibility` `probeAccessibilityStatus` `isTrusted` `promptTrust` `requestScreenCaptureAccess` `screenCaptureStatus` `readTccDbGranted` `verifyProcessCodeSignature` `verifyProcessCodeSignatureWithAuditToken` `getPeerCredentials`                                                                                                                                                |
| 应用与窗口                                                 | `listApplications` `listWindows` `applicationInfo` `activateApplication` `activateWindow` `openApplicationInBackground(Async)` `terminateApplicationVerified` `getWindowId` `displays` `cursorPoint` `activateAppFrameSurface`                                                                                                                                                              |
| AX 元素读写                                                | `elementAtPoint` `readElement` `clickElementAtPoint` `performAction` `setValue` `selectText` `setFocused` `policyIdentityAtPoint`                                                                                                                                                                                                                                                           |
| 输入注入（全局 / pid / 窗口，verified 变体带 bundle 校验） | `clickAtPoint` `clickToWindow(Async)` `mouseDown/Up(ToPid/ToWindow/...)` `moveTo(Pid/Window/Async)` `drag(ToPid/ToWindow/Async)` `scrollAt/ToPid/ToWindow(Async)` `keyDown/UpGlobal` `pressKeyGlobal/ToPid/ToPidVerified` `typeTextGlobal/ToPid/ToPidVerified` `holdKeyGlobal/ToPid/ToPidVerified` `cancelPendingInputHolds` `cancelInputHoldsForSession` `begin/endBackgroundWindowInput*` |
| 截图与栅格取证                                             | `captureApp(Async/Diagnostic)` `captureWindowImage(Verified/Async)` `applicationIconPngAsync` `inspectPngContent` `ackCaptureEpoch` `releaseCaptureEpoch` `screenCaptureProbeWindows`                                                                                                                                                                                                       |
| 虚拟光标覆盖层                                             | `ghostInit/Show/Hide/Move/MoveTarget/ClickRipple/RenderPng/SetCapture/SetControllerStatus/SetEnabled/State`                                                                                                                                                                                                                                                                                 |
| PiP 画中画                                                 | `pipStart(Verified/Async/CompositeAsync)` `pipStop/StopTarget` `pipSetActiveGroup` `pipFreezeGroup` `pipGetLeadTarget` `pipBeginTurn` `pipTaskCompleted` `pipClearDismissed/Dismiss/IsDismissed/IsRunning/IsInteractionReady/SetEnabled/StackCount`                                                                                                                                         |
| 对端凭据                                                   | `getPeerCredentials`（socket fd → uid/pid/audit_token）                                                                                                                                                                                                                                                                                                                                     |

## 深度逆向产出

完整的静态逆向产出（win32 PE 分析、mac Mach-O 符号全量清单、语义还原 C++ 源码
`src/ax_native_win.cc`、机器可读证据档案）见 [`reverse/`](./reverse/)。

## 静态分析发现

- 实现框架：C++（[Napi](https://github.com/nodejs/node-addon-api) 头文件库，
  符号形如 `GhostState(Napi::CallbackInfo const&)`）+ Objective-C（PiP 窗口 UI）。
- ObjC 类：`ZcPipController`、`ZcPipImageView`、`ZcPipCloseButtonView`、
  `ZcPipCompletionBadgeView`、`ZCodeOneShotStreamOutput`。
- 信任模型字符串：`trusted` / `warm` / `untrusted` / `denied` /
  `accessibility_check` / `accessibility_warm` / `accessibility_untrusted`；
  对 AX 树写入 `AXManualAccessibility` 属性（ manual accessibility 代理启用）。
- C++ 内部测试钩子（`PipSimulate*`、`PipGetStackTargets`、`PipGetWindowBounds`、
  `PipVerifyInitialHitSurface`、`PipStartInteractionTestPanel` 等）存在于符号表
  但未导出到 JS 面。
- 键盘注入含 `ZCodePostKeyboardEventToWindow`（CGEventPostToPid 语义）。

## 加载与校验

- 加载方式：`require(ax_native.node)`（按平台分别加载 `ax_native_mac.node` / `build/Release/ax_native.node`）（NAPI ABI 稳定，Node 24 / modules 127 验证通过）。
- Helper 启动时按 `ZCODE_CUA_HELPER_ADDON` 环境变量定位插件路径
  （见 `src/broker/server/helperAddonLoader.ts`）。
- `--cua-helper-provenance-smoke` 冒烟：仅加载插件并输出元数据
  （arch / modules / addonPath / version / bundleId）。
