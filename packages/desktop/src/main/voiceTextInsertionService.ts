/**
 * 系统级听写终稿注入服务（specs/voice-agent-integration.md §5.6，2026-11-08）。
 *
 * 方案照 Proma text-insertion-service.ts 实证（剪贴板快照→写入→合成 ⌘V→延迟还原→
 * 失败兜底留剪贴板），适配本仓 Electron 44 的 W3C 异步 clipboard（read()/write()
 * ClipboardItem[]）——快照=全格式 ClipboardItem 原样回写，保真度与 Proma 的
 * text/html/rtf/image/buffer 逐格式快照等价。mac 合成 ⌘V 走 osascript System Events
 * keystroke（需「辅助功能」权限）；Windows（SendInput）记档不实现。
 *
 * 剪贴板/粘贴触发/时钟注入（测试脱离 Electron）；纯逻辑（还原判定）单测钉住。
 */

import type { VoiceGlobalInsertResult } from "@drora/shared";

/** 剪贴板快照：全格式 ClipboardItem 原样持有（还原=原样回写）。 */
export interface ClipboardSnapshot {
  items: unknown[];
  text: string;
}

export interface TextInsertionDeps {
  readText(): Promise<string>;
  /** Electron 44 clipboard.read()：全格式条目（原样对象，还原用）。 */
  readAll(): Promise<unknown[]>;
  writeText(text: string): Promise<void>;
  /** 还原快照：write(items)（快照非空时）；空快照由调用方 clear。 */
  writeAll(items: unknown[]): Promise<void>;
  clear(): void;
  /** 合成系统粘贴（mac=osascript ⌘V）；未授权辅助功能时 reject（错误消息给引导）。 */
  triggerPaste(): Promise<void>;
  isTrustedAccessibilityClient(): boolean;
  sleep(ms: number): Promise<void>;
  setTimeoutUnref(cb: () => void, ms: number): void;
}

export const CLIPBOARD_READY_DELAY_MS = 80;
export const CLIPBOARD_RESTORE_DELAY_MS = 10_000;

/** 还原判定（纯函数）：用户未改动剪贴板（仍是注入文本）才还原。 */
export function shouldRestoreSnapshot(currentText: string, insertedText: string): boolean {
  return currentText === insertedText;
}

/** 主入口：终稿写入前台 App 光标位置；失败兜底=留在剪贴板。 */
export async function insertTextAtFrontmostCursor(
  text: string,
  deps: TextInsertionDeps,
): Promise<VoiceGlobalInsertResult> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { success: false, errorMessage: "empty text" };
  }
  if (!deps.isTrustedAccessibilityClient()) {
    // 辅助功能未授权：不劫持剪贴板（粘贴必失败），直接引导。
    return { success: false, errorMessage: "accessibility permission required" };
  }
  const snapshot: ClipboardSnapshot = { items: await deps.readAll(), text: await deps.readText() };
  await deps.writeText(trimmed);
  try {
    await deps.sleep(CLIPBOARD_READY_DELAY_MS);
    await deps.triggerPaste();
    deps.setTimeoutUnref(() => {
      void (async () => {
        try {
          const current = await deps.readText();
          if (!shouldRestoreSnapshot(current, trimmed)) return;
          if (snapshot.items.length > 0) {
            await deps.writeAll(snapshot.items);
          } else {
            deps.clear(); // 原剪贴板为空：还原为空。
          }
        } catch {
          // 还原失败不影响注入结果（文本已在前台 App）。
        }
      })();
    }, CLIPBOARD_RESTORE_DELAY_MS);
    return { success: true };
  } catch (error) {
    // 兜底：文本留在剪贴板（Proma 同款语义）。
    return {
      success: false,
      errorMessage: `paste failed, text kept in clipboard: ${
        error instanceof Error ? error.message.slice(0, 120) : String(error)
      }`,
    };
  }
}
