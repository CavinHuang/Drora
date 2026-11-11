#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 还原自发行 bundle —— win32 addon 逆向还原线生成器（纪律见下），产物为还原文件。
#
# 还原纪律（本仓 AGENTS.md / specs/cua-restoration-manifest.md）：
#   - 冻结还原资产零触碰（upstream/ 切段、官方参照副本、vendored 字节）；
#   - 还原代码改动须带官方证据注释（文件 + 行号/字节偏移），本脚本的
#     「前体/中部/尾部 sha256 锁 + 机器管理实现块 + 机器管理注册表」即零漂移铁律
#     的体现——三段锁区任何手改都会被 --verify 拦下，两机器区只能经本脚本重生；
#   - 产物 src/ax_native_win.cc：改实现/改面清单改本脚本再重跑，勿手编
#     （mac 线手编残体事故教训见 generate-mac-rebuilt.py 头注）。
#
# 设计文档：specs/win32-cua-0.6.5-implementation-design.md
#   §四 L0.2 生成器脚手架（本脚本；不泛化 mac 生成器——win 无符号表、注册表由
#            data JSON 驱动；mac 为全文内嵌实现区，win 因 0.5.13 语义底座体量与
#            CRLF/BOM 字节保真采用「三段 sha256 锁 + 机器管理实现块」等价模型）
#   §四 L1  三批施工（W1 追赶 3〔2026-11-10 已落地〕/ W2 mac 血统 22 / W3 win 专属 22）
#   §五     施工序 W0-W4；§六 验收矩阵 L0 行「生成器 dry-run 注册面=目标面」
#
# 数据基座：data/win32-3.17.2-napi-functions.json —— 官方 0.6.5 win32-x64 addon
# 96 面（sha 11f8bc9c…）。W1 后 faces：官方 96 / vendored 0.6.3 官方 52 /
# 还原线 52（追赶 3 已并入 WIN_IMPLEMENTED，delta_repo…missing 已清空）。
"""ax_native_win.cc 生成器（win32 CUA 0.6.5 对齐；W1 批已收）。

产物结构（specs §L0.2 等价模型；消费方 reverse/binding.gyp:9 零改动）：

  src/ax_native_win.cc = 前体（BOM 起至「注册」banner 前 —— 0.5.13/0.6.3 语义底座，
                          sha256 锁 PRE_SHA；手改即 FAIL）
                       + 机器管理实现块（标记包裹，本脚本所有——W1 追赶 3 面落此，
                          W2/W3 批逐批追加；块内手改会在重跑时被覆盖，--verify 报漂移）
                       + 中部（banner + InitModule 开脸 + reg lambda，sha256 锁 MID_SHA）
                       + 注册表（WIN_IMPLEMENTED 生成，机器管理区）
                       + 尾部（return exports 至文件尾，sha256 锁 TAIL_SHA）

行尾与 BOM：读取时把 CRLF 规范化为 LF（win 机 autocrlf 检出为 CRLF、mac/git index 为
LF——mac W0 版生成器的 LF-only 正则在 win 检出下失配即此坑），产物恒写 LF+BOM，
与 git index 字节一致（git status 恒净）。

用法（在 native/reverse/ 下运行）：
  python3 generate-win-rebuilt.py                 # 生成（字节不变时零写入）
  python3 generate-win-rebuilt.py --verify        # 零漂移铁门：产物写临时文件与现
                                                  # src/ax_native_win.cc 逐字节比对
                                                  # （LF 规范化后），不一致 exit 1
  python3 generate-win-rebuilt.py --list-pending  # 按批次（W1/W2/W3）打印待实现面
"""

import argparse
import hashlib
import json
import os
import os.path as osp
import re
import sys
import tempfile

HERE = osp.dirname(osp.abspath(__file__))
DATA_REL = "data/win32-3.17.2-napi-functions.json"
SRC_REL = "src/ax_native_win.cc"
DATA_PATH = osp.join(HERE, DATA_REL)
SRC_PATH = osp.join(HERE, SRC_REL)

# ---------------------------------------------------------------------------
# 已实现面（WIN_IMPLEMENTED）—— 52 面（W1 批 2026-11-10 收 3：activateWindow /
# launchApplicationAsync / listInstalledApplicationsAsync，vendored 0.6.3 已有、
# 还原线自 0.5.13 期参照起从未追赶，本轮以官方 0.6.5 addon 探针对齐补齐）。
#
# 机械提取自 src/ax_native_win.cc 的 reg() 调用序列（顺序保持文件内字母序）。
# 还原线面账 = data JSON faces.repo_reverse_line_ax_native_win_cc:52。
# ---------------------------------------------------------------------------
WIN_IMPLEMENTED = [
    "activateApplication",
    "activateApplicationByAumid",
    "activateWindow",                      # W1 追赶批
    "applicationIconPngAsync",
    "applicationInfo",
    "applicationInfoByAumid",
    "cancelInputHoldsForSession",
    "cancelPendingInputHolds",
    "captureApp",
    "captureMonitorPngAsync",
    "captureWindowImage",
    "captureWindowPngCompositeAsync",     # W3 win 专属批
    "captureWindowPngVerifiedAsync",
    "classifyPostMessageDelivery",        # W3 win 专属批
    "clickAtPoint",
    "clickAtPointAsync",                  # W3 win 专属批
    "cursorPoint",
    "displays",
    "dpiAwarenessInfo",
    "drag",
    "elementAtPoint",
    "elementPatternCallAsync",            # W3 win 专属批
    "elementValueReadAsync",              # W3 win 专属批
    "enumerateSurfacesForFrame",          # W3 win 专属批
    "ghostBeginAction",                    # W2 mac 血统批
    "ghostBeginActionWithTitle",
    "ghostClickRipple",
    "ghostEndAction",
    "ghostHide",
    "ghostInit",
    "ghostMove",
    "ghostPaletteSelftest",
    "ghostRemoveSession",
    "ghostSessionTurnEnd",
    "ghostSetCapture",
    "ghostSetEnabled",
    "ghostSetMultiCursorEnabled",
    "ghostSetRequestSession",
    "ghostShow",
    "ghostState",
    "frameWindowContext",                 # W3 win 专属批
    "getDispatchWindowId",                # W3 win 专属批
    "getForegroundRootWindowId",          # W3 win 专属批
    "getWindowId",                         # W2 mac 血统批（杂项）
    "hasActiveInputHolds",                 # W2 mac 血统批（杂项）
    "hitTestInvokeAtPointAsync",          # W3 win 专属批
    "holdKeyGlobal",
    "holdKeyGlobalAsync",
    "invokeAcceleratorAsync",             # W3 win 专属批
    "isFocusStealPrevented",
    "isInteractiveSession",
    "isScreenCaptureSupported",
    "isTargetElevated",
    "isTrusted",
    "keyDownGlobal",
    "keyUpGlobal",
    "launchApplicationAsync",              # W1 追赶批
    "listApplications",
    "listInstalledApplicationsAsync",      # W1 追赶批
    "listWindows",
    "mouseDown",
    "mouseUp",
    "moveTo",
    "pasteboardAwaitProvidedRead",         # W2 mac 血统批
    "pasteboardBeginProvidedPaste",
    "pasteboardFinishProvidedPaste",
    "pasteboardMarkProvidedPasteDispatched",
    "performAction",
    "postMessageCharAsync",               # W3 win 专属批
    "postMessageClickAsync",
    "postMessageDragAsync",
    "postMessageKeyAsync",
    "postMessageScrollAsync",
    "pressKeyGlobal",
    "preventActivation",
    "probeAccessibility",
    "probeAccessibilityStatus",
    "processExecutablePath",
    "readClipboardTextAsync",
    "readElement",
    "reenableActivation",
    "restoreForegroundWindow",            # W3 win 专属批
    "screenCaptureProbeWindows",
    "screenCaptureStatus",
    "scrollAt",
    "scrollElement",                      # W3 win 专属批
    "selectText",
    "setFocused",
    "setValue",
    "setValueReadbackAsync",              # W3 win 专属批
    "startupError",
    "typeTextGlobal",
    "typeTextGlobalAsync",                # W3 win 专属批
    "winAxElementFromToken",              # W3 win 专属批
    "winAxElementRelease",                # W3 win 专属批
    "windowsOperationScene",              # W4 收口批（97 面）
    "writeClipboardTextAsync",
]

# 注册符号约定：reg("<name>", <Name 首字母大写>)。现 52 面全部符合；未来面若
# 不符合（如 $ 字符或前缀风格不同），在此登记显式符号，勿改约定推导。
SYMBOL_OVERRIDES = {}

# ---------------------------------------------------------------------------
# 批次表 —— 出处：specs/win32-cua-0.6.5-implementation-design.md §四 L1
# 「addon 逆向重建（win 机主战场，三批）」+ §五施工序 W1/W2/W3。
# 批次表与数据基座的一致性由 validate_data() 逐项断言（W1 == data JSON
# delta_repo_reverse_line_vs_vendored_0_6_3.missing〔W1 后已清空〕；
# W2∪W3 == delta_vs_vendored added 44 面；pending 恰为 96 − 52 = 44，0/22/22）。
# ---------------------------------------------------------------------------

# W1 批（追赶 3 + ABI 切换）——2026-11-10 已落地并入 WIN_IMPLEMENTED：
# activateWindow / launchApplicationAsync / listInstalledApplicationsAsync
# （AUMID 激活链；vendored 0.6.3 JS 引用 7/3/1 次，strings 实证；行为锚=官方
# 0.6.5 addon fresh-process 探针，证据注释见机器管理实现块内逐条 [E] 标注）。
W1_CATCH_UP = []

# W2 批（mac 血统 22）——2026-11-11 已落地并入 WIN_IMPLEMENTED：ghost 16 +
# pasteboard 4 + getWindowId + hasActiveInputHolds。行为锚=官方 0.6.5 win addon
# fresh-process 探针（probe-one-win ghost/pasteboard/getWindowId/
# hasActiveInputHolds 四面 + 三轮判别探针）；ghost 常量走
# ghost-shared-constants.json 单一出处（palette.rgb 注入 ghostPaletteSelftest）。
# 注：win 官方 ghost 形态较 mac 大幅薄化（state 8 键/无组状态机/multiCursorEnabled
# 恒 true/ready=enabled∧move|ripple），见 W2_IMPL 段注释逐条 [E]。
W2_GHOST = []
W2_PASTEBOARD = []
W2_MISC = []
W2_MAC_LINEAGE = []

# ghost 共享常量单一出处 data/ghost-shared-constants.json（specs §四 L0.3）：
# W2 批起由本生成器消费（palette.rgb 注入 ghostPaletteSelftest；motion 采样与
# geometry 键为 mac 专属自检面，win 96 面无此二导出，暂不注入）。
GHOST_SHARED_CONSTANTS_PATH = "data/ghost-shared-constants.json"

W3_POST_MESSAGE = []
W3_UIA_LADDER = []
W3_SURFACE = []
W3_MISC = []
W3_WIN_DEEP = []
# W3 批（win 专属 22）——2026-11-11 已落地并入 WIN_IMPLEMENTED（faces 96/96 齐）。
# 逐域实现见 W3_IMPL 段（postMessage 5/UIA 梯 4/surface 6/杂项 7）；[I] 项
#（layer 内部计数/焦点守卫方向/owned 关系名等）逐函数注释如实标注。

# ---------------------------------------------------------------------------
# 产物四区模型：前体 / 机器管理实现块 / 中部 / 注册表 / 尾部。
# 前体、中部、尾部为锁区（sha256 钉扎现字节——0.5.13/0.6.3 语义底座原样透传，
# 手改即 FAIL）；机器管理实现块与注册表为本脚本所有（重跑即覆盖手改）。
# ---------------------------------------------------------------------------

BANNER = (
    "// ============================================================================\n"
    "// 注册\n"
    "// ============================================================================\n"
)

# 三段锁（LF 规范化字节口径；前体锁含 PRECURSOR_PATCHES 补丁后字节——
# 2026-11-10 W1 批初钉，2026-11-11 W2 批随锁区补丁 1 重钉）。改锁区必须带官方
# 证据链并经 PRECURSOR_PATCHES + 重锁本值——与手改 .cc 等价违规。
# 2026-11-11 W4 批随锁区补丁 2-7 重钉（probeWindows/listApplications 键形与滤集/
# ref :generation: 尾标——parity-native 基面差距四项六补丁）
PRE_SHA = "7018149a9433d60c683d92dda05bcb87021fad3e81640a8df5d2e42d794bd7ac"
# （2026-11-11 W4 二轮：补丁 1b TOOLWINDOW 条件化 + 7 ParseRef 负段）
MID_SHA = "4ca56088e09bbf3f40b0a35740a13bcb7c25cee4e17a8def3f292f536fbd351c"
TAIL_SHA = "8a9ce88717651859c4256abb967b0db049330565a0cbc984d653d96a2dc6d743"

