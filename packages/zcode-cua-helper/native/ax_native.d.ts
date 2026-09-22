// ax_native.node 接口声明（对原版原生插件逆向还原）。
//
// 逆向方式与证据：
// 1. 运行时内省：require() 加载后 Object.keys() 枚举出全部 117 个导出函数
//    （NAPI 插件的 arity 恒为 0，参数经 CallbackInfo 传入）。
// 2. 静态符号：nm + c++filt demangle 出 55 个 C++ 函数（Napi 框架）与
//    ObjC 类（ZcPipController / ZcPipImageView / ZcPipCloseButtonView /
//    ZcPipCompletionBadgeView / ZCodeOneShotStreamOutput）。
// 3. 参数/返回语义：与 helper 源码全部调用点交叉比对得出。
//
// 实现语言：C++（Napi 头文件库）+ Objective-C（PiP 窗口 UI、CG 窗口流）。
// 平台：macOS arm64（LSMinimumSystemVersion 12.0；NAPI ABI 稳定，modules 127 验证）。

/// 像素封装身份（PNG/JPEG 头部解码结果）
export interface CaptureMeta {
  mimeType: string;
  width: number;
  height: number;
  sha256?: string;
  capture_epoch?: number;
  window_id?: number;
  pid?: number;
}

/// AX 元素引用（原生侧返回的轻量句柄：pid + 路径/角色描述）
export interface AxRef {
  pid: number;
  role?: string;
  title?: string;
  label?: string;
  value?: string;
  window_id?: number;
  path?: unknown;
  [key: string]: unknown;
}

/// 显示器信息
export interface DisplayInfo {
  id: number;
  bounds: [number, number, number, number];
  main: boolean;
  scale_factor: number;
}

/// 应用/窗口信息
export interface AppInfo {
  pid: number;
  bundle_id: string | null;
  name: string | null;
  window_id?: number;
  executable_path?: string;
}

export interface WindowInfo {
  window_id: number;
  pid: number;
  title: string;
  bounds: [number, number, number, number];
  main?: boolean;
}

/// 对端凭据（源自 audit_token，用于 broker 对端校验）
export interface PeerCredentials {
  uid: number;
  pid: number;
  auditToken: Uint8Array;
}

/// 代码签名门查询结果
export interface TrustGateResult {
  trusted: boolean;
  code?: string;
  detail?: string;
}

// ─────────────────────────────────────────────
// 1. 权限与信任（TCC / 代码签名）
// ─────────────────────────────────────────────

/** 探测辅助功能权限是否可用（不触发系统提示）。 */
export function probeAccessibility(): boolean;
/** 结构化辅助功能权限状态（trusted / warm / untrusted 等）。 */
export function probeAccessibilityStatus(): {
  state: string;
  trusted: boolean;
  [key: string]: unknown;
};
/** 当前进程是否被 TCC 信任（Helper 进程内自检）。 */
export function isTrusted(): boolean;
/** 弹出辅助功能（TCC）系统提示并返回是否已授权（阻塞）。 */
export function promptTrust(): boolean;
/** 读取 TCC db 的屏幕录制授权状态（只读探测）。 */
export function readTccDbGranted(): boolean | { granted: boolean; [key: string]: unknown };
/** 请求屏幕录制权限（触发 TCC 提示）。 */
export function requestScreenCaptureAccess(): boolean;
/** 屏幕录制授权状态快照。 */
export function screenCaptureStatus(): {
  state: "granted" | "denied" | "unknown";
  [key: string]: unknown;
};

/** 校验目标进程的代码签名是否满足 requirement 字符串（成功返回 true）。 */
export function verifyProcessCodeSignature(pid: number, requirement: string): boolean;
/** 按 audit_token 的逐连接代码签名快路径校验（reuse-resistant）。 */
export function verifyProcessCodeSignatureWithAuditToken(
  auditToken: Uint8Array,
  requirement: string,
): boolean;
/** 取 socket 对端凭据（uid/pid/audit_token；fd 不可用返回 null）。 */
export function getPeerCredentials(fd: number): PeerCredentials | null;

// ─────────────────────────────────────────────
// 2. 应用与窗口管理
// ─────────────────────────────────────────────

