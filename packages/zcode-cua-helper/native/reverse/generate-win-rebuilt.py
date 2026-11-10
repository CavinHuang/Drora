#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 还原自发行 bundle —— win32 addon 逆向还原线生成器（纪律见下），产物为还原文件。
#
# 还原纪律（本仓 AGENTS.md / specs/cua-restoration-manifest.md）：
#   - 冻结还原资产零触碰（upstream/ 切段、官方参照副本、vendored 字节）；
#   - 还原代码改动须带官方证据注释（文件 + 行号/字节偏移），本脚本对产物的
#     「前体 + 尾部」原样透传即零漂移铁律的体现，任何语义改动必须走证据链；
#   - 产物 src/ax_native_win.cc 的注册表是机器管理区：改面清单改本脚本再重跑，
#     勿手编 reg() 行（mac 线手编残体事故教训见 generate-mac-rebuilt.py 头注）。
#
# 设计文档：specs/win32-cua-0.6.5-implementation-design.md
#   §四 L0.2 生成器脚手架（本脚本；不泛化 mac 生成器——两平台证据模型差异大，
#            win 无符号表、注册表由 data JSON 驱动）
#   §四 L1  三批施工（W1 追赶 3 / W2 mac 血统 22 / W3 win 专属 22，批次表出处）
#   §五     施工序 W0-W4；§六 验收矩阵 L0 行「生成器 dry-run 注册面=目标面」
#
# 数据基座：data/win32-3.17.2-napi-functions.json —— 官方 0.6.5 win32-x64 addon
# 96 面（sha 11f8bc9c…；2026-11-10 勘误定谳的三段式账：faces 96/52/49 +
# delta_vs_vendored added-44/removed-[] + delta_repo_reverse_line missing-3）。
"""ax_native_win.cc 生成器（win32 CUA 0.6.5 对齐 L0.2 脚手架轮）。

产物结构（specs §L0.2：产物仍写 src/ax_native_win.cc，消费方（reverse/binding.gyp:9）零改动）：

  src/ax_native_win.cc = 注册表前体（现文件内容原样 —— 0.5.13/0.6.3 语义底座整体保留）
                       + 生成的注册表（仅 WIN_IMPLEMENTED 已实现面，顺序保持现文件顺序）
                       + 尾部（现文件内容原样，含文件尾换行）

未实现面绝不注册：每个注册项先断言其 C++ 实现（Napi::Value <Symbol>(…)）存在于前体
实现区，缺实现即拒绝生成——面清单与实现区由同一道门锁死。

用法（在 native/reverse/ 下运行）：
  python3 generate-win-rebuilt.py                 # 生成：重写注册表机器管理区（字节不变时零写入）
  python3 generate-win-rebuilt.py --verify        # 零漂移铁门：产物写临时文件与现
                                                  # src/ax_native_win.cc 逐字节比对
                                                  # （含文件尾换行与 BOM），不一致 exit 1
  python3 generate-win-rebuilt.py --list-pending  # 按批次（W1/W2/W3）打印待实现面
"""