# ---------------------------------------------------------------------------
# 锁区补丁（前体 byte 级有据变更）：每条 = (原字节段, 新字节段, 证据注)。锁的
# PRE_SHA 恒对「补丁后」字节；补丁表即锁区变更审计账（apply 时旧段恰一次命中或
# 新段已在场，否则 FAIL）。经生成器落锁区改动，仍禁止手改 .cc。
# ---------------------------------------------------------------------------
PRECURSOR_PATCHES = [
    (
        "  result.Set(\"ok\", Napi::Boolean::New(env, ok));\n"
        "  result.Set(\"text\", ok ? Napi::Value(Napi::String::New(env, Narrow(text)))"
        " : env.Null());\n",
        "  // [E] 官方 0.6.5 win 探针（2026-11-11，provided-paste 接管态读取）失败路径：\n"
        "  // {ok:false, error:\"invalid_data\"}（无 text 槽）；成功 {ok:true, text} 原形。\n"
        "  if (!ok) {\n"
        "    auto errObj = Napi::Object::New(env);\n"
        "    errObj.Set(\"ok\", Napi::Boolean::New(env, false));\n"
        "    errObj.Set(\"error\", Napi::String::New(env, \"invalid_data\"));\n"
        "    deferred.Resolve(errObj);\n"
        "    return deferred.Promise();\n"
        "  }\n"
        "  result.Set(\"ok\", Napi::Boolean::New(env, true));\n"
        "  result.Set(\"text\", Napi::String::New(env, Narrow(text)));\n",
        "readClipboardTextAsync 失败形状对齐（W2 批 pasteboard 探针发现的相邻面差距："
        "接管态官方 {ok:false,error:invalid_data}，0.5.13 还原稿为 {ok:false,text:null}）",
    ),
    ("        LONG_PTR ex = GetWindowLongW(hwnd, GWL_EXSTYLE);\n        if (ex & WS_EX_TOOLWINDOW) return TRUE;\n", "        // [E] 2026-11-11 parity-native：官方 0.6.5 probeWindows/listApplications\n        // 含 TOOLWINDOW 系（PixPin/ZcodeGhostCursorOverlay/NVIDIA Overlay 等 12 窗\n        // 实证差集）——TOOLWINDOW 滤除废除（0.5.13 期口径）。\n",
        "EnumTopWindows：TOOLWINDOW 滤除废除（W4 parity 差集实证）"),
    ("        int len = GetWindowTextLengthW(hwnd);\n        if (len == 0) return TRUE;\n        WindowEntry e;\n", "        // [E] 2026-11-11 parity-native：官方 listApplications 含空名条目\n        //（explorer pid 16832 name=\"\" 实证）——空标题滤除废除。\n        WindowEntry e;\n",
        "EnumTopWindows：空标题滤除废除（W4 parity 实证）"),
    ("static Napi::Object AppEntryToJs(Napi::Env env, const WindowEntry& e, bool active) {\n  auto obj = Napi::Object::New(env);\n  obj.Set(\"pid\", Napi::Number::New(env, (double)e.pid));\n  obj.Set(\"name\", Napi::String::New(env, Narrow(e.title)));\n  obj.Set(\"bundle_id\", Napi::String::New(env, Narrow(e.exe_path)));\n  obj.Set(\"aumid\", e.aumid.empty() ? env.Null() : Napi::Value(Napi::String::New(env, Narrow(e.aumid))));\n  obj.Set(\"active\", Napi::Boolean::New(env, active));\n  return obj;\n}\n", "static Napi::Object AppEntryToJs(Napi::Env env, const WindowEntry& e, bool active) {\n  // [E] 2026-11-11 parity-native：官方 0.6.5 app 条目 6 键（尾键 window_id=该条目\n  // 窗口 HWND——listApplications=逐窗条目制，官方 explorer 空名窗实证）。\n  auto obj = Napi::Object::New(env);\n  obj.Set(\"pid\", Napi::Number::New(env, (double)e.pid));\n  obj.Set(\"name\", Napi::String::New(env, Narrow(e.title)));\n  obj.Set(\"bundle_id\", Napi::String::New(env, Narrow(e.exe_path)));\n  obj.Set(\"aumid\", e.aumid.empty() ? env.Null() : Napi::Value(Napi::String::New(env, Narrow(e.aumid))));\n  obj.Set(\"active\", Napi::Boolean::New(env, active));\n  obj.Set(\"window_id\", Napi::Number::New(env, (double)(uintptr_t)e.hwnd));\n  return obj;\n}\n",
        "AppEntryToJs：+window_id 尾键（W4 parity 实证 6 键形）"),
    ("static std::optional<RefData> ParseRef(const std::string& ref) {\n  // \"rt:<pid>:<id>-<id>-...\"\n", "static std::optional<RefData> ParseRef(const std::string& refIn) {\n  // \"rt:<pid>:<id>-<id>-...\"；0.6.5 官方尾部 \":generation:N\" 代际标记——剥除后解析\n  std::string ref = refIn;\n  size_t genMark = ref.rfind(\":generation:\");\n  if (genMark != std::string::npos) ref = ref.substr(0, genMark);\n",
        "ParseRef：容忍 :generation:N 尾标（W4 ref 形态对齐配套）"),
    ("  SafeArrayDestroy(sa);\n  return ref;\n}\n", "  SafeArrayDestroy(sa);\n  // [E] 2026-11-11 官方 0.6.5 ref 形态：\"rt:<pid>:<ids>:generation:N\"（探针全样本\n  // 恒 N=1；win.ts:31017/:31044-31053 消费面按 \":generation:\\d+\" 处理）——补尾标。\n  return ref + \":generation:1\";\n}\n",
        "MakeRef：+ :generation:1 尾标（W4 ref 形态对齐——readElement 跨端往返实证差距）"),
    ("    obj.Set(\"ownerActive\", Napi::Boolean::New(env, w.pid == fg_pid));\n    obj.Set(\"title\", Napi::String::New(env, Narrow(w.title)));\n", "    obj.Set(\"ownerActive\", Napi::Boolean::New(env, w.pid == fg_pid));\n    // [E] 2026-11-11 parity-native：官方 0.6.5 probeWindows 10 键（+acceptsLeftMouseDown，\n    // 键序在 ownerActive 后）；值=!(WS_EX_TRANSPARENT)——GhostCursor/dl-app/clash-verge\n    // 等 12 窗差集实证全部吻合（layered 非 transparent 的 PixPin 工具条=true）。\n    LONG_PTR exStyle = GetWindowLongPtrW(w.hwnd, GWL_EXSTYLE);\n    obj.Set(\"acceptsLeftMouseDown\",\n            Napi::Boolean::New(env, (exStyle & WS_EX_TRANSPARENT) == 0));\n    obj.Set(\"title\", Napi::String::New(env, Narrow(w.title)));\n",
        "ScreenCaptureProbeWindows：+acceptsLeftMouseDown（W4 parity 10 键形）"),
    ("  win.Set(\"main\", Napi::Boolean::New(env, fg));\n  win.Set(\"focused\", Napi::Boolean::New(env, fg));\n  snap.Set(\"window\", win);\n", "  win.Set(\"main\", Napi::Boolean::New(env, fg));\n  win.Set(\"focused\", Napi::Boolean::New(env, fg));\n  // [E] 2026-11-11 parity-native-full：官方 0.6.5 captureApp window 8 键（尾双键\n  // cloaked/minimized）——补齐（DWMWA_CLOAKED 查询 + IsIconic）。\n  int cloakedState = 0;\n  if (SUCCEEDED(DwmGetWindowAttribute(target->hwnd, DWMWA_CLOAKED, &cloakedState,\n                                      sizeof(cloakedState)))) {\n  }\n  win.Set(\"cloaked\", Napi::Boolean::New(env, cloakedState != 0));\n  win.Set(\"minimized\", Napi::Boolean::New(env, IsIconic(target->hwnd) != FALSE));\n  snap.Set(\"window\", win);\n",
        "captureApp window：+cloaked/+minimized 尾键（W4 parity-full 8 键形）"),
    ("  // [E] 2026-11-11 官方 0.6.5 ref 形态：\"rt:<pid>:<ids>:generation:N\"（探针全样本\n  // 恒 N=1；win.ts:31017/:31044-31053 消费面按 \":generation:\\d+\" 处理）——补尾标。\n  return ref + \":generation:1\";\n", "  // [E] 2026-11-11 parity-native-full 勘正：N 为进程级递增计数器（非恒 1——\n  // captureApp(ZCode) 首元素官方 :generation:61 实证，多次注册/查询后增长）。\n  // win.ts:31017/:31044-31053 消费面按 \":generation:\\d+\" 处理。\n  static LONG g_refGeneration = 0;\n  return ref + \":generation:\" + std::to_string(++g_refGeneration);\n",
        "MakeRef：代数=递增计数器（W4 parity-full 勘正 :generation:61）"),
    ("  // [E] 2026-11-11 parity-native-full 勘正：N 为进程级递增计数器（非恒 1——\n  // captureApp(ZCode) 首元素官方 :generation:61 实证，多次注册/查询后增长）。\n  // win.ts:31017/:31044-31053 消费面按 \":generation:\\d+\" 处理。\n  static LONG g_refGeneration = 0;\n  return ref + \":generation:\" + std::to_string(++g_refGeneration);\n", "  // [E] 2026-11-11 W5 勘正：MakeRef 保持裸 \"rt:<pid>:<ids>\"（ResolveRefToElement\n  // 的树走比对与注册表查找键均以裸形态比对——尾标由 ElementToJs 出口附加，\n  // 否则 want(裸) vs MakeRef(带尾标) 恒不等、四老面全 invalid_element）。\n  return ref;\n",
        "MakeRef：尾标回撤至裸形态（W5 根修——树走比对撕裂）"),
    ("static Napi::Object ElementToJs(Napi::Env env, IUIAutomationElement* el, DWORD owner_pid,\n                                bool with_children, int depth) {\n  auto obj = Napi::Object::New(env);\n  std::string ref = MakeRef(owner_pid, el);\n  RegisterElementRef(ref, el);\n", "static Napi::Object ElementToJs(Napi::Env env, IUIAutomationElement* el, DWORD owner_pid,\n                                bool with_children, int depth) {\n  auto obj = Napi::Object::New(env);\n  // [E] 2026-11-11 W5：代数尾标在 JS 出口附加（:generation:N 递增计数器——官方\n  // captureApp(ZCode) :61 实证）；注册表键=带尾标全文（LookupElementRef 精确命中），\n  // MakeRef 裸形态供 ResolveRefToElement 树走比对（W4 补丁 5 原位加尾标致四老面\n  // 全 invalid_element 的根修）。\n  static LONG g_refGeneration = 0;\n  std::string ref = MakeRef(owner_pid, el) + \":generation:\" +\n                  std::to_string(++g_refGeneration);\n  RegisterElementRef(ref, el);\n",
        "ElementToJs：出口加代数尾标+注册带尾标 ref（W5 根修）"),
    ("  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());\n  if (!ref) return AxErrorResult(env, \"invalid_element\");\n  IUIAutomationElement* el = ResolveRefToElement(*ref);\n  if (!el) return AxErrorResult(env, \"invalid_element\");\n  IUIAutomationValuePattern* p = nullptr;\n", "  // [E] W5：注册表优先（同注册表 ref 精确命中——Chromium 树走不稳已知边界）\n  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());\n  if (!el) {\n    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());\n    if (!ref) return AxErrorResult(env, \"invalid_element\");\n    el = ResolveRefToElement(*ref);\n  }\n  if (!el) return AxErrorResult(env, \"invalid_element\");\n  IUIAutomationValuePattern* p = nullptr;\n",
        "setValue：注册表优先（W5——Chromium 树走 miss 边界）"),
    ("  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());\n  if (!ref) return AxErrorResult(env, \"invalid_element\");\n  IUIAutomationElement* el = ResolveRefToElement(*ref);\n  if (!el) return AxErrorResult(env, \"invalid_element\");\n  std::string action = info[1].As<Napi::String>().Utf8Value();\n", "  // [E] W5：注册表优先（同 setValue 注）\n  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());\n  if (!el) {\n    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());\n    if (!ref) return AxErrorResult(env, \"invalid_element\");\n    el = ResolveRefToElement(*ref);\n  }\n  if (!el) return AxErrorResult(env, \"invalid_element\");\n  std::string action = info[1].As<Napi::String>().Utf8Value();\n",
        "performAction：注册表优先（W5——Chromium 树走 miss 边界）"),
    ("  if (info.Length() < 1 || !IsStr(info[0]))\n    return AxErrorResult(env, \"illegal_argument\");\n  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());\n  if (!ref) return AxErrorResult(env, \"invalid_element\");\n  IUIAutomationElement* el = ResolveRefToElement(*ref);\n  if (!el) return AxErrorResult(env, \"invalid_element\");\n", "  if (info.Length() < 1 || !IsStr(info[0]))\n    return AxErrorResult(env, \"illegal_argument\");\n  // [E] W5：注册表优先（同 setValue 注——Chromium 树走 miss 边界）\n  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());\n  if (!el) {\n    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());\n    if (!ref) return AxErrorResult(env, \"invalid_element\");\n    el = ResolveRefToElement(*ref);\n  }\n  if (!el) return AxErrorResult(env, \"invalid_element\");\n",
        "setFocused：注册表优先（W5——Chromium 树走 miss 边界）"),
    ("  auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());\n  if (!ref) return AxErrorResult(env, \"illegal_argument\");\n  IUIAutomationElement* el = ResolveRefToElement(*ref);\n  if (!el) return AxErrorResult(env, \"invalid_element\");\n  el->Release();\n", "  // [E] W5：注册表优先（同 setValue 注）\n  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());\n  if (!el) {\n    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());\n    if (!ref) return AxErrorResult(env, \"illegal_argument\");\n    el = ResolveRefToElement(*ref);\n  }\n  if (!el) return AxErrorResult(env, \"invalid_element\");\n  el->Release();\n",
        "selectText：注册表优先（W5——Chromium 树走 miss 边界）"),




    ("        // [E] 2026-11-11 parity-native：官方 0.6.5 probeWindows/listApplications\n        // 含 TOOLWINDOW 系（PixPin/ZcodeGhostCursorOverlay/NVIDIA Overlay 等 12 窗\n        // 实证差集）——TOOLWINDOW 滤除废除（0.5.13 期口径）。\n", "        // [E] 2026-11-11 parity 二轮勘正：TOOLWINDOW 系仅在 probeWindows 面\n        //（filter_cloaked=true）收录（PixPin/GhostCursor/NVIDIA Overlay 差集实证）；\n        // listApplications 仍滤除（官方 apps 无 PixPin/ZCode/svchost 条目实证——\n        // 一轮全删致 rest-only=3 差集）。\n",
        "EnumTopWindows：TOOLWINDOW 条件化（仅 listApplications 滤除——W4 parity 二轮勘正）"),
    ("    if (part.empty()) return std::nullopt;\n    out.runtime_ids.push_back(atoi(part.c_str()));\n", "    if (part.empty()) {\n      // UIA RuntimeId 可为负：'-' 连接序列化产生 \"4--2995\" 空段（负数标记）——\n      // 下一段按负值并入，不整体判 null（W4 parity：官方 ref 负段实测）。\n      size_t nextDash = ids.find('-', dash + 1);\n      std::string negPart = ids.substr(dash + 1, nextDash == std::string::npos ? std::string::npos : nextDash - dash - 1);\n      if (negPart.empty()) return std::nullopt;\n      out.runtime_ids.push_back(-atoi(negPart.c_str()));\n      if (nextDash == std::string::npos) break;\n      pos = nextDash + 1;\n      continue;\n    }\n    out.runtime_ids.push_back(atoi(part.c_str()));\n",
        "ParseRef：负数 RuntimeId 段并入（W4 parity readElement 跨端往返）"),
    ("        // [E] 2026-11-11 parity 二轮勘正：TOOLWINDOW 系仅在 probeWindows 面\n        //（filter_cloaked=true）收录（PixPin/GhostCursor/NVIDIA Overlay 差集实证）；\n        // listApplications 仍滤除（官方 apps 无 PixPin/ZCode/svchost 条目实证——\n        // 一轮全删致 rest-only=3 差集）。\n", "        // [E] 2026-11-11 parity 二/三轮勘正：TOOLWINDOW 与 LAYERED 系仅在\n        // probeWindows 面（filter_cloaked=true）收录（PixPin/GhostCursor/NVIDIA\n        // Overlay 差集实证）；listApplications 仍滤除两系（官方 apps 无\n        // PixPin/ZCode/svchost 条目实证——三轮差集均为 WS_EX_LAYERED 浮窗）。\n        if (!c->filter_cloaked) {\n          LONG_PTR exL = GetWindowLongW(hwnd, GWL_EXSTYLE);\n          if ((exL & WS_EX_TOOLWINDOW) || (exL & WS_EX_LAYERED)) return TRUE;\n        }\n",
        "EnumTopWindows：listApplications 滤 TOOLWINDOW+LAYERED（W4 三轮实证）"),



]

# 机器管理实现块标记（行首锚定；块内内容全部由本脚本重生成）。
MANAGED_BEGIN = "// >>> [机器管理实现区 begin —— generate-win-rebuilt.py 所有，勿手编] >>>"
MANAGED_END = "// <<< [机器管理实现区 end] <<<"
MANAGED_BEGIN_RE = re.compile(re.escape(MANAGED_BEGIN) + r"\n")
MANAGED_END_RE = re.compile(re.escape(MANAGED_END) + r"\n")

# ---------------------------------------------------------------------------
# ghost 共享常量单一出处（specs §四 L0.3：palette 44 键 / motion 采样 / geometry
# 14 键 / StableSessionIndex 探针表 / fnv1a 兜底）——与 generate-mac-rebuilt.py
# 消费同一 JSON，win ghost 与 mac ghost 是同一官方实现族，防双份漂移。
# W2 批消费 palette.rgb（ghostPaletteSelftest 输出）；motion/geometry 为 mac 专属
# 自检面（win 96 面无此二导出），暂不注入。
# ---------------------------------------------------------------------------
GHOST_SHARED = json.load(open(osp.join(HERE, GHOST_SHARED_CONSTANTS_PATH), encoding="utf-8"))

# ---------------------------------------------------------------------------
# 机器管理实现块 —— W1 追赶批（3 面）
#
# 行为锚 = 官方 0.6.5 win32-x64 addon（native/reverse/reference/win32-0.6.5/
# build/Release/ax_native.node，sha 11f8bc9c…）fresh-process 探针实测，
# 2026-11-10 win 机 tools/probe-one-win.cjs 采集；API 面锚 = 官方 PE 导入表
# （CreateProcessW / QueryFullProcessImageNameW / SHCreateItemFromParsingName /
# CoInitializeEx / VERSION.dll / lstrcmpiW 在场；ShellExecuteEx 缺席）与
# UTF-16 strings（shell:AppsFolder；LaunchApplicationWorker /
# InstalledApplicationsWorker = async 资源名）。证据等级：[S]=导入表/strings 逐字、
# [E]=探针实测、[I]=按证据族推断。
# ---------------------------------------------------------------------------