/** 枚举可见窗口（含 pid / title / bounds）。 */
export function listWindows(appRef?: { pid?: number; bundle_id?: string }): WindowInfo[];
/** 枚举已安装/运行中的应用。 */
export function listApplications(): AppInfo[];
/** 应用信息（bundle_id / 名称 / 路径）。 */
export function applicationInfo(appRef: { pid?: number; bundle_id?: string }): AppInfo;
/** 前台激活应用。 */
export function activateApplication(pid: number): void;
/** 激活指定窗口。 */
export function activateWindow(pid: number, bundleId: string, windowId: number): void;
/** 无 LaunchServices 前台切换的后台启动。 */
export function openApplicationInBackground(bundleId: string): void;
export function openApplicationInBackgroundAsync(bundleId: string): Promise<void>;
/** 经验证的目标应用终止（要求签名/归属校验通过）。 */
export function terminateApplicationVerified(pid: number, options?: unknown): void;
/** 解析 AX 引用对应的 window id。 */
export function getWindowId(ref: AxRef): number | undefined;
/** 显示器列表。 */
export function displays(): DisplayInfo[];
/** 光标当前坐标。 */
export function cursorPoint(): { x: number; y: number };

// ─────────────────────────────────────────────
// 3. AX 元素读写
// ─────────────────────────────────────────────

/** 命中点位的 AX 元素引用。 */
export function elementAtPoint(x: number, y: number): AxRef | null;
/** 读取元素/子树（含 role/title/value/位置）。 */
export function readElement(ref: AxRef): AxRef | null;
/** 点击点位上的 AX 元素（clicks 可多击；expectedPid 用于命中校验）。 */
export function clickElementAtPoint(
  x: number,
  y: number,
  clicks: number,
  synthetic: boolean,
  imageType: string,
  expectedPid?: number,
): unknown;
/** 对 AX 元素执行动作（AXPress / AXShowMenu / AXConfirm ...）。 */
export function performAction(ref: AxRef, action: string): unknown;
/** 设置 AX 值（set_value）。 */
export function setValue(ref: AxRef, value: string): unknown;
/** 选择文本范围（select_text）。 */
export function selectText(ref: AxRef, start: number, end: number): unknown;
/** 设置 AX 焦点。 */
export function setFocused(ref: AxRef): unknown;
/** 点位的策略身份（policy identity，用于来源审计）。 */
export function policyIdentityAtPoint(x: number, y: number): unknown;

// ─────────────────────────────────────────────
// 4. 输入注入（全局 / 按 pid / 按窗口）
// ─────────────────────────────────────────────
// 命名规则：
//   *Global            —— CGEvent 全局注入（无窗口定向）
//   *ToPid             —— 注入并定向到 pid
//   *ToPidVerified     —— 定向 pid 且要求 bundle id 校验（防误注入）
//   *ToWindow          —— 定向到窗口（后台注入路径）

export function clickAtPoint(x: number, y: number, options?: unknown): unknown;
export function clickToWindow(windowId: number, x: number, y: number, options?: unknown): unknown;
export function mouseDown(): unknown;
export function mouseDownToPid(pid: number): unknown;
export function mouseDownToWindow(windowId: number, x: number, y: number): unknown;
export function mouseDownToWindowDetailedAsync(
  windowId: number,
  x: number,
  y: number,
): Promise<unknown>;
export function mouseUp(): unknown;
export function mouseUpToPid(pid: number): unknown;
export function mouseUpToWindow(windowId: number, x: number, y: number): unknown;
export function mouseUpToWindowAsync(windowId: number, x: number, y: number): Promise<unknown>;
export function moveTo(x: number, y: number): unknown;
export function moveToPid(pid: number, x: number, y: number): unknown;
export function moveToWindow(windowId: number, x: number, y: number): unknown;
export function moveToWindowAsync(windowId: number, x: number, y: number): Promise<unknown>;
export function drag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  button: string,
): unknown;
export function dragAsync(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  button: string,
  sessionKey: string,
): Promise<unknown>;
export function dragToPid(
  pid: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): unknown;
export function dragToWindow(windowId: number, points: unknown): unknown;
export function dragToWindowAsync(windowId: number, points: unknown): Promise<unknown>;
export function scrollAt(x: number, y: number, dx: number, dy: number, options?: unknown): unknown;
export function scrollToPid(pid: number, dx: number, dy: number): unknown;
export function scrollToWindow(
  windowId: number,
  dx: number,
  dy: number,
  options?: unknown,
): unknown;