import argparse
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
# 已实现面（WIN_IMPLEMENTED）—— 49 面
#
# 机械提取自 src/ax_native_win.cc 的 reg() 调用序列（2026-11-10，提取即
# `grep '^  reg(' src/ax_native_win.cc` 的名字列），顺序保持现文件顺序
# （现文件恰为字母序；后续追加新面时保持「现文件顺序」语义：在实现落地当轮
# 把新面按文件内 reg() 顺序并入本表）。还原线 49 面账 = data JSON
# faces.repo_reverse_line_ax_native_win_cc:49（0.5.13 期参照建造，README §还原边界）。
# ---------------------------------------------------------------------------
WIN_IMPLEMENTED = [
    "activateApplication",
    "activateApplicationByAumid",
    "applicationIconPngAsync",
    "applicationInfo",
    "applicationInfoByAumid",
    "cancelInputHoldsForSession",
    "cancelPendingInputHolds",
    "captureApp",
    "captureMonitorPngAsync",
    "captureWindowImage",
    "captureWindowPngVerifiedAsync",
    "clickAtPoint",
    "cursorPoint",
    "displays",
    "dpiAwarenessInfo",
    "drag",
    "elementAtPoint",
    "holdKeyGlobal",
    "holdKeyGlobalAsync",
    "isFocusStealPrevented",
    "isInteractiveSession",
    "isScreenCaptureSupported",
    "isTargetElevated",
    "isTrusted",
    "keyDownGlobal",
    "keyUpGlobal",
    "listApplications",
    "listWindows",
    "mouseDown",
    "mouseUp",
    "moveTo",
    "performAction",
    "pressKeyGlobal",
    "preventActivation",
    "probeAccessibility",
    "probeAccessibilityStatus",
    "processExecutablePath",
    "readClipboardTextAsync",
    "readElement",
    "reenableActivation",
    "screenCaptureProbeWindows",
    "screenCaptureStatus",
    "scrollAt",
    "selectText",
    "setFocused",
    "setValue",
    "startupError",
    "typeTextGlobal",
    "writeClipboardTextAsync",
]

# 注册符号约定：reg("<name>", <Name 首字母大写>)。现 49 面全部符合；未来面若
# 不符合（如 $ 字符或前缀风格不同），在此登记显式符号，勿改约定推导。
SYMBOL_OVERRIDES = {}

# ---------------------------------------------------------------------------
# 批次表 —— 出处：specs/win32-cua-0.6.5-implementation-design.md §四 L1
# 「addon 逆向重建（win 机主战场，三批）」+ §五施工序 W1/W2/W3。
# 批次表与数据基座的一致性由 validate_data() 逐项断言（W1 == data JSON
# delta_repo_reverse_line_vs_vendored_0_6_3.missing；W2∪W3 == delta_vs_vendored
# added 44 面；W1+W2+W3 恰为 96 − 49 = 47 待实现面，3/22/22）。
# ---------------------------------------------------------------------------

# W1 批（追赶 3 + ABI 切换）：vendored 0.6.3 官方 addon 已有、还原线 49 面从未
# 实现的 3 面（AUMID 激活链；vendored 0.6.3 JS 引用 7/3/1 次，strings 实证）。
W1_CATCH_UP = [
    "activateWindow",
    "launchApplicationAsync",
    "listInstalledApplicationsAsync",
]

# W2 批（mac 血统 22）：ghost 16（win 无 ghostMotion/GeometrySelftest 两自检，
# 其余 mac 血统同族全在——ghost 非 mac 专属）+ pasteboard 4 + getWindowId +
# hasActiveInputHolds（getWindowId/hasActiveInputHolds 在 §二增量账归
# surface/杂项域，但血统上随 W2 mac 同族语义先行，§L1 W2 行原文收录）。
W2_GHOST = [
    "ghostBeginAction",
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
]
W2_PASTEBOARD = [
    "pasteboardAwaitProvidedRead",
    "pasteboardBeginProvidedPaste",
    "pasteboardFinishProvidedPaste",
    "pasteboardMarkProvidedPasteDispatched",
]
W2_MISC = [
    "getWindowId",
    "hasActiveInputHolds",
]
W2_MAC_LINEAGE = W2_GHOST + W2_PASTEBOARD + W2_MISC

# TODO(W2 批接入，本轮不接线): ghost 共享常量单一出处 data/ghost-shared-constants.json
# （specs §四 L0.3：从 generate-mac-rebuilt.py 内嵌表提取——palette 44 / motion 8 采样 /
# geometry 13 键 / StableSessionIndex 探针表；双生成器消费同一 JSON，win ghost 与
# mac ghost 是同一官方实现族，防双份漂移）。W2 批实现 ghost 16 面时把本钩改为
# json.load 加载并注入生成逻辑；本轮 L0.3 尚未产出该文件，故只留路径钩、不读取。
GHOST_SHARED_CONSTANTS_PATH = "data/ghost-shared-constants.json"