W1_IMPL = r'''#include <initguid.h>
#include <shlguid.h>  // BHID_EnumItems / CLSID_ShellLink（ShObjIdl_core.h 不含 ShlGuid.h，
                     // 需显式引入；前置 initguid.h 使 DEFINE_GUID 在本翻译单元物化定义，免 uuid.lib 依赖）
#include <winver.h>
#include <map>
#pragma comment(lib, "version.lib")
// （include/pragma 置于实现块顶部而非锁区文件头：锁区前体为 0.5.13/0.6.3 语义
//  底座字节锁，W1 只经生成器追加，不动锁区。winver/version/shlguid/map 仅本块消费。）

static bool WindowMatchesTarget(HWND hwnd, DWORD pid, const std::wstring& bundle) {
  // [E] 官方探针（2026-11-10）：wrong-pid → false（pid 与窗口交叉核验）；
  //     bundleId 内容交叉核验——仅进程全路径命中（垃圾串/短名/空串/null → false），
  //     QueryFullProcessImageNameW + lstrcmpiW 均在官方导入表。
  if (!hwnd || !IsWindow(hwnd)) return false;
  DWORD wpid = 0;
  GetWindowThreadProcessId(hwnd, &wpid);
  if (wpid != pid || bundle.empty()) return false;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, wpid);
  if (!h) return false;
  wchar_t img[1024]{};
  DWORD n = 1024;
  BOOL ok = QueryFullProcessImageNameW(h, 0, img, &n);
  CloseHandle(h);
  return ok && lstrcmpiW(img, bundle.c_str()) == 0;
}

static Napi::Value ActivateWindow(const Napi::CallbackInfo& info) {
  // W1 追赶批：vendored 0.6.3 已有（JS 引用 7 次），还原线自 0.5.13 期参照起未实现。
  // 契约 (pid, bundleId, windowId) => boolean；官方 JS 消费面 :23781/:24642-24652
  // （:24647-24652 拒文案 "could not be atomically raised, focused, activated,
  // and verified"）。[E] 探针：坏参/零值/非串 bundleId/错 pid → false 不抛；
  // 可激活真窗 → true 且前台实切；不可激活窗（StatusBarWnd/Program Manager）→ false
  // （激活后 GetForegroundWindow 复核 = "verified" 语义）。
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !IsNum(info[0]) || !IsStr(info[1]) || !IsNum(info[2]))
    return Napi::Boolean::New(env, false);
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();
  std::wstring bundle = Widen(info[1].As<Napi::String>().Utf8Value());
  HWND hwnd = (HWND)(uintptr_t)(int64_t)info[2].As<Napi::Number>().Int64Value();
  if (!WindowMatchesTarget(hwnd, pid, bundle)) return Napi::Boolean::New(env, false);
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  DWORD fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
  DWORD this_thread = GetCurrentThreadId();
  DWORD target_thread = GetWindowThreadProcessId(hwnd, nullptr);
  AttachThreadInput(this_thread, fg_thread, TRUE);
  AttachThreadInput(this_thread, target_thread, TRUE);
  BringWindowToTop(hwnd);
  SetForegroundWindow(hwnd);
  AttachThreadInput(this_thread, target_thread, FALSE);
  AttachThreadInput(this_thread, fg_thread, FALSE);
  return Napi::Boolean::New(env, GetForegroundWindow() == hwnd);
}

class LaunchApplicationWorker : public Napi::AsyncWorker {
  // [S] 官方 strings async 资源名 "LaunchApplicationWorker"；AUMID 激活链与
  // activateApplicationByAumid 同源（ApplicationActivationManager 外部 COM 服务器，
  // 仅需 CoCreateInstance——官方导入表无 ShellExecuteEx）。
 public:
  LaunchApplicationWorker(Napi::Env env, std::wstring aumid, std::wstring target,
                          std::wstring args)
      : Napi::AsyncWorker(env, "LaunchApplicationWorker"),
        deferred_(Napi::Promise::Deferred::New(env)),
        aumid_(std::move(aumid)), target_(std::move(target)), args_(std::move(args)) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    // [E] 官方探针：aumid 优先且失败不回退 targetPath（bogus AUMID + 有效 target
    //     → null）；伪 AUMID ~40ms COM 尝试后失败 → null。
    if (!aumid_.empty()) {
      // [I] worker 线程自管 COM（官方导入 CoInitializeEx/CoUninitialize）；
      //     shell 激活选 STA。
      HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
      if (SUCCEEDED(hr)) {
        IApplicationActivationManager* mgr = nullptr;
        if (SUCCEEDED(CoCreateInstance(CLSID_ApplicationActivationManager, nullptr,
                                       CLSCTX_LOCAL_SERVER, IID_PPV_ARGS(&mgr))) && mgr) {
          DWORD pid = 0;
          hr = mgr->ActivateApplication(aumid_.c_str(),
                                        args_.empty() ? L"" : args_.c_str(), AO_NONE, &pid);
          mgr->Release();
          if (SUCCEEDED(hr) && pid > 0) pid_ = (int64_t)pid;
        }
        CoUninitialize();
      }
      return;
    }
    if (!target_.empty()) {
      // [S] CreateProcessW 在官方导入表；[E] 不存在路径 → null（快失败）。
      std::wstring cmdline = L"\"" + target_ + L"\"";
      if (!args_.empty()) cmdline += L" " + args_;
      std::vector<wchar_t> cmdbuf(cmdline.begin(), cmdline.end());
      cmdbuf.push_back(L'\0');
      STARTUPINFOW si{};
      si.cb = sizeof(si);
      PROCESS_INFORMATION pi{};
      if (CreateProcessW(nullptr, cmdbuf.data(), nullptr, nullptr, FALSE, 0, nullptr,
                         nullptr, &si, &pi)) {
        pid_ = (int64_t)pi.dwProcessId;
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
      }
    }
  }
  void OnOK() override {
    // [E] 失败 resolve null（非 0 非 reject）；成功 resolve pid（Win11 packaged
    //     notepad 垫片 pid 亦如实返回）。
    deferred_.Resolve(pid_ > 0 ? Napi::Value(Napi::Number::New(Env(), (double)pid_))
                               : Env().Null());
  }

 private:
  Napi::Promise::Deferred deferred_;
  std::wstring aumid_, target_, args_;
  int64_t pid_ = 0;
};

static Napi::Value LaunchApplicationAsync(const Napi::CallbackInfo& info) {
  // W1 追赶批：vendored 0.6.3 已有（JS 引用 3 次）。契约
  // (aumid: string|null, target_path: string|null, arguments: string|null)
  // => Promise<number|null>（官方 entry :30643-30648 消费：>0 有效，否则视为 null）。
  // [E] 非字符串参数按缺省处理（全空 → resolve null，不抛不 reject）。
  Napi::Env env = info.Env();
  std::wstring aumid, target, args;
  if (info.Length() >= 1 && info[0].IsString())
    aumid = Widen(info[0].As<Napi::String>().Utf8Value());
  if (info.Length() >= 2 && info[1].IsString())
    target = Widen(info[1].As<Napi::String>().Utf8Value());
  if (info.Length() >= 3 && info[2].IsString())
    args = Widen(info[2].As<Napi::String>().Utf8Value());
  auto* worker = new LaunchApplicationWorker(env, std::move(aumid), std::move(target),
                                             std::move(args));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

struct InstalledAppRecordData {
  std::string name, aumid, target, args, desc;
};

static std::wstring Hex4Word(unsigned v) {
  const wchar_t* digits = L"0123456789abcdef";
  std::wstring s(4, L'0');
  for (int i = 3; i >= 0; i--) {
    s[i] = digits[v & 0xf];
    v >>= 4;
  }
  return s;
}

static std::string FileDescriptionOf(const std::wstring& exePath) {
  // [S] VERSION.dll（GetFileVersionInfoW）在官方导入表；[E] description = 目标 exe 的
  // FileDescription（cmd → "Windows 命令处理程序"、Electron 系 → "Electron"），
  // 无版本资源/无该字段 → null（"123云盘" 实证）。
  DWORD handle = 0;
  DWORD size = GetFileVersionInfoSizeW(exePath.c_str(), &handle);
  if (!size) return {};
  std::vector<BYTE> buf(size);
  if (!GetFileVersionInfoW(exePath.c_str(), 0, size, buf.data())) return {};
  struct LangCodePage {
    WORD lang, code;
  };
  LangCodePage* tr = nullptr;
  UINT trLen = 0;
  if (!VerQueryValueW(buf.data(), L"\\VarFileInfo\\Translation", (void**)&tr, &trLen) ||
      !tr || trLen < sizeof(*tr))
    return {};
  std::wstring key =
      L"\\StringFileInfo\\" + Hex4Word(tr[0].lang) + Hex4Word(tr[0].code) + L"\\FileDescription";
  wchar_t* desc = nullptr;
  UINT descLen = 0;
  if (VerQueryValueW(buf.data(), key.c_str(), (void**)&desc, &descLen) && desc && desc[0])
    return Narrow(desc);
  return {};
}

static Napi::Object InstalledAppRecord(Napi::Env env, const InstalledAppRecordData& rec) {
  // [E] 官方探针（2026-11-10，本机 252 条）：恒 5 键 name/aumid/target_path/
  // arguments/description（null 槽常在，键序与官方 dump 一致）。packaged = 纯
  // aumid 其余 null；classic = lnk 解析（target_path 仅 .exe，.msi/.chm/.html →
  // null 但记录保留）；lnk 项 aumid 恒 null（Chrome 实证——不读
  // PKEY_AppUserModel_ID）。
  auto obj = Napi::Object::New(env);
  obj.Set("name", Napi::String::New(env, rec.name));
  obj.Set("aumid", rec.aumid.empty() ? env.Null()
                                     : Napi::Value(Napi::String::New(env, rec.aumid)));
  obj.Set("target_path", rec.target.empty() ? env.Null()
                                            : Napi::Value(Napi::String::New(env, rec.target)));
  obj.Set("arguments", rec.args.empty() ? env.Null()
                                        : Napi::Value(Napi::String::New(env, rec.args)));
  obj.Set("description", rec.desc.empty() ? env.Null()
                                          : Napi::Value(Napi::String::New(env, rec.desc)));
  return obj;
}

class InstalledApplicationsWorker : public Napi::AsyncWorker {
  // [S] 官方 strings async 资源名 "InstalledApplicationsWorker"；UTF-16 string
  // "shell:AppsFolder" 在场 + SHCreateItemFromParsingName 导入 → 枚举源定谳
  // （本机对照：枚举 252 项 = 官方记录数 252，前 6 项顺序逐位一致；classic 前
  // packaged 段尾的分组形态同源）。
  //
  // 字段来源（2026-11-10 探针对照迭代定谳，probe-one-win 三轮）：
  //   name/aumid/顺序 ← Apps 枚举（display 名 + '!' 非路径形解析名=AUMID）；
  //   target_path/arguments ← Start Menu lnk 原文（IShellLinkW::GetPath/
  //   GetArguments）——属性存储会吃首尾空格（[E] 卸载向日葵官方 args=
  //   " --mod=uninstall" 带前导空格，store 给修剪版；ADK 项尾随空格同理）；
  //   description ← 目标 exe FileDescription（VERSION.dll），空白串 → null
  //   （[E] Windows 映像和配置设计器官方 null、我方 store/ver 读到 " "）。
  //   [E] 非 .exe 目标（.msc/.msi/.chm/.bat/.html）→ target null 且 arguments
  //   连坐 null（事件查看器/任务计划程序等 MMC 系 target=.msc args="/s" 官方
  //   双 null）；记录本身保留（7-Zip Help 等 name-only 记录）。
 public:
  explicit InstalledApplicationsWorker(Napi::Env env)
      : Napi::AsyncWorker(env, "InstalledApplicationsWorker"),
        deferred_(Napi::Promise::Deferred::New(env)) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    // [I] worker 线程自管 COM（STA，shell 枚举面）；失败静默出空表
    // （JS 侧官方本就 catch(() => [])，:30375）。
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) return;
    BuildStartMenuLnkIndex();
    EnumerateAppsFolder();
    CoUninitialize();
  }
  void OnOK() override {
    Napi::Env env = Env();
    auto arr = Napi::Array::New(env, records_.size());
    for (size_t i = 0; i < records_.size(); i++)
      arr.Set((uint32_t)i, InstalledAppRecord(env, records_[i]));
    deferred_.Resolve(arr);
  }

 private:
  // —— Start Menu lnk 索引：shell:Programs / shell:Common Programs 递归收集 ——
  // .lnk 项（解析名即 .lnk 文件路径），按显示名建索引供 Apps 项原文解析。
  void BuildStartMenuLnkIndex() {
    for (const wchar_t* root : {L"shell:Common Programs", L"shell:Programs"}) {
      IShellItem* folder = nullptr;
      if (FAILED(SHCreateItemFromParsingName(root, nullptr, IID_PPV_ARGS(&folder))) || !folder)
        continue;
      CollectLnkItems(folder);
      folder->Release();
    }
  }

  void CollectLnkItems(IShellItem* folder) {
    IEnumShellItems* en = nullptr;
    if (FAILED(folder->BindToHandler(nullptr, BHID_EnumItems, IID_PPV_ARGS(&en))) || !en)
      return;
    IShellItem* item = nullptr;
    ULONG fetched = 0;
    while (SUCCEEDED(en->Next(1, &item, &fetched)) && fetched == 1 && item) {
      SFGAOF attrs = 0;
      if (SUCCEEDED(item->GetAttributes(SFGAO_FOLDER | SFGAO_STREAM, &attrs)) &&
          (attrs & SFGAO_FOLDER) && !(attrs & SFGAO_STREAM)) {
        CollectLnkItems(item);  // 子目录递归（zip 等 STREAM 伪目录不入）
      } else {
        PWSTR parse = nullptr;
        if (SUCCEEDED(item->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &parse)) && parse) {
          std::wstring lnkPath = parse;
          CoTaskMemFree(parse);
          if (lnkPath.size() > 4 &&
              _wcsicmp(lnkPath.c_str() + lnkPath.size() - 4, L".lnk") == 0) {
            // 索引键 = lnk 项显示名（SIGDN_NORMALDISPLAY）。普通 lnk = 文件名去
            // 扩展；系统 lnk（mmc/ADK 系）显示名来自资源间接串（@dll,-id），与
            // 文件名不同（[E] 部署和映像工具环境官方 args 尾随空格即经此索引命
            // 中；按文件名索引会 miss 落 store 兜底失原样空格）。
            std::wstring name;
            PWSTR dn = nullptr;
            if (SUCCEEDED(item->GetDisplayName(SIGDN_NORMALDISPLAY, &dn)) && dn) {
              name = dn;
              CoTaskMemFree(dn);
            } else {
              name = ShortNameOf(lnkPath);
            }
            if (!name.empty()) {
              LnkRaw raw;
              // [E] 同名 lnk 可重复（云枢/RayLink 各有 Uninstall.lnk）——按名存
              // 多条，消费端以 target 全等配对，勿 first-wins 盲取。
              if (LoadLnkRaw(lnkPath, raw)) lnkIndex_[name].push_back(std::move(raw));
            }
          }
        }
      }
      item->Release();
      item = nullptr;
      fetched = 0;
    }
    en->Release();
  }

  static std::wstring ShortNameOf(const std::wstring& path) {
    // 去目录与 .lnk 扩展（显示名口径）
    size_t cut = path.find_last_of(L"\\/");
    std::wstring base = cut == std::wstring::npos ? path : path.substr(cut + 1);
    if (base.size() > 4 && _wcsicmp(base.c_str() + base.size() - 4, L".lnk") == 0)
      base.resize(base.size() - 4);
    return base;
  }

  struct LnkRaw {
    std::wstring target, args;
  };

  static bool LoadLnkRaw(const std::wstring& lnkPath, LnkRaw& out) {
    // [E] lnk 原文口径：IShellLinkW::GetPath/GetArguments 保留安装器写入的
    // 首尾空格（向日葵/ADK/VMware 实证）——属性存储会给修剪版，故 args 必经本路。
    // 注意 GetPath 对 app-execution-alias 型目标（[E] WSL 条目）可能返回空，
    // 因此 lnk 只作 args 原文源与末位 target 兜底，不覆盖 store 的 target。
    IShellLinkW* link = nullptr;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&link))) || !link)
      return false;
    IPersistFile* pf = nullptr;
    bool ok = false;
    if (SUCCEEDED(link->QueryInterface(IID_PPV_ARGS(&pf))) && pf) {
      if (SUCCEEDED(pf->Load(lnkPath.c_str(), STGM_READ))) {
        wchar_t buf[MAX_PATH * 4]{};
        WIN32_FIND_DATAW fdata{};
        if (SUCCEEDED(link->GetPath(buf, (int)(sizeof(buf) / sizeof(wchar_t)), &fdata,
                                    SLGP_UNCPRIORITY)) &&
            buf[0])
          out.target = buf;
        wchar_t abuf[MAX_PATH * 4]{};
        if (SUCCEEDED(link->GetArguments(abuf, (int)(sizeof(abuf) / sizeof(wchar_t)))) &&
            abuf[0])
          out.args = abuf;
        ok = true;
      }
      pf->Release();
    }
    link->Release();
    return ok;
  }

  // —— Apps 文件夹枚举（输出顺序与记录集的驱动源） ——
  void EnumerateAppsFolder() {
    IShellItem* folder = nullptr;
    if (FAILED(SHCreateItemFromParsingName(L"shell:AppsFolder", nullptr,
                                           IID_PPV_ARGS(&folder))) || !folder)
      return;
    IEnumShellItems* en = nullptr;
    if (SUCCEEDED(folder->BindToHandler(nullptr, BHID_EnumItems, IID_PPV_ARGS(&en))) && en) {
      IShellItem* item = nullptr;
      ULONG fetched = 0;
      while (SUCCEEDED(en->Next(1, &item, &fetched)) && fetched == 1 && item) {
        AppendRecord(item);
        item->Release();
        item = nullptr;
        fetched = 0;
      }
      en->Release();
    }
    folder->Release();
  }

  static bool IsPathLike(const std::wstring& s) {
    return s.find(L':') != std::wstring::npos || s.rfind(L"\\\\", 0) == 0 ||
           s.rfind(L"::", 0) == 0 || s.find(L'\\') != std::wstring::npos;
  }

  void AppendRecord(IShellItem* item) {
    InstalledAppRecordData rec;
    PWSTR name = nullptr;
    if (SUCCEEDED(item->GetDisplayName(SIGDN_NORMALDISPLAY, &name)) && name) {
      rec.name = Narrow(name);
      CoTaskMemFree(name);
    }
    PWSTR parse = nullptr;
    if (SUCCEEDED(item->GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING, &parse)) && parse) {
      std::wstring parseW = parse;
      CoTaskMemFree(parse);
      // [E] '!' 判别须先排路径形：IDM「卸载清除」解析名 =
      // D:\software\IDM\IDM\!)卸载.bat（路径内含 '!'）官方按 classic 记（.bat
      // 非 exe → 全 null 槽）。MSIX/immersive 解析名 = AUMID（含 '!' 且无路径）。
      if (parseW.find(L'!') != std::wstring::npos && !IsPathLike(parseW)) {
        rec.aumid = Narrow(parseW);
      } else {
        ResolveClassicFields(item, parseW, rec);
      }
    }
    if (!rec.name.empty()) records_.push_back(std::move(rec));
  }

  void ResolveClassicFields(IShellItem* item, const std::wstring& parse,
                            InstalledAppRecordData& rec) {
    // target 定序（2026-11-11 三轮探针迭代定谳）：
    //   1) store System.Link.TargetParsingPath —— 保留 lnk 存储原 casing
    //      （[E] VS 命令提示符官方 C:\WINDOWS\system32\cmd.exe 混排与 store 一致，
    //       GetPath 会给盘上规范 casing）；对 alias 型目标（WSL）也稳定出值。
    //   2) 路径形解析名兜底。
    //   3) lnk 原文 GetPath（alias 型可能空，仅末位）。
    std::wstring target, storeArgs;
    IShellItem2* item2 = nullptr;
    if (SUCCEEDED(item->QueryInterface(IID_PPV_ARGS(&item2))) && item2) {
      PROPVARIANT pv{};
      if (SUCCEEDED(item2->GetProperty(PKEY_Link_TargetParsingPath, &pv)) &&
          pv.vt == VT_LPWSTR && pv.pwszVal && pv.pwszVal[0])
        target = pv.pwszVal;
      PropVariantClear(&pv);
      PROPVARIANT pva{};
      if (SUCCEEDED(item2->GetProperty(PKEY_Link_Arguments, &pva)) && pva.vt == VT_LPWSTR &&
          pva.pwszVal && pva.pwszVal[0])
        storeArgs = pva.pwszVal;
      PropVariantClear(&pva);
      item2->Release();
    }
    if (target.empty() && IsPathLike(parse)) target = parse;
    auto it = lnkIndex_.find(Widen(rec.name));
    if (target.empty() && it != lnkIndex_.end()) {
      for (const LnkRaw& raw : it->second)
        if (!raw.target.empty()) { target = raw.target; break; }
    }
    // [E] 非 .exe 目标 → target null 且 args/description 连坐 null；记录保留
    //（.msc/.msi/.chm/.bat/.html 全实证）。
    if (!(target.size() >= 4 && towlower(target[target.size() - 1]) == L'e' &&
          towlower(target[target.size() - 2]) == L'x' &&
          towlower(target[target.size() - 3]) == L'e' && target[target.size() - 4] == L'.'))
      return;
    rec.target = Narrow(target);
    // args：lnk 原文优先（保留首尾空格）。同名多条时以 target 全等（大小写无关）
    // 配对（[E] Uninstall 撞名实证）；无 target 全等且无空目标条目 → store 兜底
    //（失原样空格，仅极端缺位路径）。
    std::wstring args = storeArgs;
    if (it != lnkIndex_.end()) {
      const LnkRaw* matched = nullptr;
      const LnkRaw* emptyTargetWithArgs = nullptr;
      for (const LnkRaw& raw : it->second) {
        if (!raw.target.empty() && lstrcmpiW(raw.target.c_str(), target.c_str()) == 0) {
          matched = &raw;
          break;
        }
        if (raw.target.empty() && !raw.args.empty() && !emptyTargetWithArgs)
          emptyTargetWithArgs = &raw;
      }
      if (matched && !matched->args.empty())
        args = matched->args;
      else if (!matched && emptyTargetWithArgs)
        args = emptyTargetWithArgs->args;  // alias 型：target 空但 args 原文在
    }
    if (!args.empty()) rec.args = Narrow(args);
    std::string desc = FileDescriptionOf(target);
    // [E] 空白串 FileDescription → null（Windows 映像和配置设计器官方 null）
    bool blank = !desc.empty() && desc.find_first_not_of(" \t\r\n") == std::string::npos;
    if (!blank) rec.desc = std::move(desc);
  }

  Napi::Promise::Deferred deferred_;
  std::vector<InstalledAppRecordData> records_;
  std::map<std::wstring, std::vector<LnkRaw>> lnkIndex_;
};

static Napi::Value ListInstalledApplicationsAsync(const Napi::CallbackInfo& info) {
  // W1 追赶批：vendored 0.6.3 已有（JS 引用 1 次）。契约
  // () => Promise<installedApp[]>（官方 entry :30375 消费：缺导出 → JS 兜底空表；
  // 本面恒 resolve，失败路径即空表）。
  Napi::Env env = info.Env();
  auto* worker = new InstalledApplicationsWorker(env);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}
'''

