import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@drora/shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  restoreElectronRendererContentSize,
  setCurrentElectronRendererContentSize,
} from "./helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "./helpers/v4-conversation.js";

/**
 * 语音听写 composer 入口 E2E（specs/voice-agent-integration.md §9.2 / §6.1 / FD-5）。
 *
 * 覆盖不需要真实麦克风硬件的验收面：
 * - §6.1 开关 1：voiceComposerEntryHidden 缺省 true → mic 入口不渲染（不闪按钮、
 *   不后台白跑权限查询）；
 * - 设置页 voice 分节真实开关路径：开启 → 披露确认门（FD-5）→ 确认后入口渲染；
 *   取消 → 开关回落；
 * - §9.2 快照验收的几何子集：390px 窄宽度下入口仍渲染可点（截图基线仍为附录 C.4
 *   deferred 项，本用例只断言几何存在性）。
 *
 * 录音交互（getUserMedia / SpeechRecognition）需要真实拾音与目标运行时网络，属
 * TV-1 spike 与桌面真机范围，不在本文件内断言。
 */

const MIC_ENTRY_TEST_ID = "v4-composer-voice-entry";
const VOICE_SECTION_NAV = testId(TID_SETTINGS_SECTION_NAV, "voice");

function sel(testIdValue: string): string {
  return `[data-testid="${testIdValue}"]`;
}

async function openVoiceSettingsSection() {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15000,
    timeoutMsg: "没有找到设置入口按钮",
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
  await clickTestIdByDom(VOICE_SECTION_NAV, {
    timeout: 15000,
    timeoutMsg: "设置页没有出现 voice 分区入口",
  });
  await $(sel("voice-entry-toggle")).waitForDisplayed({ timeout: 15000 });
}

describe("语音听写 composer 入口（§9.2 / FD-5）", () => {
  let rendererSizeSnapshot: Awaited<ReturnType<typeof setCurrentElectronRendererContentSize>> | undefined;

  after(async () => {
    if (rendererSizeSnapshot) {
      await restoreElectronRendererContentSize(rendererSizeSnapshot);
    }
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("voiceComposerEntryHidden 缺省 true：mic 入口不渲染（§6.1 开关 1）", async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
    // 缺省隐藏：入口 DOM 不存在（不是 disabled 占位）。
    const entry = await $(sel(MIC_ENTRY_TEST_ID));
    expect(await entry.isExisting()).toBe(false);
  });

  it("设置页开启入口：未确认时先弹三条披露（FD-5），取消则开关回落", async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
    await openVoiceSettingsSection();
    await clickTestIdByDom("voice-entry-toggle", {
      timeout: 15000,
      timeoutMsg: "voice 分区没有出现入口开关",
    });

    // FD-5：acknowledged=false → 先展示三条披露；开关在本步尚未生效。
    const dialog = await $(sel("voice-privacy-disclosure-dialog"));
    await dialog.waitForDisplayed({ timeout: 15000 });
    await clickTestIdByDom("voice-privacy-cancel", {
      timeoutMsg: "披露弹层没有取消按钮",
    });
    await dialog.waitForDisplayed({ timeout: 15000, reverse: true });
    // 开关回落：仍未选中（再次点按会重新弹披露）。精确匹配——"unchecked" 含
    // "checked" 子串，不能用 containing 模式。
    await expect($(sel("voice-entry-toggle"))).toHaveAttribute("data-state", "unchecked");
  });

  it("确认披露后入口开关生效，返回 composer 可见（390px 与默认宽度，FD-5 + 几何子集）", async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
    await openVoiceSettingsSection();
    await clickTestIdByDom("voice-entry-toggle", {
      timeout: 15000,
      timeoutMsg: "voice 分区没有出现入口开关",
    });
    await $(sel("voice-privacy-disclosure-dialog")).waitForDisplayed({ timeout: 15000 });
    // FD-5：确认后中止本次动作——弹层关闭、开关生效（acknowledged 持久化），
    // 但不自动做任何后续语音动作。
    await clickTestIdByDom("voice-privacy-acknowledge", {
      timeoutMsg: "披露弹层没有确认按钮",
    });
    await $(sel("voice-privacy-disclosure-dialog")).waitForDisplayed({
      timeout: 15000,
      reverse: true,
    });
    await expect($(sel("voice-entry-toggle"))).toHaveAttribute(
      "data-state",
      "checked",
      { containing: true },
    );

    // 返回 composer：入口渲染（默认宽度）。
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15000,
      timeoutMsg: "设置页返回按钮没有出现",
    });
    const micEntry = await $(sel(MIC_ENTRY_TEST_ID));
    await micEntry.waitForDisplayed({ timeout: 15000 });
    // 未点按时处于 idle（locale 无关断言，避免依赖录音硬件）。
    await expect(micEntry).toHaveAttribute("data-voice-leg", "idle", { containing: true });

    // §9.2 几何子集：390px 窄宽度下入口仍渲染可见（截图基线另属附录 C.4 deferred）。
    rendererSizeSnapshot = await setCurrentElectronRendererContentSize(390);
    await expect(micEntry).toBeDisplayed();
  });
});