# W3 批（win 专属 22 深水区，按 §L1 W3 域划分；§二增量账的 surface 域 7 面中
# getWindowId 与杂项 8 面中 hasActiveInputHolds 已归 W2，余 6+7）：
#   postMessage 投递 5 ／ UIA 模式梯 4 ／ surface 域 6 ／ 杂项 7
W3_POST_MESSAGE = [
    "postMessageClickAsync",
    "postMessageDragAsync",
    "postMessageScrollAsync",
    "postMessageCharAsync",
    "postMessageKeyAsync",
]
W3_UIA_LADDER = [
    "elementPatternCallAsync",
    "elementValueReadAsync",
    "setValueReadbackAsync",
    "hitTestInvokeAtPointAsync",
]
W3_SURFACE = [
    "enumerateSurfacesForFrame",
    "frameWindowContext",
    "getDispatchWindowId",
    "getForegroundRootWindowId",
    "restoreForegroundWindow",
    "classifyPostMessageDelivery",
]
W3_MISC = [
    "captureWindowPngCompositeAsync",
    "invokeAcceleratorAsync",
    "scrollElement",
    "clickAtPointAsync",
    "typeTextGlobalAsync",
    "winAxElementFromToken",
    "winAxElementRelease",
]
W3_WIN_DEEP = W3_POST_MESSAGE + W3_UIA_LADDER + W3_SURFACE + W3_MISC