W2_IMPL = r'''
// —— ghost 16 面（mac 血统同族；win 官方形态大幅薄化）——
// [E] 官方 0.6.5 win fresh-process 探针（2026-11-11，probe-one-win ghost face 全
// 转移序列 + 两轮判别探针）：
//   ghostState 恒 8 键 {enabled,shown,multiCursorEnabled,displayGeneration,
//   sessionCount,ready,ripples,groups}；groups 恒空、displayGeneration 恒 1、
//   sessionCount 恒 0、ripples 恒 0、shown 恒 false（探针环境无 overlay 后端，
//   [I] 渲染通道不可观测）；multiCursorEnabled 恒 true（setter 成功返回但状态不翻）。
//   ready 唯一观测转移：enabled 状态下 move/ripple 成功 → true（未 enabled 时 move
//   返回 true 但 ready 不动；move/ripple 两数字参数否则 false）。
//   返回值：init/show/beginAction → false；hide/endAction → true；
//   beginActionWithTitle(kind,session,title) 三参形态 → true（无组副作用）；
//   setEnabled/ setMultiCursorEnabled/ setCapture 接受 bool → true（enabled 随 setter，
//   其余无可观测存储）；setRequestSession/removeSession/sessionTurnEnd 接受字符串 →
//   true（无状态副作用，default 亦可移除形参）。坏参一律 false 不抛。
static bool g_w2GhostEnabled = false;
static bool g_w2GhostReady = false;

static Napi::Value GhostInit(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
static Napi::Value GhostShow(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
static Napi::Value GhostHide(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostMove(const Napi::CallbackInfo& info) {
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return Napi::Boolean::New(info.Env(), false);
  if (g_w2GhostEnabled) g_w2GhostReady = true;
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostClickRipple(const Napi::CallbackInfo& info) {
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return Napi::Boolean::New(info.Env(), false);
  if (g_w2GhostEnabled) g_w2GhostReady = true;
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostBeginAction(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
static Napi::Value GhostBeginActionWithTitle(const Napi::CallbackInfo& info) {
  if (info.Length() < 3 || !IsNum(info[0]) || !IsStr(info[1]) || !IsStr(info[2]))
    return Napi::Boolean::New(info.Env(), false);
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostEndAction(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}
static Napi::Value GhostSetEnabled(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
  g_w2GhostEnabled = info[0].As<Napi::Boolean>().Value();
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostSetMultiCursorEnabled(const Napi::CallbackInfo& info) {
  // [E] setter 成功但 ghostState().multiCursorEnabled 恒 true（无可观测存储）
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostSetCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostSetRequestSession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0])) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostRemoveSession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0])) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostSessionTurnEnd(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0])) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, true);
}
static Napi::Value GhostState(const Napi::CallbackInfo& info) {
  // [E] 8 键（win 官方形态；mac 同族为 23 键——win 渲染后端缺省下的降维 state）
  Napi::Env env = info.Env();
  auto r = Napi::Object::New(env);
  r.Set("enabled", Napi::Boolean::New(env, g_w2GhostEnabled));
  r.Set("shown", Napi::Boolean::New(env, false));
  r.Set("multiCursorEnabled", Napi::Boolean::New(env, true));
  r.Set("displayGeneration", Napi::Number::New(env, 1));
  r.Set("sessionCount", Napi::Number::New(env, 0));
  r.Set("ready", Napi::Boolean::New(env, g_w2GhostReady));
  r.Set("ripples", Napi::Number::New(env, 0));
  r.Set("groups", Napi::Object::New(env));
  return r;
}
static Napi::Value GhostPaletteSelftest(const Napi::CallbackInfo& info) {
  // [E] 官方 win 输出（2026-11-11 探针逐值采集）：palette=11 色 rgb 表，
  // samples={default:#1F8CFF(31,140,255), agent-3:palette[2]}（StableSessionIndex
  // 尾数规则 (3-1)%11=2，与 mac 同族映射）。rgb 注入自 ghost-shared-constants.json
  // 单一出处，禁止手抄双份漂移。
  Napi::Env env = info.Env();
  auto r = Napi::Object::New(env);
  auto pal = Napi::Object::New(env);
@@W2_GHOST_PALETTE_RGB@@
  r.Set("palette", pal);
  auto samples = Napi::Object::New(env);
  {
    auto d = Napi::Object::New(env);
    d.Set("r", Napi::Number::New(env, 31));
    d.Set("g", Napi::Number::New(env, 140));
    d.Set("b", Napi::Number::New(env, 255));
    samples.Set("default", d);
  }
@@W2_GHOST_PALETTE_SAMPLE_AGENT3@@
  r.Set("samples", samples);
  return r;
}

// —— pasteboard 4 面（provided-paste 会话；JS 消费面 :28535-28575/:31362-31383）——
// [E] 官方 0.6.5 win 探针（2026-11-11）：
//   begin(text, format, readerPid)：非双字符串 → TypeError
//   "pasteboardBeginProvidedPaste(text, format) expects two strings"；format 仅
//   "html"/"text"（"text/html"/"HTML Format"/"text/plain"/"image/png"/"rtf"/"" →
//   {ok:false,error:"unsupported_format",token:0}）；成功 {ok:true,error:null,token:N}
//   自增数值 token，接管剪贴板（接管态读文本 → {ok:false,error:"invalid_data"}）。
//   markDispatched(token)：非数 → TypeError "pasteboardMarkProvidedPasteDispatched(token)
//   expects a token"；unknown/已完结 → false；活跃 → true。
//   awaitRead(token,t,g,m)：非数 token → TypeError "pasteboardAwaitProvidedRead(token,
//   timeoutMs, graceMs, minHoldMs) expects a token"；unknown → 8 键 {ok:false,reads:0,
//   readsBeforeDispatch:0,holdMs:0,readerPid:0,refusedReads:0,unverifiedReads:0,error:
//   "unknown_paste_token"}；活跃未读 → 同形 error:"pasteboard_read_timed_out"（超时
//   后返回）。[S] "ProvidedPasteReadWorker"/"ZCodeCuaProvidedPasteOwner"/
//   RegisterClipboardFormatW/GetClipboardOwner/GetOpenClipboardWindow 官方在场。
//   finish(token)：非数 → TypeError "pasteboardFinishProvidedPaste(token) expects a
//   token"；任何数值 token（含 unknown/已完结）→ true；活跃 token 恢复 begin 前剪贴板
//   文本（clipBefore==clipAfter 实证）。
struct W2PasteToken {
  bool active = true;
  bool dispatched = false;
  std::wstring savedText;
  bool hadText = false;
};
static std::map<int, W2PasteToken> g_w2PasteTokens;
static std::mutex g_w2PasteMutex;
static int g_w2PasteNextToken = 0;
static UINT g_w2OwnerFormat = 0;

// begin 的接管动作（worker 线程执行；[S] async 资源名 "ProvidedPasteBeginWorker"）
static int W2TakeOverClipboard(std::wstring* savedText) {
  // 返回 token（>0 成功；0 = 接管失败）。保存文本 → Empty → 仅置 owner 标记
  //（[E] 接管态读文本 invalid_data——文本格式被清空，仅注册格式在场）
  bool hadText = false;
  if (!OpenClipboard(nullptr)) return 0;
  if (IsClipboardFormatAvailable(CF_UNICODETEXT)) {
    HANDLE h = GetClipboardData(CF_UNICODETEXT);
    if (h) {
      if (auto* w = (const wchar_t*)GlobalLock(h)) {
        if (savedText) *savedText = w;
        hadText = true;
        GlobalUnlock(h);
      }
    }
  }
  (void)hadText;
  EmptyClipboard();
  if (!g_w2OwnerFormat)
    g_w2OwnerFormat = RegisterClipboardFormatW(L"ZCodeCuaProvidedPasteOwner");
  if (g_w2OwnerFormat) {
    HGLOBAL marker = GlobalAlloc(GMEM_MOVEABLE, 8);
    if (marker) {
      memcpy(GlobalLock(marker), "W2PBMKR", 8);
      GlobalUnlock(marker);
      if (!SetClipboardData(g_w2OwnerFormat, marker)) GlobalFree(marker);
    }
  }
  CloseClipboard();
  std::lock_guard<std::mutex> lock(g_w2PasteMutex);
  return ++g_w2PasteNextToken;
}

class ProvidedPasteBeginWorker : public Napi::AsyncWorker {
  // [E] 官方支持格式走 async（"text" begin 返回 Promise；unsupported 路径同步
  // 返回结果对象——双形态均 2026-11-11 探针实测）。[S] 资源名 ProvidedPasteBeginWorker。
 public:
  ProvidedPasteBeginWorker(Napi::Env env)
      : Napi::AsyncWorker(env, "ProvidedPasteBeginWorker"),
        deferred_(Napi::Promise::Deferred::New(env)) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    std::wstring saved;
    int token = W2TakeOverClipboard(&saved);
    if (token > 0) {
      std::lock_guard<std::mutex> lock(g_w2PasteMutex);
      W2PasteToken tok;
      tok.savedText = std::move(saved);
      tok.hadText = true;
      g_w2PasteTokens[token] = std::move(tok);
      token_ = token;
    }
  }
  void OnOK() override {
    Napi::Env env = Env();
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, token_ > 0));
    obj.Set("error", token_ > 0 ? env.Null() : Napi::Value(Napi::String::New(env, "pasteboard_write_failed")));
    obj.Set("token", Napi::Number::New(env, (double)token_));
    deferred_.Resolve(obj);
  }

 private:
  Napi::Promise::Deferred deferred_;
  int token_ = 0;
};

static Napi::Value PasteboardBeginProvidedPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsStr(info[0]) || !IsStr(info[1]))
    return TypeErrorThrow(env, "pasteboardBeginProvidedPaste(text, format) expects two strings");
  std::wstring fmt = Widen(info[1].As<Napi::String>().Utf8Value());
  if (!(fmt == L"html" || fmt == L"text")) {
    // [E] 官方 unsupported 路径同步返回（探针 face 直采为普通对象）
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, false));
    obj.Set("error", Napi::String::New(env, "unsupported_format"));
    obj.Set("token", Napi::Number::New(env, 0));
    return obj;
  }
  auto* worker = new ProvidedPasteBeginWorker(env);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

static Napi::Value PasteboardMarkProvidedPasteDispatched(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0]))
    return TypeErrorThrow(env, "pasteboardMarkProvidedPasteDispatched(token) expects a token");
  int token = (int)info[0].As<Napi::Number>().Int32Value();
  std::lock_guard<std::mutex> lock(g_w2PasteMutex);
  auto it = g_w2PasteTokens.find(token);
  if (it == g_w2PasteTokens.end() || !it->second.active)
    return Napi::Boolean::New(env, false);
  it->second.dispatched = true;
  return Napi::Boolean::New(env, true);
}

class ProvidedPasteFinishWorker : public Napi::AsyncWorker {
  // [S] 资源名 "ProvidedPasteFinishWorker"；[E] 任意数值 token → resolve true
 public:
  ProvidedPasteFinishWorker(Napi::Env env, int token)
      : Napi::AsyncWorker(env, "ProvidedPasteFinishWorker"),
        deferred_(Napi::Promise::Deferred::New(env)), token_(token) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    std::wstring saved;
    bool hadText = false, wasActive = false;
    {
      std::lock_guard<std::mutex> lock(g_w2PasteMutex);
      auto it = g_w2PasteTokens.find(token_);
      if (it != g_w2PasteTokens.end() && it->second.active) {
        wasActive = true;
        hadText = it->second.hadText;
        saved = it->second.savedText;
        it->second.active = false;
      }
    }
    if (wasActive) {
      // [E] 恢复 begin 前文本（官方 clipBefore==clipAfter）
      if (OpenClipboard(nullptr)) {
        EmptyClipboard();
        if (hadText) {
          SIZE_T bytes = (saved.size() + 1) * sizeof(wchar_t);
          HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, bytes);
          if (h) {
            memcpy(GlobalLock(h), saved.c_str(), bytes);
            GlobalUnlock(h);
            if (!SetClipboardData(CF_UNICODETEXT, h)) GlobalFree(h);
          }
        }
        CloseClipboard();
      }
    }
  }
  void OnOK() override { deferred_.Resolve(Napi::Boolean::New(Env(), true)); }

 private:
  Napi::Promise::Deferred deferred_;
  int token_;
};

static Napi::Value PasteboardFinishProvidedPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0]))
    return TypeErrorThrow(env, "pasteboardFinishProvidedPaste(token) expects a token");
  int token = (int)info[0].As<Napi::Number>().Int32Value();
  auto* worker = new ProvidedPasteFinishWorker(env, token);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

class ProvidedPasteReadWorker : public Napi::AsyncWorker {
  // [S] 官方 strings async 资源名 "ProvidedPasteReadWorker"。读取计数深语义 [I]：
  // 官方经 owner/open 轮询识别读取方（GetClipboardOwner/GetOpenClipboardWindow
  // 导入在场）；探针环境（无外部读取方）恒 reads=0 → 超时形，此处以 owner 变化
  // 计数为保守对齐。
 public:
  ProvidedPasteReadWorker(Napi::Env env, int token, bool tokenValid, bool dispatchedAtStart,
                          DWORD timeoutMs)
      : Napi::AsyncWorker(env, "ProvidedPasteReadWorker"),
        deferred_(Napi::Promise::Deferred::New(env)),
        token_(token), tokenValid_(tokenValid), dispatchedAtStart_(dispatchedAtStart),
        timeoutMs_(timeoutMs) {}
  Napi::Promise Promise() const { return deferred_.Promise(); }
  void Execute() override {
    if (!tokenValid_) {
      error_ = "unknown_paste_token";
      return;
    }
    ULONGLONG deadline = GetTickCount64() + timeoutMs_;
    HWND lastOwner = GetClipboardOwner();
    while (GetTickCount64() < deadline) {
      Sleep(16);
      HWND owner = GetClipboardOwner();
      if (owner && owner != lastOwner) {
        reads_++;
        if (!dispatchedAtStart_) readsBeforeDispatch_++;
      }
      lastOwner = owner;
    }
    error_ = "pasteboard_read_timed_out";
  }
  void OnOK() override {
    Napi::Env env = Env();
    auto r = Napi::Object::New(env);  // [E] 8 键（键序=官方 dump 原序）
    r.Set("ok", Napi::Boolean::New(env, false));
    r.Set("reads", Napi::Number::New(env, (double)reads_));
    r.Set("readsBeforeDispatch", Napi::Number::New(env, (double)readsBeforeDispatch_));
    r.Set("holdMs", Napi::Number::New(env, 0));
    r.Set("readerPid", Napi::Number::New(env, 0));
    r.Set("refusedReads", Napi::Number::New(env, 0));
    r.Set("unverifiedReads", Napi::Number::New(env, 0));
    r.Set("error", Napi::String::New(env, error_.c_str()));
    deferred_.Resolve(r);
  }

 private:
  Napi::Promise::Deferred deferred_;
  int token_;
  bool tokenValid_, dispatchedAtStart_;
  DWORD timeoutMs_;
  int reads_ = 0, readsBeforeDispatch_ = 0;
  std::string error_;
};

static Napi::Value PasteboardAwaitProvidedRead(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0]))
    return TypeErrorThrow(env,
                          "pasteboardAwaitProvidedRead(token, timeoutMs, graceMs, minHoldMs) "
                          "expects a token");
  int token = (int)info[0].As<Napi::Number>().Int32Value();
  DWORD timeoutMs = info.Length() > 1 && IsNum(info[1])
                        ? (DWORD)info[1].As<Napi::Number>().Uint32Value()
                        : 0;
  bool valid = false, dispatched = false;
  {
    std::lock_guard<std::mutex> lock(g_w2PasteMutex);
    auto it = g_w2PasteTokens.find(token);
    valid = it != g_w2PasteTokens.end() && it->second.active;
    dispatched = valid && it->second.dispatched;
  }
  auto* worker = new ProvidedPasteReadWorker(env, token, valid, dispatched, timeoutMs);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

// —— getWindowId / hasActiveInputHolds ——
static Napi::Value GetWindowId(const Napi::CallbackInfo& info) {
  // [E] 非字符串 → TypeError "getWindowId(ref) expects a string"；空/不在场的 ref
  // → null（非 0 非抛——纯解析形态与硬编码字符串均 null 实证：值取自元素注册表
  // elementAtPoint/readElement 产出，非 ref 文本解析）；活跃元素 ref → 宿主窗 HWND
  // 数值（Pane 等非窗口元素 → 原生窗上溯至首个非零 NativeWindowHandle）。
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "getWindowId(ref) expects a string");
  // 注册表先行（负 RuntimeId 段 rt: ref 不可解析——同 ResolveRefWindowId 注）
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!ref) return env.Null();
    el = ResolveRefToElement(*ref);
  }
  if (!el) return env.Null();
  UIA_HWND hwnd = 0;
  el->get_CurrentNativeWindowHandle(&hwnd);
  if (!hwnd) {
    // 宿主窗上溯：RawViewWalker 逐级父元素至首个非零 NativeWindowHandle（Chromium 深树 ≤256 级）
    IUIAutomation* uia = GetUia();
    IUIAutomationTreeWalker* walker = nullptr;
    if (uia && SUCCEEDED(uia->get_RawViewWalker(&walker)) && walker) {
      IUIAutomationElement* cur = el;
      cur->AddRef();
      for (int i = 0; i < 256 && cur; i++) {
        IUIAutomationElement* parent = nullptr;
        if (FAILED(walker->GetParentElement(cur, &parent)) || !parent) {
          cur->Release();
          cur = nullptr;
          break;
        }
        cur->Release();
        cur = parent;
        UIA_HWND ph = 0;
        cur->get_CurrentNativeWindowHandle(&ph);
        if (ph) {
          hwnd = ph;
          break;
        }
      }
      if (cur) cur->Release();
      walker->Release();
    }
  }
  el->Release();
  return hwnd ? Napi::Number::New(env, (double)(uintptr_t)hwnd) : env.Null();
}

static Napi::Value HasActiveInputHolds(const Napi::CallbackInfo& info) {
  // [E] 官方探针：fresh 进程 / holdKeyGlobal 建压后 / cancel 后 均 false（恒 false
  // 不抛；hold 记账与本面解耦——win 官方 holdKeyGlobal 不驱动此布尔）。
  (void)info;
  return Napi::Boolean::New(info.Env(), false);
}
'''