export function keyDownGlobal(modifiers: string[]): unknown;
export function keyUpGlobal(modifiers: string[]): unknown;
export function pressKeyGlobal(chord: string): unknown;
export function pressKeyToPid(pid: number, chord: string): unknown;
export function pressKeyToPidVerified(
  pid: number,
  expectedBundleId: string,
  chord: string,
): unknown;
export function typeTextGlobal(text: string): unknown;
export function typeTextToPid(pid: number, text: string): unknown;
export function typeTextToPidVerified(pid: number, expectedBundleId: string, text: string): unknown;
export function holdKeyGlobal(chord: string, durationMs: number, sessionKey: string): unknown;
export function holdKeyToPid(pid: number, chord: string, durationMs: number): unknown;
export function holdKeyToPidVerified(
  pid: number,
  expectedBundleId: string,
  chord: string,
  durationMs: number,
  sessionKey: string,
): unknown;
export function cancelPendingInputHolds(): boolean | void;
export function cancelInputHoldsForSession(sessionKey: string): unknown;

/** 后台窗口输入会话（前台不抢焦点的注入前置）。 */
export function beginBackgroundWindowInput(windowId: number): unknown;
export function beginBackgroundWindowInputDetailed(windowId: number, options: unknown): unknown;
export function beginBackgroundWindowInputDetailedAsync(
  windowId: number,
  options: unknown,
): Promise<unknown>;
export function endBackgroundWindowInput(windowId: number): unknown;
export function endBackgroundWindowInputAsync(windowId: number): Promise<unknown>;
export function endBackgroundWindowInputDetailedAsync(
  windowId: number,
  options: unknown,
): Promise<unknown>;

// ─────────────────────────────────────────────
// 5. 截图与栅格取证
// ─────────────────────────────────────────────

/** 抓取目标应用最终栅格（PNG bytes + 元信息）。 */
export function captureApp(options: {
  pid: number;
  window_id?: number;
  [key: string]: unknown;
}): { data: Buffer; meta: CaptureMeta } | null;
export function captureAppAsync(options: {
  pid: number;
  window_id?: number;
  [key: string]: unknown;
}): Promise<{ data: Buffer; meta: CaptureMeta } | null>;
/** 诊断性抓取（返回失败原因链，不做完整性门）。 */
export function captureAppDiagnostic(pid: number, windowId?: number): unknown;
/** 单窗口截图。 */
export function captureWindowImage(
  windowId: number,
): { data: Buffer; [key: string]: unknown } | null;
/** 带验证的窗口截图（完整封套 + 外来窗口证据）。 */
export function captureWindowImageVerified(windowId: number, options?: unknown): unknown;
export function captureWindowImageVerifiedAsync(windowId: number): Promise<unknown>;
/** 应用图标 PNG。 */
export function applicationIconPngAsync(pid: number): Promise<Buffer | null>;
/** PNG 内容检视（尺寸/封套/方向；与 frame-contract 联动）。 */
export function inspectPngContent(png: Buffer): unknown;
/** 捕获纪元确认（目标应用侧握手）。 */
export function ackCaptureEpoch(pid: number, epoch: number): boolean;
/** 释放捕获纪元。 */
export function releaseCaptureEpoch(pid: number, epoch: number): unknown;
/** 屏幕捕获探针窗口列表（Windows 路径共用面）。 */
export function screenCaptureProbeWindows(): unknown[];
/** 防焦点抢占抑制。 */
export function preventActivation(): void;
/** 解除激活抑制。 */
export function reenableActivation(): boolean;
/** 焦点抢占是否已被抑制。 */
export function isFocusStealPrevented(): boolean;

// ─────────────────────────────────────────────
// 6. 虚拟光标（ghost cursor）覆盖层
// ─────────────────────────────────────────────

export function ghostInit(options?: unknown): unknown;
export function ghostShow(...args: unknown[]): unknown;
export function ghostHide(): unknown;
export function ghostMove(x: number, y: number): unknown;
export function ghostMoveTarget(target: unknown): unknown;
export function ghostClickRipple(x: number, y: number): unknown;
export function ghostRenderPng(png: Buffer): unknown;
export function ghostSetCapture(enabled: boolean): unknown;
export function ghostSetControllerStatus(text: string | null): unknown;
export function ghostSetEnabled(enabled: boolean): unknown;
export function ghostState(): unknown;

