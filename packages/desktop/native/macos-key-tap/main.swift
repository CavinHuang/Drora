// 系统级听写全局触发 key-tap（specs/voice-agent-integration.md §5.6，2026-11-08）。
//
// 职责单一：CGEventTap（listen-only）监听 flagsChanged，检测「右 ⌥（kVK_RightOption）
// 与 右 ⌘（kVK_RightCommand）同时按下」的瞬间，向 stdout 输出一行 {"event":"trigger"}。
// 任一释放后才允许下一次触发（弦去抖）。
//
// 为什么需要独立二进制：Electron globalShortcut 注册不了纯修饰键组合（accelerator
// 必须含非修饰键）且不区分修饰键左右侧——用户裁定的「右 ⌥+右 ⌘」唯一路线是
// CGEventTap（Blurt/Karabiner 同路线）。listen-only 不吞事件，其他 App 的修饰键
// 使用零影响。权限：键盘事件 tap（含 listen-only）需「输入监控」TCC 授权；未授权时
// CGEventTapCreate 返回 NULL——输出 {"event":"denied"} 后以退出码 2 结束，由父进程
// 引导授权后重启本 helper。
//
// 形态照 macos-window-bounds 先例：常驻进程 + stdout 行协议（行缓冲）。
// 用法：drora-key-tap（无参数）

import Carbon.HIToolbox
import CoreGraphics
import Foundation

// 弦状态（callback 不能捕获上下文，用全局变量）。
var rightOptionDown = false
var rightCommandDown = false
var chordLatched = false

func emit(_ object: [String: String]) {
  if let data = try? JSONSerialization.data(withJSONObject: object),
    let line = String(data: data, encoding: .utf8) {
    print(line)
    fflush(stdout)
  }
}

func handleFlagsChanged(_ event: CGEvent) {
  let keyCode = Int32(event.getIntegerValueField(.keyboardEventKeycode))
  let flags = event.flags

  // flagsChanged 的事件本身只携带「本次变化的那个修饰键」的 keycode；左右侧由
  // keycode 区分（61=右 ⌥、54=右 ⌘；58/55 为左侧，不在弦内）。
  switch keyCode {
  case Int32(kVK_RightOption):
    rightOptionDown = flags.contains(.maskAlternate)
  case Int32(kVK_RightCommand):
    rightCommandDown = flags.contains(.maskCommand)
  default:
    break
  }

  if rightOptionDown && rightCommandDown {
    if !chordLatched {
      chordLatched = true
      emit(["event": "trigger"])
    }
  } else {
    chordLatched = false
  }
}

let callback: CGEventTapCallBack = { _, _, event, _ -> Unmanaged<CGEvent>? in
  if event.type == .flagsChanged {
    handleFlagsChanged(event)
  }
  // listen-only：事件原样放行。
  return Unmanaged.passRetained(event)
}

guard
  let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(1 << CGEventType.flagsChanged.rawValue),
    callback: callback,
    userInfo: nil
  )
else {
  // 未授权「输入监控」（或 session tap 不可用）：交给父进程引导。
  emit(["event": "denied"])
  exit(2)
}

// 行缓冲：父进程逐行读取（照 window-bounds 先例）。
setvbuf(stdout, nil, _IOLBF, 0)
emit(["event": "listening"])

CFRunLoopAddSource(
  CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0), .commonModes
)
CGEvent.tapEnable(tap: tap, enable: true)
CFRunLoopRun()