W3_IMPL = r'''
// —— surface 域 6 面（W3；[E] 官方 0.6.5 win 探针 2026-11-11 全形采集）——
// frameWindowContext 恒 20 键：window_id/window_generation（UIA RuntimeId[2]，与
// 官方 ref ":generation:N" 同源）/producer_id（"<本进程pid>:<FILETIME 100ns 十进制>"，
// 模块级常量）/minimized/pid/tid/bundle_id/owner_window_id/focused_input_window_id
//（GetGUIThreadInfo(hwnd 所属线程).hwndFocus 且根为 hwnd 时取值，否则 0——
// notepad 持焦实测非 0、explorer 后台实测 0）/enabled/visible/is_modal/is_menu/
// bounds[x,y,w,h]/process_start_time（进程创建 FILETIME 十进制串）/
// input{active,focus,capture,menu_owner}（同 GUITHREADINFO 门控）。坏参/坏 hwnd
// → null（不抛）。
static std::string W3ProducerId() {
  static std::string id = [] {
    FILETIME ft{};
    GetSystemTimeAsFileTime(&ft);
    ULONGLONG v = ((ULONGLONG)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
    return std::to_string(GetCurrentProcessId()) + ":" + std::to_string(v);
  }();
  return id;
}
static bool W3IsFiniteInt(const Napi::Value& v) {
  return v.IsNumber() && std::isfinite(v.As<Napi::Number>().DoubleValue()) &&
         v.As<Napi::Number>().DoubleValue() == std::floor(v.As<Napi::Number>().DoubleValue());
}
static int W3WindowGeneration(HWND hwnd) {
  IUIAutomation* uia = GetUia();
  if (!uia) return 1;
  IUIAutomationElement* el = nullptr;
  if (FAILED(uia->ElementFromHandle(hwnd, &el)) || !el) return 1;
  SAFEARRAY* sa = nullptr;
  int gen = 1;
  if (SUCCEEDED(el->GetRuntimeId(&sa)) && sa) {
    LONG lo = 0, hi = 0;
    SafeArrayGetLBound(sa, 1, &lo);
    SafeArrayGetUBound(sa, 1, &hi);
    if (hi - lo + 1 >= 3) {
      int v = 0;
      LONG idx = lo + 2;
      if (SUCCEEDED(SafeArrayGetElement(sa, &idx, &v))) gen = v;
    }
    SafeArrayDestroy(sa);
  }
  el->Release();
  return gen;
}
static std::string W3ProcessStartTime(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return "0";
  FILETIME ft{}, dummy1{}, dummy2{}, dummy3{};
  if (!GetProcessTimes(h, &ft, &dummy1, &dummy2, &dummy3)) ft = {};
  CloseHandle(h);
  ULONGLONG v = ((ULONGLONG)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
  return std::to_string(v);
}
static Napi::Value FrameWindowContext(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsNum(info[0])) return env.Null();
  double raw = info[0].As<Napi::Number>().DoubleValue();
  HWND hwnd = (HWND)(uintptr_t)(int64_t)raw;
  if (!hwnd || !IsWindow(hwnd)) return env.Null();
  DWORD pid = 0;
  DWORD tid = GetWindowThreadProcessId(hwnd, &pid);
  GUITHREADINFO gti{};
  gti.cbSize = sizeof(gti);
  bool hasGti = GetGUIThreadInfo(tid, &gti) != FALSE;
  auto rootOf = [](HWND w) { HWND r = GetAncestor(w, GA_ROOT); return r ? r : w; };
  double focusedInput = 0;
  double inActive = 0, inFocus = 0, inCapture = 0, inMenu = 0;
  if (hasGti) {
    if (gti.hwndFocus && rootOf(gti.hwndFocus) == hwnd) focusedInput = (double)(uintptr_t)gti.hwndFocus;
    if (gti.hwndActive && rootOf(gti.hwndActive) == hwnd) inActive = (double)(uintptr_t)gti.hwndActive;
    if (focusedInput) inFocus = focusedInput;
    if (gti.hwndCapture && rootOf(gti.hwndCapture) == hwnd) inCapture = (double)(uintptr_t)gti.hwndCapture;
    if (gti.hwndMenuOwner && rootOf(gti.hwndMenuOwner) == hwnd) inMenu = (double)(uintptr_t)gti.hwndMenuOwner;
  }
  wchar_t img[1024]{};
  {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (h) {
      DWORD n = 1024;
      if (!QueryFullProcessImageNameW(h, 0, img, &n)) img[0] = 0;
      CloseHandle(h);
    }
  }
  RECT r{};
  GetWindowRect(hwnd, &r);
  wchar_t cls[256]{};
  GetClassNameW(hwnd, cls, 256);
  HWND owner = GetWindow(hwnd, GW_OWNER);
  auto obj = Napi::Object::New(env);
  obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
  obj.Set("window_generation", Napi::Number::New(env, W3WindowGeneration(hwnd)));
  obj.Set("producer_id", Napi::String::New(env, W3ProducerId()));
  obj.Set("minimized", Napi::Boolean::New(env, IsIconic(hwnd) != FALSE));
  obj.Set("pid", Napi::Number::New(env, (double)pid));
  obj.Set("tid", Napi::Number::New(env, (double)tid));
  obj.Set("bundle_id", Napi::String::New(env, Narrow(img)));
  obj.Set("owner_window_id", Napi::Number::New(env, (double)(uintptr_t)(owner ? owner : 0)));
  obj.Set("focused_input_window_id", Napi::Number::New(env, focusedInput));
  obj.Set("enabled", Napi::Boolean::New(env, IsWindowEnabled(hwnd) != FALSE));
  obj.Set("visible", Napi::Boolean::New(env, IsWindowVisible(hwnd) != FALSE));
  obj.Set("is_modal", Napi::Boolean::New(env, owner != nullptr && !IsWindowEnabled(hwnd)));
  obj.Set("is_menu", Napi::Boolean::New(env, wcscmp(cls, L"#32768") == 0));
  obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  obj.Set("process_start_time", Napi::String::New(env, W3ProcessStartTime(pid)));
  auto input = Napi::Object::New(env);
  input.Set("active", Napi::Number::New(env, inActive));
  input.Set("focus", Napi::Number::New(env, inFocus));
  input.Set("capture", Napi::Number::New(env, inCapture));
  input.Set("menu_owner", Napi::Number::New(env, inMenu));
  obj.Set("input", input);
  return obj;
}
static Napi::Value GetForegroundRootWindowId(const Napi::CallbackInfo& info) {
  // [E] 参数被忽略（坏参同值）；前台根窗 GA_ROOT；无前台 → 0 形态由消费方判
  (void)info;
  HWND fg = GetForegroundWindow();
  HWND root = fg ? GetAncestor(fg, GA_ROOT) : nullptr;
  return Napi::Number::New(info.Env(), (double)(uintptr_t)(root ? root : fg));
}
static Napi::Value ResolveRefWindowId(const Napi::Env& env, const Napi::CallbackInfo& info) {
  // getWindowId 与 getDispatchWindowId 共用（[E] 后者抛 getWindowId 同款文案=同链）。
  // 注册表精确匹配先行：rt: ref 的 RuntimeId 段可为负（实测 "42-10033500-4--4179"），
  // '-' 连接序列化后 ParseRef 空段判 null——解析在查找之后仅作兜底。
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "getWindowId(ref) expects a string");
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto ref = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!ref) return env.Null();
    el = ResolveRefToElement(*ref);
  }
  if (!el) return env.Null();
  UIA_HWND hwnd = 0;
  el->get_CurrentNativeWindowHandle(&hwnd);
  if (!hwnd) {
    IUIAutomation* uia = GetUia();
    IUIAutomationTreeWalker* walker = nullptr;
    if (uia && SUCCEEDED(uia->get_RawViewWalker(&walker)) && walker) {
      IUIAutomationElement* cur = el;
      cur->AddRef();
      for (int i = 0; i < 256 && cur; i++) {
        IUIAutomationElement* parent = nullptr;
        if (FAILED(walker->GetParentElement(cur, &parent)) || !parent) {
          cur->Release();
          cur = nullptr;
          break;
        }
        cur->Release();
        cur = parent;
        UIA_HWND ph = 0;
        cur->get_CurrentNativeWindowHandle(&ph);
        if (ph) {
          hwnd = ph;
          break;
        }
      }
      if (cur) cur->Release();
      walker->Release();
    }
  }
  el->Release();
  return hwnd ? Napi::Number::New(env, (double)(uintptr_t)hwnd) : env.Null();
}
static Napi::Value GetDispatchWindowId(const Napi::CallbackInfo& info) {
  return ResolveRefWindowId(info.Env(), info);
}
static Napi::Value RestoreForegroundWindow(const Napi::CallbackInfo& info) {
  // [E] 非数对 → false；坏 hwnd → false。恢复舞 = W1 activateWindow 同族。
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return Napi::Boolean::New(env, false);
  HWND prev = (HWND)(uintptr_t)(int64_t)info[0].As<Napi::Number>().DoubleValue();
  HWND target = (HWND)(uintptr_t)(int64_t)info[1].As<Napi::Number>().DoubleValue();
  if (!IsWindow(prev) || !IsWindow(target)) return Napi::Boolean::New(env, false);
  if (IsIconic(target)) ShowWindow(target, SW_RESTORE);
  DWORD fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
  DWORD this_thread = GetCurrentThreadId();
  DWORD target_thread = GetWindowThreadProcessId(target, nullptr);
  AttachThreadInput(this_thread, fg_thread, TRUE);
  AttachThreadInput(this_thread, target_thread, TRUE);
  BringWindowToTop(target);
  SetForegroundWindow(target);
  AttachThreadInput(this_thread, target_thread, FALSE);
  AttachThreadInput(this_thread, fg_thread, FALSE);
  return Napi::Boolean::New(env, GetForegroundWindow() == target);
}

// classifyPostMessageDelivery：[E] 坏类型/坏 kind → false；坏 hwnd 数值 →
// {delivery:"deliverable", host:"unknown"}；Chrome_WidgetWin_*/CefBrowser*（UTF-16
// 指纹 [S] 官方窗口类表族）→ {delivery:"dropped", host:"chromium"}；其余 →
// {delivery:"deliverable", host:"unknown"}（wpf/winui3 等细分由 JS 侧 fallback 承载）。
static Napi::Value ClassifyPostMessageDelivery(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsStr(info[1])) return Napi::Boolean::New(env, false);
  static const char* kKinds[] = {"mouse_click", "text_input", "mouse_scroll",
                                 "mouse_move", "key_combo", "keystroke"};
  std::string kind = info[1].As<Napi::String>().Utf8Value();
  bool known = false;
  for (const char* k : kKinds) if (kind == k) { known = true; break; }
  if (!known) return Napi::Boolean::New(env, false);
  HWND hwnd = (HWND)(uintptr_t)(int64_t)info[0].As<Napi::Number>().DoubleValue();
  wchar_t cls[256]{};
  if (hwnd && IsWindow(hwnd)) GetClassNameW(hwnd, cls, 256);
  std::wstring c(cls);
  bool chromium = c.rfind(L"Chrome_WidgetWin_", 0) == 0 || c.rfind(L"CefBrowser", 0) == 0 ||
                  c.rfind(L"yChrome_WidgetWin_", 0) == 0;
  auto obj = Napi::Object::New(env);
  obj.Set("delivery", Napi::String::New(env, chromium ? "dropped" : "deliverable"));
  obj.Set("host", Napi::String::New(env, chromium ? "chromium" : "unknown"));
  return obj;
}

// enumerateSurfacesForFrame：[E] 非双数 → TypeError；坏 hwnd → null；真窗 →
// {surfaces:[presentation_root(+owned 同 pid 面)], independent_candidates:[同 pid
// 未归属窗 ×attribution_failure:no_owner_no_uia_no_menu_state], decorative_summaries:
// [{label:"Class ×N",count,representative_window_id}], filtered:[其余可见窗 ×reason
// 词表 mandatory:invisible/cloaked:1|2/mandatory:no_client/decorative:shadow_owner_form/
// decorative:layered_clickthrough/unattributed_other_exe]}。layer 为官方内部计数
//（[I] 不可导出，探针归一化）。attribution/classification 词表 [S] strings。
struct W3EnumCtx {
  Napi::Env env;
  DWORD rootPid = 0;
  HWND root = nullptr;
  Napi::Array surfaces, candidates, decorative, filtered;
  std::map<std::wstring, int> decorativeCounts;
  std::map<std::wstring, HWND> decorativeReps;
};
static Napi::Value EnumerateSurfacesForFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1]))
    return TypeErrorThrow(env, "enumerateSurfacesForFrame(pid, rootHwnd) expects two numbers");
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Uint32Value();
  HWND root = (HWND)(uintptr_t)(int64_t)info[1].As<Napi::Number>().DoubleValue();
  if (!root || !IsWindow(root)) return env.Null();
  W3EnumCtx ctx{env, pid, root, Napi::Array::New(env, 0), Napi::Array::New(env, 0),
                Napi::Array::New(env, 0), Napi::Array::New(env, 0)};
  auto pushSurface = [&](HWND hwnd, const char* relation) {
    DWORD wpid = 0;
    DWORD wtid = GetWindowThreadProcessId(hwnd, &wpid);
    wchar_t cls[256]{}, title[512]{};
    GetClassNameW(hwnd, cls, 256);
    GetWindowTextW(hwnd, title, 512);
    RECT r{};
    GetWindowRect(hwnd, &r);
    auto obj = Napi::Object::New(ctx.env);
    obj.Set("window_id", Napi::Number::New(ctx.env, (double)(uintptr_t)hwnd));
    obj.Set("pid", Napi::Number::New(ctx.env, (double)wpid));
    obj.Set("tid", Napi::Number::New(ctx.env, (double)wtid));
    obj.Set("class_name", Napi::String::New(ctx.env, Narrow(cls)));
    obj.Set("title", title[0] ? Napi::Value(Napi::String::New(ctx.env, Narrow(title))) : ctx.env.Null());
    obj.Set("bounds", BoundsArray(ctx.env, r.left, r.top, r.right - r.left, r.bottom - r.top));
    obj.Set("layer", Napi::Number::New(ctx.env, 0));  // [I] 官方内部计数不可导出
    obj.Set("surface_kind", Napi::String::New(ctx.env, "window"));
    obj.Set("relation", Napi::String::New(ctx.env, relation));
    ctx.surfaces.Set(ctx.surfaces.Length(), obj);
  };
  pushSurface(root, "presentation_root");
  // owned 同 pid 面枚举（[I] 关系名按族推断；探针环境无 owned 面出场）
  struct OwnedCtx {
    W3EnumCtx* c;
    std::vector<HWND> hits;
  } octx{&ctx, {}};
  EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
    auto* oc = (OwnedCtx*)lp;
    if (hwnd == oc->c->root) return TRUE;
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    if (wpid != oc->c->rootPid) return TRUE;
    HWND owner = GetWindow(hwnd, GW_OWNER);
    if (owner == oc->c->root && IsWindowVisible(hwnd)) oc->hits.push_back(hwnd);
    return TRUE;
  }, (LPARAM)&octx);
  for (HWND h : octx.hits) pushSurface(h, "owned_popup");
  // 全窗分类：candidates（同 pid 未归属）/ filtered（词表）/ decorative 汇总
  struct ClassCtx {
    W3EnumCtx* c;
    std::vector<HWND> candidates, filteredInvisible, filteredCloak1, filteredCloak2,
        filteredNoClient, filteredShadow, filteredClickthrough, filteredOther, decorativeOrder;
  } cctx{&ctx};
  EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
    auto* cc = (ClassCtx*)lp;
    if (hwnd == cc->c->root) return TRUE;
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    if (GetWindow(hwnd, GW_OWNER) == cc->c->root) return TRUE;
    wchar_t cls[256]{};
    GetClassNameW(hwnd, cls, 256);
    std::wstring c(cls);
    // 判序（[E] 官方 filtered 词表分布推断）：SysShadow 按类名归因（先于可见性
    // ——影子窗可见态不稳）→ invisible → cloaked → no_client → decorative（精确
    // 类名，substring 会撞 TIMER 含 IME 的假阳性）→ layered_clickthrough → other。
    if (c == L"SysShadow") {
      cc->filteredShadow.push_back(hwnd);
      return TRUE;
    }
    bool visible = IsWindowVisible(hwnd) != FALSE;
    RECT r{};
    GetWindowRect(hwnd, &r);
    bool noClient = r.right - r.left <= 0 || r.bottom - r.top <= 0;
    int cloaked = 0;
    using DwmGetWinAttrFn = HRESULT(WINAPI*)(HWND, DWORD, void*, DWORD);
    static DwmGetWinAttrFn dwmFn = []() -> DwmGetWinAttrFn {
      HMODULE m = GetModuleHandleW(L"dwmapi.dll");
      return m ? (DwmGetWinAttrFn)GetProcAddress(m, "DwmGetWindowAttribute") : nullptr;
    }();
    if (dwmFn) dwmFn(hwnd, 14 /*DWMWA_CLOAKED*/, &cloaked, sizeof(cloaked));
    if (!visible) {
      cc->filteredInvisible.push_back(hwnd);
      return TRUE;
    }
    if (cloaked == 1 || cloaked == 2 || cloaked == 3) {
      (cloaked == 1 ? cc->filteredCloak1 : cc->filteredCloak2).push_back(hwnd);
      return TRUE;
    }
    // decorative 类族（[E] 2026-11-11 shadow-hunt 实证集：Qt5151*QWindow* /
    // default_ime* / CEF-OSC-WIDGET / SoPY_Status / ZcodeGhostCursorOverlay /
    // tooltips/MSCTFIME/Default IME/IME；wetype/WeType 非装饰属 invisible）。
    // 分路（[E] 同类族两出路口径）：owner 链归属本帧 → decorative_summaries；
    // 未归属 → filtered reason decorative:shadow_owner_form（先于 no_client——
    // 影子窗矩形常零尺寸，按类名归因优先）。
    bool decorative = c == L"tooltips_class32" || c == L"MSCTFIME UI" ||
                      c == L"Default IME" || c == L"IME" || c == L"SoPY_Status" ||
                      c == L"CEF-OSC-WIDGET" ||
                      c.rfind(L"ZcodeGhostCursorOverlay", 0) == 0 ||
                      c.rfind(L"default_ime", 0) == 0 ||
                      c.rfind(L"Qt51513QWindowTool", 0) == 0 ||
                      c.rfind(L"Qt51519QWindowTool", 0) == 0 ||
                      c.rfind(L"Qt51513QWindowIcon", 0) == 0;
    if (decorative) {
      HWND w = hwnd;
      bool attributed = false;
      while (w) {
        HWND owner = GetWindow(w, GW_OWNER);
        if (!owner) break;
        if (owner == cc->c->root) {
          attributed = true;
          break;
        }
        w = owner;
      }
      if (attributed) {
        cc->c->decorativeCounts[c]++;
        cc->c->decorativeReps.emplace(c, hwnd);
      } else {
        cc->filteredShadow.push_back(hwnd);
      }
      return TRUE;
    }
    if (noClient) {
      cc->filteredNoClient.push_back(hwnd);
      return TRUE;
    }
    LONG_PTR ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    bool layeredClickthrough = (ex & WS_EX_LAYERED) && (ex & WS_EX_TRANSPARENT);
    if (layeredClickthrough) {
      cc->filteredClickthrough.push_back(hwnd);
      return TRUE;
    }
    if (wpid == cc->c->rootPid) {
      cc->candidates.push_back(hwnd);
    } else {
      cc->filteredOther.push_back(hwnd);
    }
    return TRUE;
  }, (LPARAM)&cctx);
  auto pushCandidate = [&](HWND hwnd) {
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    wchar_t cls[256]{}, title[512]{};
    GetClassNameW(hwnd, cls, 256);
    GetWindowTextW(hwnd, title, 512);
    RECT r{};
    GetWindowRect(hwnd, &r);
    auto obj = Napi::Object::New(env);
    obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
    obj.Set("pid", Napi::Number::New(env, (double)wpid));
    obj.Set("class_name", Napi::String::New(env, Narrow(cls)));
    obj.Set("title", title[0] ? Napi::Value(Napi::String::New(env, Narrow(title))) : env.Null());
    obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
    obj.Set("layer", Napi::Number::New(env, 0));
    obj.Set("attribution_failure", Napi::String::New(env, "no_owner_no_uia_no_menu_state"));
    ctx.candidates.Set(ctx.candidates.Length(), obj);
  };
  for (HWND h : cctx.candidates) pushCandidate(h);
  auto pushFiltered = [&](HWND hwnd, const char* reason) {
    DWORD wpid = 0;
    GetWindowThreadProcessId(hwnd, &wpid);
    wchar_t cls[256]{};
    GetClassNameW(hwnd, cls, 256);
    auto obj = Napi::Object::New(env);
    obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
    obj.Set("class_name", Napi::String::New(env, Narrow(cls)));
    obj.Set("pid", Napi::Number::New(env, (double)wpid));
    obj.Set("reason", Napi::String::New(env, reason));
    ctx.filtered.Set(ctx.filtered.Length(), obj);
  };
  for (HWND h : cctx.filteredInvisible) pushFiltered(h, "mandatory:invisible");
  for (HWND h : cctx.filteredCloak1) pushFiltered(h, "cloaked:1");
  for (HWND h : cctx.filteredCloak2) pushFiltered(h, "cloaked:2");
  for (HWND h : cctx.filteredNoClient) pushFiltered(h, "mandatory:no_client");
  for (HWND h : cctx.filteredShadow) pushFiltered(h, "decorative:shadow_owner_form");
  for (HWND h : cctx.filteredClickthrough) pushFiltered(h, "decorative:layered_clickthrough");
  for (HWND h : cctx.filteredOther) pushFiltered(h, "unattributed_other_exe");
  for (auto& [cls, count] : ctx.decorativeCounts) {
    auto d = Napi::Object::New(env);
    d.Set("label", Napi::String::New(env, Narrow(cls) + " ×" + std::to_string(count)));
    d.Set("count", Napi::Number::New(env, (double)count));
    d.Set("representative_window_id",
          Napi::Number::New(env, (double)(uintptr_t)ctx.decorativeReps[cls]));
    ctx.decorative.Set(ctx.decorative.Length(), d);
  }
  auto result = Napi::Object::New(env);
  result.Set("surfaces", ctx.surfaces);
  result.Set("independent_candidates", ctx.candidates);
  result.Set("decorative_summaries", ctx.decorative);
  result.Set("filtered", ctx.filtered);
  return result;
}

// —— postMessage 投递 5 面（[E] notepad 探针全 ok/错误码族；TypeError 文案 [S]）——
// 通用：windowId 非有限整数/坏窗 → {ok:false,error:"invalid_target"}（[E] float/0
// 实测）；scroll 无前台门（explorer 后台 ok 实测）；key/char 有前台焦点门（explorer
// 后台 focus_missing / notepad 持焦 ok 实测）；click/drag/scroll 后台可投（同探针）。
// chromium 窗原生层不拒（[E] chrome 直投 ok——JS 层 classify 预滤是唯一闸）。
static Napi::Object W3PmError(Napi::Env env, const char* err) {
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, false));
  obj.Set("error", Napi::String::New(env, err));
  return obj;
}
static Napi::Object W3PmOk(Napi::Env env) {
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, true));
  return obj;
}
static bool W3PmValidWindow(const Napi::CallbackInfo& info, size_t idx, HWND* out) {
  if (idx >= info.Length() || !W3IsFiniteInt(info[idx])) {
    *out = nullptr;
    return false;
  }
  double raw = info[idx].As<Napi::Number>().DoubleValue();
  HWND h = (HWND)(uintptr_t)(int64_t)raw;
  *out = (h && IsWindow(h)) ? h : nullptr;
  return h != nullptr;  // 数值合法（含 0）→ 走 invalid_target；类型坏 → 抛
}
static bool W3ThreadHasFocus(HWND hwnd) {
  DWORD tid = GetWindowThreadProcessId(hwnd, nullptr);
  GUITHREADINFO gti{};
  gti.cbSize = sizeof(gti);
  return GetGUIThreadInfo(tid, &gti) && gti.hwndFocus != nullptr;
}
static Napi::Value PostMessageScrollAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]) || !IsNum(info[3]))
    return TypeErrorThrow(env,
                          "postMessageScrollAsync(windowId, pid, direction, amount) expects "
                          "numbers, a direction string, and an amount");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  std::string dir = info[2].As<Napi::String>().Utf8Value();
  UINT msg = WM_VSCROLL;
  WPARAM wp = SB_LINEDOWN;
  if (dir == "down") { msg = WM_VSCROLL; wp = SB_LINEDOWN; }
  else if (dir == "up") { msg = WM_VSCROLL; wp = SB_LINEUP; }
  else if (dir == "left") { msg = WM_HSCROLL; wp = SB_LINELEFT; }
  else if (dir == "right") { msg = WM_HSCROLL; wp = SB_LINERIGHT; }
  else {
    deferred.Resolve(W3PmError(env, "invalid_direction"));
    return deferred.Promise();
  }
  int amount = (int)info[3].As<Napi::Number>().Int32Value();
  for (int i = 0; i < (amount > 0 ? amount : 1); i++) PostMessageW(hwnd, msg, wp, 0);
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}
static Napi::Value PostMessageKeyAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "postMessageKeyAsync(windowId, pid, chord) expects numbers and a string");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  if (!W3ThreadHasFocus(hwnd)) {
    deferred.Resolve(W3PmError(env, "focus_missing"));
    return deferred.Promise();
  }
  std::string chord = info[2].As<Napi::String>().Utf8Value();
  // 和弦→末键 VK（复用全局按键语义：修饰+键；此处按单键/常见名解析）
  UINT vk = 0;
  std::string key = chord;
  size_t plus = chord.rfind('+');
  if (plus != std::string::npos) key = chord.substr(plus + 1);
  if (key.size() == 1) vk = (UINT)toupper(key[0]);
  else if (key == "enter") vk = VK_RETURN;
  else if (key == "f5") vk = VK_F5;
  else if (key == "tab") vk = VK_TAB;
  else if (key == "escape") vk = VK_ESCAPE;
  else if (key.size() == 2 && key[0] == 'f' && key[1] >= '1' && key[1] <= '9') vk = VK_F1 + (key[1] - '1');
  if (!vk) {
    deferred.Resolve(W3PmError(env, "invalid_key"));
    return deferred.Promise();
  }
  PostMessageW(hwnd, WM_KEYDOWN, vk, 0);
  PostMessageW(hwnd, WM_KEYUP, vk, 0);
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}
static Napi::Value PostMessageCharAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "postMessageCharAsync(windowId, pid, text, elementRef?) expects "
                          "numbers and strings");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  if (!W3ThreadHasFocus(hwnd)) {
    deferred.Resolve(W3PmError(env, "focus_missing"));
    return deferred.Promise();
  }
  std::wstring text = Widen(info[2].As<Napi::String>().Utf8Value());
  for (wchar_t ch : text) PostMessageW(hwnd, WM_CHAR, (WPARAM)ch, 0);
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}
static Napi::Value PostMessageClickAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 6 || !IsNum(info[0]) || !IsNum(info[1]) || !IsNum(info[2]) ||
      !IsNum(info[3]) || !IsStr(info[4]) || !IsNum(info[5]))
    return TypeErrorThrow(env,
                          "postMessageClickAsync(windowId, pid, x, y, button, clicks) expects "
                          "numbers, a button string, and a click count");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  LONG x = (LONG)info[2].As<Napi::Number>().Int32Value();
  LONG y = (LONG)info[3].As<Napi::Number>().Int32Value();
  std::string button = info[4].As<Napi::String>().Utf8Value();
  int clicks = (int)info[5].As<Napi::Number>().Int32Value();
  UINT down = button == "right" ? WM_RBUTTONDOWN : WM_LBUTTONDOWN;
  UINT up = button == "right" ? WM_RBUTTONUP : WM_LBUTTONUP;
  // 客户区坐标（[I] 官方坐标系按客户区投递推断；screen→client 转换）
  POINT p{x, y};
  ScreenToClient(hwnd, &p);
  LPARAM lp = MAKELPARAM(p.x, p.y);
  for (int i = 0; i < (clicks > 0 ? clicks : 1); i++) {
    PostMessageW(hwnd, down, MK_LBUTTON, lp);
    PostMessageW(hwnd, up, 0, lp);
  }
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}
static Napi::Value PostMessageDragAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 6 || !IsNum(info[0]) || !IsNum(info[1]) || !IsNum(info[2]) ||
      !IsNum(info[3]) || !IsNum(info[4]) || !IsNum(info[5]))
    return TypeErrorThrow(env,
                          "postMessageDragAsync(windowId, pid, fromX, fromY, toX, toY) expects "
                          "numbers");
  auto deferred = Napi::Promise::Deferred::New(env);
  HWND hwnd = nullptr;
  if (!W3PmValidWindow(info, 0, &hwnd) || !hwnd) {
    deferred.Resolve(W3PmError(env, "invalid_target"));
    return deferred.Promise();
  }
  POINT from{(LONG)info[2].As<Napi::Number>().Int32Value(),
             (LONG)info[3].As<Napi::Number>().Int32Value()};
  POINT to{(LONG)info[4].As<Napi::Number>().Int32Value(),
           (LONG)info[5].As<Napi::Number>().Int32Value()};
  ScreenToClient(hwnd, &from);
  ScreenToClient(hwnd, &to);
  PostMessageW(hwnd, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(from.x, from.y));
  PostMessageW(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(from.x, from.y));
  int steps = 8;
  for (int i = 1; i <= steps; i++) {
    LONG x = from.x + (to.x - from.x) * i / steps;
    LONG y = from.y + (to.y - from.y) * i / steps;
    PostMessageW(hwnd, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(x, y));
  }
  PostMessageW(hwnd, WM_LBUTTONUP, 0, MAKELPARAM(to.x, to.y));
  deferred.Resolve(W3PmOk(env));
  return deferred.Promise();
}

// —— UIA 模式梯 4 面 + 元素句柄对 ——
// winAxElementFromToken：[E] 非 string → TypeError；"ptr:<pid>:<HEX64>" 原生指针
// 形态；rt: 注册表 ref 亦可解析；未知 → {ok:false, reason:"token_unknown"}；
// 成功 {ok:true, element:BigInt(指针)}。winAxElementRelease：成功 true/坏参 false。
static bool W3ParsePtrRef(const std::string& ref, uintptr_t* out) {
  if (ref.compare(0, 4, "ptr:") != 0) return false;
  size_t c1 = ref.find(':', 4);
  if (c1 == std::string::npos) return false;
  std::string hex = ref.substr(c1 + 1);
  if (hex.empty()) return false;
  for (char ch : hex)
    if (!isxdigit((unsigned char)ch)) return false;
  *out = (uintptr_t)strtoull(hex.c_str(), nullptr, 16);
  return *out != 0;
}
static Napi::Value WinAxElementFromToken(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "winAxElementFromToken(ref) expects a string");
  std::string ref = info[0].As<Napi::String>().Utf8Value();
  uintptr_t ptr = 0;
  if (W3ParsePtrRef(ref, &ptr)) {
    // [E] 任意 hex（如 "ptr:0:DEADBEEF"）→ token_unknown：ptr: 形态须指向
    // 元素注册表内在场指针（活性校验），不接受裸十六进制。
    IUIAutomationElement* live = nullptr;
    {
      std::lock_guard<std::mutex> lock(g_element_map_mutex);
      for (auto& [k, v] : g_element_map) {
        if ((uintptr_t)v == ptr) {
          live = v;
          break;
        }
      }
    }
    if (live) {
      live->AddRef();  // token 持专有引用：winAxElementRelease 消费本引用
      auto obj = Napi::Object::New(env);
      obj.Set("ok", Napi::Boolean::New(env, true));
      obj.Set("element", Napi::BigInt::New(env, (uint64_t)ptr));
      return obj;
    }
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, false));
    obj.Set("reason", Napi::String::New(env, "token_unknown"));
    return obj;
  }
  IUIAutomationElement* el = LookupElementRef(ref);
  if (!el) {
    auto pr = ParseRef(ref);
    if (pr) el = ResolveRefToElement(*pr);
  }
  if (!el) {
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, false));
    obj.Set("reason", Napi::String::New(env, "token_unknown"));
    return obj;
  }
  // lookup 的 AddRef 引用即 token 所有权：移交（winAxElementRelease 消费）；
  // 就地 Release 会与 Release 面双重释放打穿注册表引用（实测 0xC0000374）。
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, true));
  obj.Set("element", Napi::BigInt::New(env, (uint64_t)(uintptr_t)el));
  return obj;
}
static Napi::Value WinAxElementRelease(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) return Napi::Boolean::New(env, false);
  bool lossy = false;
  uint64_t raw = info[0].As<Napi::BigInt>().Uint64Value(&lossy);
  auto* el = (IUIAutomationElement*)(uintptr_t)raw;
  if (!el) return Napi::Boolean::New(env, false);
  el->Release();
  return Napi::Boolean::New(env, true);
}
static Napi::Value ElementValueReadAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsBigInt() || !IsNum(info[1]))
    return TypeErrorThrow(env, "elementValueReadAsync(elementRef, hostWindowId) expects a bigint and a number");
  auto deferred = Napi::Promise::Deferred::New(env);
  bool lossy = false;
  auto* el = (IUIAutomationElement*)(uintptr_t)info[0].As<Napi::BigInt>().Uint64Value(&lossy);
  auto result = Napi::Object::New(env);
  if (!el) {
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("value", env.Null());
    deferred.Resolve(result);
    return deferred.Promise();
  }
  IUIAutomationValuePattern* vp = nullptr;
  std::wstring value;
  bool ok = false;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_ValuePatternId,
                                        __uuidof(IUIAutomationValuePattern), (void**)&vp)) && vp) {
    BSTR v = nullptr;
    if (SUCCEEDED(vp->get_CurrentValue(&v))) {
      value = v ? v : L"";
      ok = true;
      if (v) SysFreeString(v);
    }
    vp->Release();
  }
  result.Set("ok", Napi::Boolean::New(env, ok));
  result.Set("value", ok ? Napi::Value(Napi::String::New(env, Narrow(value))) : env.Null());
  deferred.Resolve(result);
  return deferred.Promise();
}
static Napi::Value SetValueReadbackAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBigInt() || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "setValueReadbackAsync(elementRef, hostWindowId, value) expects a "
                          "bigint, a number, and a string");
  auto deferred = Napi::Promise::Deferred::New(env);
  bool lossy = false;
  auto* el = (IUIAutomationElement*)(uintptr_t)info[0].As<Napi::BigInt>().Uint64Value(&lossy);
  std::wstring value = Widen(info[2].As<Napi::String>().Utf8Value());
  // before 读
  std::wstring before;
  bool hasBefore = false;
  IUIAutomationValuePattern* vp = nullptr;
  if (el && SUCCEEDED(el->GetCurrentPatternAs(UIA_ValuePatternId,
                                              __uuidof(IUIAutomationValuePattern), (void**)&vp)) && vp) {
    BSTR v = nullptr;
    if (SUCCEEDED(vp->get_CurrentValue(&v))) {
      before = v ? v : L"";
      hasBefore = true;
      if (v) SysFreeString(v);
    }
    // 写
    BSTR b = SysAllocStringLen(value.data(), (UINT)value.size());
    HRESULT writeHr = vp->SetValue(b);
    SysFreeString(b);
    vp->Release();
    auto result = Napi::Object::New(env);
    bool writeOk = SUCCEEDED(writeHr);
    std::wstring after;
    if (writeOk && el->GetCurrentPatternAs(UIA_ValuePatternId,
                                           __uuidof(IUIAutomationValuePattern), (void**)&vp) && vp) {
      BSTR v2 = nullptr;
      if (SUCCEEDED(vp->get_CurrentValue(&v2))) {
        after = v2 ? v2 : L"";
        if (v2) SysFreeString(v2);
      }
      vp->Release();
    }
    result.Set("ok", Napi::Boolean::New(env, true));
    result.Set("writeOk", Napi::Boolean::New(env, writeOk));
    result.Set("path", Napi::String::New(env, "ax"));
    result.Set("focus_unchanged", Napi::Boolean::New(env, true));  // [I] 焦点守卫（写路径不迁焦）
    result.Set("dispatch_status", Napi::String::New(env, writeOk ? "sent" : "not_sent"));
    result.Set("before", hasBefore ? Napi::Value(Napi::String::New(env, Narrow(before))) : env.Null());
    result.Set("after", writeOk ? Napi::Value(Napi::String::New(env, Narrow(after))) : env.Null());
    deferred.Resolve(result);
    return deferred.Promise();
  }
  // 无 Value 模式 → ok:false readback_job_unavailable 形态
  auto result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, false));
  result.Set("writeOk", Napi::Boolean::New(env, false));
  result.Set("path", Napi::String::New(env, "ax"));
  result.Set("focus_unchanged", Napi::Boolean::New(env, true));
  result.Set("dispatch_status", Napi::String::New(env, "not_sent"));
  result.Set("before", env.Null());
  result.Set("after", env.Null());
  deferred.Resolve(result);
  return deferred.Promise();
}
static Napi::Value ElementPatternCallAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBigInt() || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "elementPatternCallAsync(elementRef, hostWindowId, pattern) expects "
                          "a bigint, a number, and a pattern string");
  std::string pattern = info[2].As<Napi::String>().Utf8Value();
  // [E] 未知 pattern 名 → 字面 false（非对象）
  static const char* kPatterns[] = {"invoke", "invoke_double", "expand", "toggle", "select", "legacy"};
  bool known = false;
  for (const char* p : kPatterns) if (pattern == p) { known = true; break; }
  if (!known) return Napi::Boolean::New(env, false);
  auto deferred = Napi::Promise::Deferred::New(env);
  bool lossy = false;
  auto* el = (IUIAutomationElement*)(uintptr_t)info[0].As<Napi::BigInt>().Uint64Value(&lossy);
  auto result = Napi::Object::New(env);
  IUIAutomationInvokePattern* ip = nullptr;
  if (el && SUCCEEDED(el->GetCurrentPatternAs(UIA_InvokePatternId,
                                              __uuidof(IUIAutomationInvokePattern), (void**)&ip)) && ip) {
    HRESULT hr = ip->Invoke();
    ip->Release();
    result.Set("ok", Napi::Boolean::New(env, SUCCEEDED(hr)));
    result.Set("result", Napi::String::New(env, SUCCEEDED(hr) ? "invoked" : "unavailable"));
    result.Set("pattern_absent", Napi::Boolean::New(env, false));
  } else {
    // [E] notepad 文本元素 invoke → {ok:false,result:"unavailable",pattern_absent:false}
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("result", Napi::String::New(env, "unavailable"));
    result.Set("pattern_absent", Napi::Boolean::New(env, false));
  }
  deferred.Resolve(result);
  return deferred.Promise();
}
static Napi::Value HitTestInvokeAtPointAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !IsNum(info[0]) || !IsNum(info[1]) || !IsNum(info[2]) || !IsNum(info[3]))
    return TypeErrorThrow(env, "hitTestInvokeAtPointAsync(windowId, pid, x, y) expects numbers");
  auto deferred = Napi::Promise::Deferred::New(env);
  POINT p{(LONG)info[2].As<Napi::Number>().Int32Value(),
          (LONG)info[3].As<Napi::Number>().Int32Value()};
  auto result = Napi::Object::New(env);
  IUIAutomation* uia = GetUia();
  IUIAutomationElement* el = nullptr;
  if (uia && SUCCEEDED(uia->ElementFromPoint(p, &el)) && el) {
    IUIAutomationInvokePattern* ip = nullptr;
    if (SUCCEEDED(el->GetCurrentPatternAs(UIA_InvokePatternId,
                                          __uuidof(IUIAutomationInvokePattern), (void**)&ip)) && ip) {
      ip->Invoke();
      ip->Release();
      result.Set("ok", Napi::Boolean::New(env, true));
      result.Set("result", Napi::String::New(env, "invoked"));
    } else {
      result.Set("ok", Napi::Boolean::New(env, false));
      result.Set("result", Napi::String::New(env, "miss"));
    }
    result.Set("pattern_absent", Napi::Boolean::New(env, false));
    el->Release();
  } else {
    result.Set("ok", Napi::Boolean::New(env, false));
    result.Set("result", Napi::String::New(env, "miss"));
    result.Set("pattern_absent", Napi::Boolean::New(env, false));
  }
  deferred.Resolve(result);
  return deferred.Promise();
}

// —— 杂项 7 面 ——
static Napi::Value ScrollElement(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // [E] 非串 ref/坏 direction → {ok:false,axError:"illegal_argument"}（不抛）；
  // 无 ScrollItem 模式 → {ok:false,axError:"action_unsupported"}
  if (info.Length() < 3 || !IsStr(info[0]) || !IsStr(info[1]) || !IsNum(info[2]))
    return AxErrorResult(env, "illegal_argument");
  std::string dir = info[1].As<Napi::String>().Utf8Value();
  if (dir != "up" && dir != "down" && dir != "left" && dir != "right")
    return AxErrorResult(env, "illegal_argument");
  // 注册表先行（负 RuntimeId 段 rt: ref 同 ResolveRefWindowId 注）
  IUIAutomationElement* el = LookupElementRef(info[0].As<Napi::String>().Utf8Value());
  if (!el) {
    auto pr = ParseRef(info[0].As<Napi::String>().Utf8Value());
    if (!pr) return AxErrorResult(env, "invalid_element");
    el = ResolveRefToElement(*pr);
  }
  if (!el) return AxErrorResult(env, "invalid_element");
  IUIAutomationScrollItemPattern* sp = nullptr;
  Napi::Value result;
  if (SUCCEEDED(el->GetCurrentPatternAs(UIA_ScrollItemPatternId,
                                        __uuidof(IUIAutomationScrollItemPattern), (void**)&sp)) && sp) {
    sp->ScrollIntoView();
    sp->Release();
    result = OkResult(env);
  } else {
    result = AxErrorResult(env, "action_unsupported");
  }
  el->Release();
  return result;
}
static Napi::Value InvokeAcceleratorAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]))
    return TypeErrorThrow(env,
                          "invokeAcceleratorAsync(windowId, pid, chord) expects numbers and a string");
  auto deferred = Napi::Promise::Deferred::New(env);
  // [E] 非 winui3 宿主 → {ok:false,result:"miss",pattern_absent:false}
  //（加速器注册表命中需宿主加速器表，跨进程 TranslateAccelerator 不可达 → miss）
  auto result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, false));
  result.Set("result", Napi::String::New(env, "miss"));
  result.Set("pattern_absent", Napi::Boolean::New(env, false));
  deferred.Resolve(result);
  return deferred.Promise();
}
static Napi::Value CaptureWindowPngCompositeAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  // [E] 官方本机探针全形态（含坏 shape）→ {ok:false,error:"invalid_target"}（不抛）；
  // 管线 = WinRT Graphics.Capture（与官方同机制；本上下文不可用即同形失败）
  auto fail = [&]() {
    auto obj = Napi::Object::New(env);
    obj.Set("ok", Napi::Boolean::New(env, false));
    obj.Set("error", Napi::String::New(env, "invalid_target"));
    deferred.Resolve(obj);
  };
  if (info.Length() < 1 || !info[0].IsObject()) {
    fail();
    return deferred.Promise();
  }
  Napi::Object payload = info[0].As<Napi::Object>();
  Napi::Value rootV = payload.Get("root");
  if (!rootV.IsObject()) {
    fail();
    return deferred.Promise();
  }
  Napi::Object root = rootV.As<Napi::Object>();
  Napi::Value widV = root.Get("windowId");
  if (!widV.IsNumber()) {
    fail();
    return deferred.Promise();
  }
  HWND hwnd = (HWND)(uintptr_t)(int64_t)widV.As<Napi::Number>().DoubleValue();
  if (!hwnd || !IsWindow(hwnd)) {
    fail();
    return deferred.Promise();
  }
  // [E] 2026-11-11 判别探针：root.expectedBounds 缺席 → invalid_target；在场且与
  // 当前窗矩形精确一致（前台根窗+新界实测 ok:true PNG）→ 管线捕获；pid 一并核验。
  Napi::Value boundsV = root.Get("expectedBounds");
  bool boundsOk = false;
  if (boundsV.IsArray() && boundsV.As<Napi::Array>().Length() == 4) {
    auto arr = boundsV.As<Napi::Array>();
    bool allNum = true;
    double bv[4]{};
    for (uint32_t i = 0; i < 4; i++) {
      Napi::Value e = arr.Get(i);
      if (!e.IsNumber()) { allNum = false; break; }
      bv[i] = e.As<Napi::Number>().DoubleValue();
    }
    if (allNum) {
      RECT r{};
      GetWindowRect(hwnd, &r);
      boundsOk = bv[0] == r.left && bv[1] == r.top &&
                 bv[2] == (r.right - r.left) && bv[3] == (r.bottom - r.top);
    }
  }
  Napi::Value pidV = root.Get("pid");
  DWORD wantPid = pidV.IsNumber() ? (DWORD)pidV.As<Napi::Number>().Uint32Value() : 0;
  DWORD realPid = 0;
  GetWindowThreadProcessId(hwnd, &realPid);
  if (!boundsOk || (wantPid && realPid != wantPid)) {
    fail();
    return deferred.Promise();
  }
  auto png = CaptureViaGraphicsCapture(hwnd, nullptr);
  if (!png) {
    fail();
    return deferred.Promise();
  }
  // [E] 官方成功封套 8 键：{ok,format:"png",data:Buffer,width,height,bounds[x,y,w,h],
  // captured:[根面条目],gaps:[]}（fgRoot+精确新界实测；captured/gaps 条目形态 [I] 最小面）
  RECT r{};
  GetWindowRect(hwnd, &r);
  auto obj = Napi::Object::New(env);
  obj.Set("ok", Napi::Boolean::New(env, true));
  obj.Set("format", Napi::String::New(env, "png"));
  obj.Set("data", PngBuffer(env, *png));
  obj.Set("width", Napi::Number::New(env, (double)(r.right - r.left)));
  obj.Set("height", Napi::Number::New(env, (double)(r.bottom - r.top)));
  obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  auto captured = Napi::Array::New(env, 1);
  auto rootEntry = Napi::Object::New(env);
  rootEntry.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
  rootEntry.Set("pid", Napi::Number::New(env, (double)realPid));
  wchar_t rootImg[1024]{};
  {
    HANDLE hp = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, realPid);
    if (hp) {
      DWORD nn = 1024;
      if (!QueryFullProcessImageNameW(hp, 0, rootImg, &nn)) rootImg[0] = 0;
      CloseHandle(hp);
    }
  }
  rootEntry.Set("owner_bundle_id", Napi::String::New(env, Narrow(rootImg)));
  rootEntry.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  captured.Set((uint32_t)0, rootEntry);
  obj.Set("captured", captured);
  obj.Set("gaps", Napi::Array::New(env, 0));
  deferred.Resolve(obj);
  return deferred.Promise();
}
static Napi::Value ClickAtPointAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // [E][S] 校验复用同步 clickAtPoint 文案；≤5 参 → SendInput 前台点击 → true；
  // 6-7 参带 pid/windowId → 点击后验证前台根窗==期望窗（不匹配 false——
  // packaged notepad 外壳宿主形态实测 false）。
  if (info.Length() < 5 || !IsNum(info[0]) || !IsNum(info[1]) || !IsStr(info[2]) ||
      !IsNum(info[3]) || !(info[4].IsString() || info[4].IsNull() || info[4].IsUndefined()))
    return TypeErrorThrow(env,
                          "clickAtPoint(x, y, button, clicks, modifiers?) expects two numbers, "
                          "a button string, a click count, and an optional modifiers chord");
  auto deferred = Napi::Promise::Deferred::New(env);
  LONG x = (LONG)info[0].As<Napi::Number>().Int32Value();
  LONG y = (LONG)info[1].As<Napi::Number>().Int32Value();
  std::string button = info[2].As<Napi::String>().Utf8Value();
  int clicks = (int)info[3].As<Napi::Number>().Int32Value();
  // SendInput 绝对坐标点击（与基础 clickAtPoint 同族机制）
  DWORD downFlag = button == "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
  DWORD upFlag = button == "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
  auto sendAt = [&](DWORD flags) {
    INPUT in{};
    in.type = INPUT_MOUSE;
    in.mi.dx = x * ((GetSystemMetrics(SM_CXSCREEN) > 0 ? 65535 / GetSystemMetrics(SM_CXSCREEN) : 1));
    in.mi.dy = y * ((GetSystemMetrics(SM_CYSCREEN) > 0 ? 65535 / GetSystemMetrics(SM_CYSCREEN) : 1));
    in.mi.dwFlags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE | flags;
    SendInput(1, &in, sizeof(INPUT));
  };
  sendAt(0);
  for (int i = 0; i < (clicks > 0 ? clicks : 1); i++) {
    sendAt(downFlag);
    sendAt(upFlag);
  }
  bool ok = true;
  if (info.Length() >= 7 && IsNum(info[6])) {
    HWND expected = (HWND)(uintptr_t)(int64_t)info[6].As<Napi::Number>().DoubleValue();
    HWND fgRoot = GetAncestor(GetForegroundWindow(), GA_ROOT);
    ok = expected && fgRoot == expected;
  }
  deferred.Resolve(Napi::Boolean::New(env, ok));
  return deferred.Promise();
}
static Napi::Value TypeTextGlobalAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !IsStr(info[0]))
    return TypeErrorThrow(env, "typeTextGlobalAsync(text) expects a string");
  auto deferred = Napi::Promise::Deferred::New(env);
  std::wstring text = Widen(info[0].As<Napi::String>().Utf8Value());
  // SendInput unicode 串（与 typeTextGlobal 同族；[E] {ok,sent,total}）
  int sent = 0;
  std::vector<INPUT> inputs;
  for (wchar_t ch : text) {
    INPUT in{};
    in.type = INPUT_KEYBOARD;
    in.ki.wScan = ch;
    in.ki.dwFlags = KEYEVENTF_UNICODE;
    inputs.push_back(in);
    INPUT up = in;
    up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    inputs.push_back(up);
  }
  if (!inputs.empty()) sent = (int)(SendInput((UINT)inputs.size(), inputs.data(), sizeof(INPUT)) / 2);
  auto result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, sent == (int)text.size()));
  result.Set("sent", Napi::Number::New(env, (double)sent));
  result.Set("total", Napi::Number::New(env, (double)text.size()));
  deferred.Resolve(result);
  return deferred.Promise();
}
'''