// ─────────────────────────────────────────────
// 7. PiP（画中画）会话窗口
// ─────────────────────────────────────────────
// 原生实现含 ObjC UI（ZcPipController / ZcPipImageView /
// ZcPipCloseButtonView / ZcPipCompletionBadgeView）。
// 握手契约：pip_session_handshake 校验 protocolVersion=2、
// runtimeId="zcode-cua-pip-session-v2"。

export function pipStart(options: unknown): unknown;
export function pipStartVerified(options: unknown): unknown;
export function pipStartVerifiedAsync(options: unknown): Promise<unknown>;
export function pipStartVerifiedCompositeAsync(options: unknown): Promise<unknown>;
export function pipStop(): unknown;
export function pipStopTarget(target: unknown): unknown;
export function pipSetEnabled(enabled: boolean): unknown;
export function pipSetActiveGroup(group: unknown): unknown;
export function pipFreezeGroup(group: unknown): unknown;
export function pipGetLeadTarget(): unknown;
export function pipBeginTurn(turn: unknown): unknown;
export function pipTaskCompleted(turn: unknown): unknown;
export function pipClearDismissed(): unknown;
export function pipDismiss(): unknown;
export function pipIsDismissed(): boolean;
export function pipIsRunning(): boolean;
export function pipIsInteractionReady(): boolean;
export function pipStackCount(): number;
// （未导出到 JS 面：pipGetStackTargets）
// （未导出到 JS 面：pipGetWindowBounds）
// （未导出到 JS 面：pipGetLiveLegacyCaptureDiagnostics）
// （未导出到 JS 面：pipSetLiveLegacyCaptureDelay）
// （未导出到 JS 面：pipMoveInteractionTestPanelToPoint）
// （未导出到 JS 面：pipSampleInteractionOwnershipAtPoint）
// （未导出到 JS 面：pipStartInteractionTestPanel）
// （未导出到 JS 面：pipVerifyInitialHitSurface）
/** 测试/演练钩子（仅 --pip-live-probe 构建面）：外来源继续传递。 */
// （C++ 内部测试钩子 pipSimulateForeignContinuationPassThrough，未导出到 JS 面）
/** 测试/演练钩子：持续捕获失败注入。 */
// （C++ 内部测试钩子 pipSimulatePersistentCaptureFailures，未导出到 JS 面）
/** 测试/演练钩子：合成准入超时围栏。 */
// （C++ 内部测试钩子 pipSimulateSyntheticAdmissionTimeoutFencing，未导出到 JS 面）
/** 测试/演练钩子：合成预约交错。 */
// （C++ 内部测试钩子 pipSimulateSyntheticReservationInterleaving，未导出到 JS 面）
/** 测试/演练钩子：超时耗竭恢复。 */
// （C++ 内部测试钩子 pipSimulateTimeoutDrainRecovery，未导出到 JS 面）
/** 测试/演练钩子：用户输入禁用释放竞态。 */
// （C++ 内部测试钩子 pipSimulateUserInputDisableReleaseRace，未导出到 JS 面）

// ─────────────────────────────────────────────
// 8. 对端凭据与窗口流（macOS 专用）
// ─────────────────────────────────────────────

/** CuaCopyWindowAcceptsLeftMouseDown：窗口是否接受左键按下（后台点击可行性）。 */
/** ZCodePostKeyboardEventToWindow：向指定窗口投递键盘事件（CGEventPostToPid 语义）。 */
/** 注册后台输入会话（RegisterBackgroundInput）。 */
/** 注册 PiP 能力面（RegisterPip）。 */
/** 注册虚拟光标能力面（RegisterGhostCursor）。 */
/** NAPI 模块初始化入口（Init）。 */

/** 激活应用框架表面（App Frame Surface，多窗口组）。 */
export function activateAppFrameSurface(...args: unknown[]): unknown;
/** 全局按住按键（异步）。 */
export function holdKeyGlobalAsync(
  chord: string,
  durationMs: number,
  sessionKey: string,
): Promise<unknown>;
/** 定向窗口点击（异步）。 */
export function clickToWindowAsync(windowId: number, x: number, y: number): Promise<unknown>;
/** 定向窗口滚动（异步）。 */
export function scrollToWindowAsync(windowId: number, dx: number, dy: number): Promise<unknown>;