def fail(msg):
    print(f"generate-win-rebuilt.py: FAIL: {msg}", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# 数据基座校验（设计 §六 L0 门：96/96 唯一、44 增、3 欠账；所有模式必过）
# ---------------------------------------------------------------------------

def validate_data():
    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    napi = data["napi"]
    if len(napi) != 96 or len(set(napi)) != 96:
        fail(f"{DATA_REL} napi 非唯一 96 面（len={len(napi)}, unique={len(set(napi))}）")
    faces = data["faces"]
    expected_faces = {
        "official_0_6_5": 96,
        "vendored_0_6_3_official": 52,
        "repo_reverse_line_ax_native_win_cc": 49,
    }
    if faces != expected_faces:
        fail(f"{DATA_REL} faces 三段式账与设计 §二不符：{faces} != {expected_faces}")
    delta = data["delta_vs_vendored_0_6_3"]
    added = delta["added"]
    if len(added) != 44 or len(set(added)) != 44:
        fail(f"{DATA_REL} delta_vs_vendored_0_6_3.added 非唯一 44 面")
    if delta["removed"] != []:
        fail(f"{DATA_REL} delta_vs_vendored_0_6_3.removed 非空（设计 §二：纯增零移除）")
    if delta["old_count"] != 52 or delta["new_count"] != 96:
        fail(f"{DATA_REL} delta_vs_vendored_0_6_3 计数 != 52→96")
    missing = data["delta_repo_reverse_line_vs_vendored_0_6_3"]["missing"]
    if sorted(missing) != sorted(W1_CATCH_UP):
        fail(f"批次表 W1 与 {DATA_REL} delta_repo_reverse_line_vs_vendored_0_6_3.missing 不一致："
             f"{W1_CATCH_UP} vs {missing}")
    if set(added) != set(W2_MAC_LINEAGE) | set(W3_WIN_DEEP):
        fail("批次表 W2∪W3 与 delta_vs_vendored_0_6_3.added(44) 集合不一致")
    if len(WIN_IMPLEMENTED) != 49 or len(set(WIN_IMPLEMENTED)) != 49:
        fail(f"WIN_IMPLEMENTED 非唯一 49 面（len={len(WIN_IMPLEMENTED)}）")
    if not set(WIN_IMPLEMENTED) <= set(napi):
        fail(f"WIN_IMPLEMENTED 存在 96 面之外的名字："
             f"{sorted(set(WIN_IMPLEMENTED) - set(napi))}")
    if len(W2_GHOST) != 16 or not all(n.startswith("ghost") for n in W2_GHOST):
        fail("W2 ghost 批次表非 16 面或混入非 ghost 名")
    if len(W2_PASTEBOARD) != 4 or not all(n.startswith("pasteboard") for n in W2_PASTEBOARD):
        fail("W2 pasteboard 批次表非 4 面或混入非 pasteboard 名")
    if len(W2_MAC_LINEAGE) != 22 or len(W3_WIN_DEEP) != 22 or len(W1_CATCH_UP) != 3:
        fail(f"批次表计数 != 3/22/22（W1={len(W1_CATCH_UP)}, "
             f"W2={len(W2_MAC_LINEAGE)}, W3={len(W3_WIN_DEEP)}）")
    batches = W1_CATCH_UP + W2_MAC_LINEAGE + W3_WIN_DEEP
    if len(set(batches)) != len(batches):
        fail("批次表 W1/W2/W3 存在重复面")
    if set(batches) & set(WIN_IMPLEMENTED):
        fail(f"批次表与 WIN_IMPLEMENTED 相交（已实现面不得再入批）："
             f"{sorted(set(batches) & set(WIN_IMPLEMENTED))}")
    pending = [n for n in napi if n not in set(WIN_IMPLEMENTED)]
    if set(batches) != set(pending) or len(pending) != 47:
        fail(f"批次表未恰好覆盖待实现面（pending={len(pending)}, 批次并集={len(set(batches))}）")
    return napi


# ---------------------------------------------------------------------------
# src/ax_native_win.cc 拆分与注册表生成
# ---------------------------------------------------------------------------

# 注册行为机器管理区形状：`  reg("name", Symbol);`（两空格缩进、单空格逗号、
# 行尾分号无尾随空白）。lambda 定义行 `auto reg = […]` 不匹配该锚定形状。
REG_LINE_RE = re.compile(rb'^  reg\("([A-Za-z0-9_$]+)", ([A-Za-z0-9_$]+)\);$', re.M)


def split_registry(raw):
    """把现文件拆为（前体 bytes, 现有 reg (name, symbol) 对列表, 尾部 bytes）。

    前体 = 文件头（含 BOM）到首个 reg() 行行首；尾部 = 末个 reg() 行换行之后
    到文件尾（含 `return exports;`、NODE_API_MODULE 行与文件尾换行）。
    """
    matches = list(REG_LINE_RE.finditer(raw))
    if not matches:
        fail(f"{SRC_REL} 未找到 reg() 注册块（机器管理区缺失或行形状被改动）")
    for a, b in zip(matches, matches[1:]):
        if raw[a.end():b.start()] != b"\n":
            fail(f"{SRC_REL} reg() 注册块不连续（偏移 {a.end()} 与 {b.start()} 之间有非空行）")
    if raw[matches[-1].end():matches[-1].end() + 1] != b"\n":
        fail(f"{SRC_REL} reg() 注册块末行后无换行")
    precursor = raw[:matches[0].start()]
    tail = raw[matches[-1].end() + 1:]
    existing = [(m.group(1).decode(), m.group(2).decode()) for m in matches]
    return precursor, existing, tail


def symbol_for(name):
    return SYMBOL_OVERRIDES.get(name, name[0].upper() + name[1:])


def build_output():
    """返回（产物 bytes, 现有注册名列表）。未实现面（前体无 Napi::Value 定义）拒绝生成。"""
    with open(SRC_PATH, "rb") as f:
        raw = f.read()
    precursor, existing, tail = split_registry(raw)
    lines = []
    for name in WIN_IMPLEMENTED:
        sym = symbol_for(name)
        # 未实现面绝不注册：注册项的实现函数必须已在「前体」实现区定义。
        if b"Napi::Value " + sym.encode() + b"(" not in precursor:
            fail(f"未实现面绝不注册：{name} 的实现 {sym}(…) 在前体实现区无定义"
                 f"（先落地实现再入 WIN_IMPLEMENTED）")
        lines.append(b'  reg("' + name.encode("ascii") + b'", ' + sym.encode("ascii") + b');')
    out = precursor + b"\n".join(lines) + b"\n" + tail
    return out, [n for n, _ in existing]


# ---------------------------------------------------------------------------
# 三种模式
# ---------------------------------------------------------------------------

def run_generate():
    out, existing = build_output()
    with open(SRC_PATH, "rb") as f:
        raw = f.read()
    if out == raw:
        print(f"{SRC_REL}: 零漂移（产物与现文件逐字节一致，{len(out)} bytes，未写入）")
    else:
        added = [n for n in WIN_IMPLEMENTED if n not in set(existing)]
        removed = [n for n in existing if n not in set(WIN_IMPLEMENTED)]
        with open(SRC_PATH, "wb") as f:
            f.write(out)
        print(f"{SRC_REL}: 已重写注册表（{len(existing)} → {len(WIN_IMPLEMENTED)} 面；"
              f"+{added} -{removed}；前体/尾部原样透传，{len(out)} bytes）")
    print(f"注册面 {len(WIN_IMPLEMENTED)}/官方 96；待实现 {96 - len(WIN_IMPLEMENTED)}"
          f"（W1 {len(W1_CATCH_UP)} / W2 {len(W2_MAC_LINEAGE)} / W3 {len(W3_WIN_DEEP)}）")


def run_verify():
    out, _ = build_output()
    with tempfile.NamedTemporaryFile(prefix="ax_native_win.cc.verify.", delete=False) as tmp:
        tmp.write(out)
        tmp_path = tmp.name
    try:
        with open(tmp_path, "rb") as f:
            written = f.read()
        with open(SRC_PATH, "rb") as f:
            raw = f.read()
        if written == raw:
            print(f"verify: OK —— 产物（临时文件 {tmp_path}，{len(written)} bytes）与现 "
                  f"{SRC_REL} 逐字节一致（含 BOM 与文件尾换行）")
            return 0
        n = min(len(written), len(raw))
        off = next((k for k in range(n) if written[k] != raw[k]), n)
        print(f"verify: DRIFT —— 产物 {len(written)} bytes vs 现文件 {len(raw)} bytes，"
              f"首个差异偏移 {off}")
        print(f"  产物: {written[max(0, off - 40):off + 40]!r}")
        print(f"  现文件: {raw[max(0, off - 40):off + 40]!r}")
        print("  （注册表机器管理区被手编，或面清单未同步——改本脚本后重跑生成，勿手改 .cc）")
        return 1
    finally:
        os.unlink(tmp_path)


def run_list_pending():
    print(f"待实现面（官方 96 − 已实现 {len(WIN_IMPLEMENTED)} = 47，批次出处：设计 §L1）")
    print(f"W1 追赶 vendored 0.6.3 已有 —— {len(W1_CATCH_UP)} 面:")
    for n in W1_CATCH_UP:
        print(f"  {n}")
    print(f"W2 mac 血统（ghost {len(W2_GHOST)} + pasteboard {len(W2_PASTEBOARD)} + "
          f"杂项 {len(W2_MISC)}）—— {len(W2_MAC_LINEAGE)} 面:")
    for n in W2_MAC_LINEAGE:
        print(f"  {n}")
    print(f"W3 win 专属深水区（postMessage {len(W3_POST_MESSAGE)} + UIA 梯 "
          f"{len(W3_UIA_LADDER)} + surface {len(W3_SURFACE)} + 杂项 {len(W3_MISC)}）"
          f"—— {len(W3_WIN_DEEP)} 面:")
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
                   help="产物写临时文件与现 src/ax_native_win.cc 逐字节比对，不一致 exit 1")
    g.add_argument("--list-pending", action="store_true",
                   help="按 W1/W2/W3 批次打印待实现面（3/22/22）")
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