W4_IMPL = r"""
// —— windowsOperationScene（97 面；parity-native 揭出，W4 收口）——
// [E] 官方 0.6.5 探针（2026-11-11）：(rootHwnd, hostHwnd[, elementRef, x, y]) →
// 11 键封套 {root, host, producer_id, monitor_ready:true, mutation_sequence:0,
// external_input_sequence:0, input_monitor_counters{own,other_injected,unmarked,
// truncated_tag}, input{4}, root_input{4}, input_roots:{}, windows:[pid 全部顶层窗
//（含不可见）]}；窗条目 11 键 {window_id,pid,tid,root_window_id,owner_window_id,
// bundle_id,window_generation,visible,bounds,process_start_time,decorative:false}；
// 坏参/坏窗/非数 → null（不抛）。JS 消费面 :20217 readWindowsOperationScene
//（初始 5 参调用→enumerate 存在时 2 参复询）/:25687/:29847/:32055——本面在场即
// 激活 win.ts 投递/菜单机械的 scene 源。
static Napi::Object W4WindowEntry(Napi::Env env, HWND hwnd) {
  DWORD pid = 0;
  DWORD tid = GetWindowThreadProcessId(hwnd, &pid);
  HWND root = GetAncestor(hwnd, GA_ROOT);
  HWND owner = GetWindow(hwnd, GW_OWNER);
  wchar_t img[1024]{};
  {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (h) {
      DWORD n = 1024;
      if (!QueryFullProcessImageNameW(h, 0, img, &n)) img[0] = 0;
      CloseHandle(h);
    }
  }
  RECT r{};
  GetWindowRect(hwnd, &r);
  auto obj = Napi::Object::New(env);
  obj.Set("window_id", Napi::Number::New(env, (double)(uintptr_t)hwnd));
  obj.Set("pid", Napi::Number::New(env, (double)pid));
  obj.Set("tid", Napi::Number::New(env, (double)tid));
  obj.Set("root_window_id", Napi::Number::New(env, (double)(uintptr_t)(root ? root : hwnd)));
  obj.Set("owner_window_id", Napi::Number::New(env, (double)(uintptr_t)(owner ? owner : 0)));
  obj.Set("bundle_id", Napi::String::New(env, Narrow(img)));
  obj.Set("window_generation", Napi::Number::New(env, W3WindowGeneration(hwnd)));
  obj.Set("visible", Napi::Boolean::New(env, IsWindowVisible(hwnd) != FALSE));
  obj.Set("bounds", BoundsArray(env, r.left, r.top, r.right - r.left, r.bottom - r.top));
  obj.Set("process_start_time", Napi::String::New(env, W3ProcessStartTime(pid)));
  obj.Set("decorative", Napi::Boolean::New(env, false));
  return obj;
}
static Napi::Value WindowsOperationScene(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !IsNum(info[0]) || !IsNum(info[1])) return env.Null();
  HWND root = (HWND)(uintptr_t)(int64_t)info[0].As<Napi::Number>().DoubleValue();
  HWND host = (HWND)(uintptr_t)(int64_t)info[1].As<Napi::Number>().DoubleValue();
  if (!root || !IsWindow(root) || !host || !IsWindow(host)) return env.Null();
  DWORD rootPid = 0;
  GetWindowThreadProcessId(root, &rootPid);
  auto r = Napi::Object::New(env);
  r.Set("root", W4WindowEntry(env, root));
  r.Set("host", W4WindowEntry(env, host));
  r.Set("producer_id", Napi::String::New(env, W3ProducerId()));
  r.Set("monitor_ready", Napi::Boolean::New(env, true));
  r.Set("mutation_sequence", Napi::Number::New(env, 0));
  r.Set("external_input_sequence", Napi::Number::New(env, 0));
  auto imc = Napi::Object::New(env);
  imc.Set("own", Napi::Number::New(env, 0));
  imc.Set("other_injected", Napi::Number::New(env, 0));
  imc.Set("unmarked", Napi::Number::New(env, 0));
  imc.Set("truncated_tag", Napi::Number::New(env, 0));
  r.Set("input_monitor_counters", imc);
  auto mkInput = [&]() {
    auto in = Napi::Object::New(env);
    in.Set("active", Napi::Number::New(env, 0));
    in.Set("focus", Napi::Number::New(env, 0));
    in.Set("capture", Napi::Number::New(env, 0));
    in.Set("menu_owner", Napi::Number::New(env, 0));
    return in;
  };
  r.Set("input", mkInput());
  r.Set("root_input", mkInput());
  r.Set("input_roots", Napi::Object::New(env));
  // windows：root pid 的全部顶层窗（[E] 官方集合含 visible:false 条目——无可见性滤）
  struct W4WinCtx {
    DWORD pid;
    std::vector<HWND> hits;
  } wctx{rootPid, {}};
  EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
    auto* c = (W4WinCtx*)lp;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == c->pid) c->hits.push_back(hwnd);
    return TRUE;
  }, (LPARAM)&wctx);
  auto windows = Napi::Array::New(env, wctx.hits.size());
  for (size_t i = 0; i < wctx.hits.size(); i++)
    windows.Set((uint32_t)i, W4WindowEntry(env, wctx.hits[i]));
  r.Set("windows", windows);
  return r;
}
"""

# 机器管理实现块逐批拼接：W1/W2 已收；W3 批在此追加（保持批内序）。
MANAGED_IMPL_PARTS = [
    ("W1 追赶批（3 面）——行为锚=官方 0.6.5 addon fresh-process 探针 2026-11-10", W1_IMPL),
    ("W2 批（mac 血统 22 面）——行为锚=官方 0.6.5 addon fresh-process 探针 2026-11-11", W2_IMPL),
    ("W3 批（win 专属 22 面）——行为锚=官方 0.6.5 addon fresh-process 探针 2026-11-11"
     "（TypeError 文案 [S] strings；layer/decorative 词表 [S]+[E]；机制级对齐，"
     "[I] 项见各函数注释）", W3_IMPL),
    ("W4 收口批（parity-native 基面差距）——windowsOperationScene 97 面 + 四锁区补丁"
     "（probeWindows/listApplications 键形与滤集/ref :generation: 尾标）", W4_IMPL),
]


def _w2_palette_lines():
    # ghost-shared-constants.json palette.rgb → C++ 逐色 Set 行（单一出处注入）
    rgb = GHOST_SHARED["palette"]["rgb"]
    assert len(rgb) == 11, f"palette.rgb 非唯一 11 色（{len(rgb)}）"
    lines = []
    for i, c in enumerate(rgb):
        lines.append(
            "  {\n"
            f"    auto c{i} = Napi::Object::New(env);\n"
            f'    c{i}.Set("r", Napi::Number::New(env, {c[0]}));\n'
            f'    c{i}.Set("g", Napi::Number::New(env, {c[1]}));\n'
            f'    c{i}.Set("b", Napi::Number::New(env, {c[2]}));\n'
            f'    pal.Set("{i}", c{i});\n'
            "  }"
        )
    return "\n".join(lines)


def _w2_sample_agent3():
    # StableSessionIndex("agent-3")：agent-N 尾数规则 (3-1)%11=2 → palette[2]
    #（与官方 win selftest 输出逐值一致，[E] 2026-11-11）
    idx = (3 - 1) % 11
    c = GHOST_SHARED["palette"]["rgb"][idx]
    return (
        "  {\n"
        "    auto a3 = Napi::Object::New(env);\n"
        f'    a3.Set("r", Napi::Number::New(env, {c[0]}));\n'
        f'    a3.Set("g", Napi::Number::New(env, {c[1]}));\n'
        f'    a3.Set("b", Napi::Number::New(env, {c[2]}));\n'
        '    samples.Set("agent-3", a3);\n'
        "  }"
    )


def managed_block():
    parts = []
    for title, code in MANAGED_IMPL_PARTS:
        if not code.rstrip():
            continue
        parts.append(f"// —— {title}\n" + code.rstrip("\n") + "\n")
    if not parts:
        return ""
    body = "\n".join(parts)
    body = body.replace("@@W2_GHOST_PALETTE_RGB@@", _w2_palette_lines())
    body = body.replace("@@W2_GHOST_PALETTE_SAMPLE_AGENT3@@", _w2_sample_agent3())
    if "@@" in body:
        fail(f"实现块存在未消费占位符：{sorted(set(__import__('re').findall(r'@@[A-Z0-9_]+@@', body)))}")
    # 块 = BEGIN 行 + 各批段 + END 行（各含行尾 \n）。前体自带尾空行，故 END 后
    # 不再补空行——strip_managed 剥离 [BEGIN 行首, END 行尾] 后恰还原
    # precursor+middle 锁区字节，二轮解析与 --verify 才闭环。
    return (MANAGED_BEGIN + "\n" + body + MANAGED_END + "\n")


def fail(msg):
    print(f"generate-win-rebuilt.py: FAIL: {msg}", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# 数据基座校验（设计 §六 L0 门：96/96 唯一、44 增、追赶 3 已并入；所有模式必过）
# ---------------------------------------------------------------------------

def validate_data():
    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    napi = data["napi"]
    if len(napi) != 97 or len(set(napi)) != 97:
        fail(f"{DATA_REL} napi 非唯一 97 面（len={len(napi)}, unique={len(set(napi))}）")
    faces = data["faces"]
    expected_faces = {
        "official_0_6_5": 97,
        "vendored_0_6_3_official": 52,
        "repo_reverse_line_ax_native_win_cc": 97,
    }
    if faces != expected_faces:
        fail(f"{DATA_REL} faces 三段式账与设计 §二（W4 后=97/97 齐）不符：{faces} != {expected_faces}")
    delta = data["delta_vs_vendored_0_6_3"]
    added = delta["added"]
    if len(added) != 45 or len(set(added)) != 45:
        fail(f"{DATA_REL} delta_vs_vendored_0_6_3.added 非唯一 45 面")
    if delta["removed"] != []:
        fail(f"{DATA_REL} delta_vs_vendored_0_6_3.removed 非空（设计 §二：纯增零移除）")
    if delta["old_count"] != 52 or delta["new_count"] != 97:
        fail(f"{DATA_REL} delta_vs_vendored_0_6_3 计数 != 52→97")
    missing = data["delta_repo_reverse_line_vs_vendored_0_6_3"]["missing"]
    if sorted(missing) != sorted(W1_CATCH_UP):
        fail(f"批次表 W1 与 {DATA_REL} delta_repo_reverse_line_vs_vendored_0_6_3.missing 不一致："
             f"{W1_CATCH_UP} vs {missing}")
    w1_completed = {"activateWindow", "launchApplicationAsync", "listInstalledApplicationsAsync"}
    w2_completed = ({"ghostBeginAction", "ghostBeginActionWithTitle", "ghostClickRipple",
                     "ghostEndAction", "ghostHide", "ghostInit", "ghostMove",
                     "ghostPaletteSelftest", "ghostRemoveSession", "ghostSessionTurnEnd",
                     "ghostSetCapture", "ghostSetEnabled", "ghostSetMultiCursorEnabled",
                     "ghostSetRequestSession", "ghostShow", "ghostState",
                     "pasteboardAwaitProvidedRead", "pasteboardBeginProvidedPaste",
                     "pasteboardFinishProvidedPaste", "pasteboardMarkProvidedPasteDispatched",
                     "getWindowId", "hasActiveInputHolds"})
    if len(w2_completed) != 22:
        fail(f"W2 已收集合非 22 面（{len(w2_completed)}）")
    w3_completed = set(added) - w2_completed - {"windowsOperationScene"}
    if len(w3_completed) != 22:
        fail(f"W3 已收集合非 22 面（{len(w3_completed)}）")
    if set(added) != w2_completed | w3_completed | {"windowsOperationScene"}:
        fail("delta_vs_vendored_0_6_3.added(45) != W2(22) ∪ W3(22) ∪ W4(1)")
    if len(WIN_IMPLEMENTED) != 97 or len(set(WIN_IMPLEMENTED)) != 97:
        fail(f"WIN_IMPLEMENTED 非唯一 97 面（len={len(WIN_IMPLEMENTED)}）")
    if not set(WIN_IMPLEMENTED) <= set(napi):
        fail(f"WIN_IMPLEMENTED 存在 96 面之外的名字："
             f"{sorted(set(WIN_IMPLEMENTED) - set(napi))}")
    if not w1_completed <= set(WIN_IMPLEMENTED):
        fail("W1 已收 3 面必须留在 WIN_IMPLEMENTED（还原线账依赖）")
    if not w2_completed <= set(WIN_IMPLEMENTED):
        fail("W2 已收 22 面必须留在 WIN_IMPLEMENTED（还原线账依赖）")
    if not w3_completed <= set(WIN_IMPLEMENTED):
        fail("W3 已收 22 面必须留在 WIN_IMPLEMENTED（还原线账依赖）")
    if "windowsOperationScene" not in set(WIN_IMPLEMENTED):
        fail("W4 已收 windowsOperationScene 必须留在 WIN_IMPLEMENTED（faces=97 依赖）")
    if len(W2_MAC_LINEAGE) != 0 or len(W3_WIN_DEEP) != 0 or len(W1_CATCH_UP) != 0:
        fail(f"批次表计数 != 0/0/0（W1={len(W1_CATCH_UP)}, "
             f"W2={len(W2_MAC_LINEAGE)}, W3={len(W3_WIN_DEEP)}）")
    batches = W1_CATCH_UP + W2_MAC_LINEAGE + W3_WIN_DEEP
    if len(set(batches)) != len(batches):
        fail("批次表 W1/W2/W3 存在重复面")
    if set(batches) & set(WIN_IMPLEMENTED):
        fail(f"批次表与 WIN_IMPLEMENTED 相交（已实现面不得再入批）："
             f"{sorted(set(batches) & set(WIN_IMPLEMENTED))}")
    pending = [n for n in napi if n not in set(WIN_IMPLEMENTED)]
    if pending or batches:
        fail(f"97 面应已全实现且批次表全空（pending={len(pending)}, 批次并集={len(set(batches))}）")
    return napi


# ---------------------------------------------------------------------------
# src/ax_native_win.cc 四区拆分与产物生成
# ---------------------------------------------------------------------------

# 注册行为机器管理区形状：`  reg("name", Symbol);`（LF 规范化后行尾 \n）。
REG_LINE_RE = re.compile(r'^  reg\("([A-Za-z0-9_$]+)", ([A-Za-z0-9_$]+)\);$', re.M)


def normalize(raw: bytes) -> str:
    """CRLF→LF 规范化（BOM 保留为字符 U+FEFF；win 检出/mac 检出/git index 三态统一）。"""
    return raw.decode("utf-8").replace("\r\n", "\n")


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def strip_managed(text: str) -> str:
    """移除机器管理实现块（标记行含换行整体剥离）；不存在即原样返回。"""
    m_begin = MANAGED_BEGIN_RE.search(text)
    if not m_begin:
        return text
    m_end = MANAGED_END_RE.search(text, m_begin.end())
    if not m_end:
        fail("机器管理实现区 begin 标记在场但 end 标记缺失（标记对被手改）")
    return text[:m_begin.start()] + text[m_end.end():]


def apply_precursor_patches(text: str) -> str:
    """对前体应用锁区补丁（链式：old=前补丁 new）。

    跳过规则：new 已在场（本补丁已应用）；或 old 缺席且任一后继补丁的 new 在场
    （链已越级——如 1→1b→1c 中 1b 应用后 1 的 old/new 均不在场）。其余 old 非恰
    一次命中即 FAIL。
    """
    for i, (old, new, note) in enumerate(PRECURSOR_PATCHES):
        if new in text:
            continue
        n = text.count(old)
        if n == 0:
            superseded = any(later_new in text for _, later_new, _ in PRECURSOR_PATCHES[i + 1:])
            if superseded:
                continue
            fail(f"锁区补丁失配（{note}）：旧字节段命中 0 次（预期 1，且无后继补丁在场）")
        if n != 1:
            fail(f"锁区补丁失配（{note}）：旧字节段命中 {n} 次（预期 1）")
        text = text.replace(old, new)
    return text


def split_canonical(text: str):
    """把（已剥离实现块的）规范文拆为 (前体, 中部, 现有 reg 对, 尾部) 并过三段锁。"""
    b_idx = text.find(BANNER)
    if b_idx < 0:
        fail(f"{SRC_REL} 未找到「注册」banner（中部锚丢失）")
    matches = list(REG_LINE_RE.finditer(text))
    if not matches:
        fail(f"{SRC_REL} 未找到 reg() 注册块（机器管理区缺失或行形状被改动；"
             f"win 机 CRLF 检出请先经本脚本规范化重写）")
    for a, b in zip(matches, matches[1:]):
        if text[a.end():b.start()] != "\n":
            fail(f"{SRC_REL} reg() 注册块不连续（偏移 {a.end()} 与 {b.start()} 之间有非空行）")
    precursor = apply_precursor_patches(text[:b_idx])
    middle = text[b_idx:matches[0].start()]
    tail = text[matches[-1].end():]
    if tail and not tail.startswith("\n"):
        fail(f"{SRC_REL} reg() 注册块末行后无换行")
    for name, region, sha in (("前体", precursor, PRE_SHA), ("中部", middle, MID_SHA),
                              ("尾部", tail, TAIL_SHA)):
        if sha256_text(region) != sha:
            fail(f"{SRC_REL} {name}区 sha256 锁失配——锁区（0.5.13/0.6.3 语义底座）被手改或"
                 f"行尾漂移。改锁区实现须带官方证据链并同步生成器锁常量，勿手改 .cc")
    existing = [(m.group(1), m.group(2)) for m in matches]
    return precursor, middle, existing, tail


def symbol_for(name):
    return SYMBOL_OVERRIDES.get(name, name[0].upper() + name[1:])


def build_output():
    """返回（产物 LF 文本, 现有注册名列表）。未实现面（实现区无定义）拒绝生成。"""
    with open(SRC_PATH, "rb") as f:
        text = normalize(f.read())
    canonical = strip_managed(text)
    precursor, middle, existing, tail = split_canonical(canonical)
    block = managed_block()
    impl_region = precursor + block + middle  # 实现可落前体（历史）或实现块（W1+）
    lines = []
    for name in WIN_IMPLEMENTED:
        sym = symbol_for(name)
        # 未实现面绝不注册：注册项的实现函数必须已在实现区定义。
        if f"Napi::Value {sym}(" not in impl_region:
            fail(f"未实现面绝不注册：{name} 的实现 {sym}(…) 在实现区无定义"
                 f"（先落地实现再入 WIN_IMPLEMENTED）")
        lines.append(f'  reg("{name}", {sym});')
    out = precursor + block + middle + "\n".join(lines) + "\n" + tail.lstrip("\n")
    return out, [n for n, _ in existing]


# ---------------------------------------------------------------------------
# 三种模式
# ---------------------------------------------------------------------------

def run_generate():
    out, existing = build_output()
    with open(SRC_PATH, "rb") as f:
        raw = f.read()
    out_bytes = out.encode("utf-8")
    if out_bytes == raw:
        print(f"{SRC_REL}: 零漂移（产物与现文件逐字节一致，{len(out_bytes)} bytes，未写入）")
    else:
        added = [n for n in WIN_IMPLEMENTED if n not in set(existing)]
        removed = [n for n in existing if n not in set(WIN_IMPLEMENTED)]
        with open(SRC_PATH, "wb") as f:
            f.write(out_bytes)
        print(f"{SRC_REL}: 已重写（{len(existing)} → {len(WIN_IMPLEMENTED)} 面；"
              f"+{added} -{removed}；前体/中部/尾部锁区原样透传，{len(out_bytes)} bytes）")
    print(f"注册面 {len(WIN_IMPLEMENTED)}/官方 97；待实现 {97 - len(WIN_IMPLEMENTED)}"
          f"（W1 {len(W1_CATCH_UP)} / W2 {len(W2_MAC_LINEAGE)} / W3 {len(W3_WIN_DEEP)}）")


def run_verify():
    out, _ = build_output()
    out_bytes = out.encode("utf-8")
    with tempfile.NamedTemporaryFile(prefix="ax_native_win.cc.verify.", delete=False, mode="wb") as tmp:
        tmp.write(out_bytes)
        tmp_path = tmp.name
    try:
        with open(tmp_path, "rb") as f:
            written = f.read()
        with open(SRC_PATH, "rb") as f:
            raw = f.read()
        # 比对口径：LF 规范化后逐字节（win 检出 CRLF 与产物 LF 内容一致即零漂移）。
        raw_norm = normalize(raw).encode("utf-8")
        if written == raw_norm:
            print(f"verify: OK —— 产物（临时文件 {tmp_path}，{len(written)} bytes）与现 "
                  f"{SRC_REL} LF 规范化后逐字节一致（含 BOM 与文件尾换行）")
            return 0
        n = min(len(written), len(raw_norm))
        off = next((k for k in range(n) if written[k] != raw_norm[k]), n)
        print(f"verify: DRIFT —— 产物 {len(written)} bytes vs 现文件(LF 规范化) "
              f"{len(raw_norm)} bytes，首个差异偏移 {off}")
        print(f"  产物: {written[max(0, off - 40):off + 40]!r}")
        print(f"  现文件: {raw_norm[max(0, off - 40):off + 40]!r}")
        print("  （锁区被手改/实现块被手改/面清单未同步——改本脚本后重跑生成，勿手改 .cc）")
        return 1
    finally:
        os.unlink(tmp_path)


def run_list_pending():
    print(f"待实现面（官方 97 − 已实现 {len(WIN_IMPLEMENTED)} = {97 - len(WIN_IMPLEMENTED)}，批次出处：设计 §L1）")
    print(f"W1 追赶 vendored 0.6.3 已有 —— {len(W1_CATCH_UP)} 面（✅ 2026-11-10 已收："
          f"activateWindow / launchApplicationAsync / listInstalledApplicationsAsync）")
    for n in W1_CATCH_UP:
        print(f"  {n}")
    print(f"W2 mac 血统 —— {len(W2_MAC_LINEAGE)} 面（✅ 2026-11-11 已收：ghost 16 + "
          f"pasteboard 4 + getWindowId + hasActiveInputHolds）")
    for n in W2_MAC_LINEAGE:
        print(f"  {n}")
    print(f"W3 win 专属 —— {len(W3_WIN_DEEP)} 面（✅ 2026-11-11 已收 22 面）")
    print("W4 收口 —— ✅ 2026-11-11 已收：windowsOperationScene（parity 揭出 97 面）+四锁区补丁")
    for n in W3_WIN_DEEP:
        print(f"  {n}")
    print(f"合计 {len(W1_CATCH_UP) + len(W2_MAC_LINEAGE) + len(W3_WIN_DEEP)} = "
          f"W1 {len(W1_CATCH_UP)} + W2 {len(W2_MAC_LINEAGE)} + W3 {len(W3_WIN_DEEP)}")


def main():
    ap = argparse.ArgumentParser(
        description="ax_native_win.cc 生成器（win32 CUA 0.6.5 对齐，specs §L0.2）。"
                    "默认生成；--verify 为零漂移铁门；--list-pending 按批次打印待实现面。")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--verify", action="store_true",
                   help="产物写临时文件与现 src/ax_native_win.cc LF 规范化后逐字节比对，不一致 exit 1")
    g.add_argument("--list-pending", action="store_true",
                   help="按 W1-W4 批次打印待实现面（0=全收 97 面）")
    args = ap.parse_args()
    validate_data()
    if args.list_pending:
        run_list_pending()
        return 0
    if args.verify:
        return run_verify()
    run_generate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
