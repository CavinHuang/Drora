import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_COMPOSER_INPUT,
  testId,
} from "@drora/shared/test-ids";
import { clearAppData, clickTestIdByDom } from "../../../helpers/desktop-app.js";
import {
  getV4ComposerText,
  prepareV4ConversationE2E,
  waitForV4ComposerText,
} from "../../../helpers/v4-conversation.js";

/** VOICE-L01/L06：真实设置/composer + 受控媒体和测试 URL，零真实音频/厂商凭据。 */
type VoiceProbe = {
  activeTracks: number;
  aborts: number;
  uploads: number;
  emitFinal(text: string): void;
  restore(): void;
};

async function installMedia(mode: "webSpeech" | "remote") {
  await browser.execute((engine) => {
    const state = { activeTracks: 0, aborts: 0, uploads: 0 };
    const restorers: (() => void)[] = [];
    const replace = (target: object, key: string, value: unknown) => {
      const previous = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, { configurable: true, writable: true, value });
      restorers.push(() => {
        if (previous) Object.defineProperty(target, key, previous);
        else Reflect.deleteProperty(target, key);
      });
    };
    let emitRecognition: ((event: Event) => boolean) | null = null;
    class Recognition extends EventTarget {
      continuous = true;
      interimResults = true;
      lang = "";
      start() {
        emitRecognition = (event) => this.dispatchEvent(event);
      }
      stop() {
        this.dispatchEvent(new Event("end"));
      }
      abort() {
        state.aborts++;
        this.dispatchEvent(new Event("end"));
      }
    }
    replace(window, "SpeechRecognition", engine === "webSpeech" ? Recognition : undefined);
    replace(window, "webkitSpeechRecognition", undefined);
    replace(navigator, "mediaDevices", {
      getUserMedia: async () => {
        state.activeTracks++;
        let stopped = false;
        return {
          getTracks: () => [
            {
              stop: () => {
                if (!stopped) {
                  stopped = true;
                  state.activeTracks--;
                }
              },
            },
          ],
        };
      },
    });
    class Recorder extends EventTarget {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["synthetic-test-audio"], { type: this.mimeType }),
        });
        this.dispatchEvent(new Event("stop"));
      }
    }
    replace(window, "MediaRecorder", Recorder);
    const originalFetch = window.fetch.bind(window);
    replace(window, "fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://voice.example.test/v1/audio/transcriptions") {
        state.uploads++;
        return Promise.resolve(
          new Response(JSON.stringify({ text: "VOICE_L06_FINAL" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return originalFetch(input, init);
    });
    const harness: VoiceProbe = Object.assign(state, {
      emitFinal: (text: string) => {
        emitRecognition?.(
          Object.assign(new Event("result"), {
            resultIndex: 0,
            results: [{ isFinal: true, length: 1, 0: { transcript: text } }],
          }),
        );
      },
      restore: () => {
        for (const restore of restorers.reverse()) restore();
      },
    });
    Object.defineProperty(window, "__voiceLifecycleProbe", { configurable: true, value: harness });
  }, mode);
}

async function configureVoice(remote = false) {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
  await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed();
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "voice"));
  const toggle = await $('[data-testid="voice-entry-toggle"]');
  if ((await toggle.getAttribute("data-state")) !== "checked") {
    await clickTestIdByDom("voice-entry-toggle");
    const dialog = await $('[data-testid="voice-privacy-disclosure-dialog"]');
    // appSettings 会跨 case 保留；初始化允许已确认和未确认两种状态。
    await browser.waitUntil(
      async () =>
        (await dialog.isDisplayed()) || (await toggle.getAttribute("data-state")) === "checked",
    );
    if (await dialog.isDisplayed()) await clickTestIdByDom("voice-privacy-acknowledge");
  }
  if (remote) {
    for (const [id, value] of [
      ["voice-vendor-base-url", "https://voice.example.test/v1"],
      ["voice-vendor-asr-model", "synthetic-asr"],
      ["voice-vendor-api-key", "synthetic-not-a-real-key"],
    ] as const) {
      const input = await $(`[data-testid="${id}"]`);
      await input.setValue(value);
      await browser.keys("Tab");
    }
    await clickTestIdByDom("voice-asr-engine");
    const option = await $('[role="option"][data-state="unchecked"]:not([data-disabled])');
    // 此 Select 只有 webSpeech/remote 两项，当前 webSpeech 已选中，未选项即 remote。
    await option.waitForDisplayed();
    await option.click();
  }
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
  await $('[data-testid="v4-composer-voice-entry"]').waitForDisplayed({ timeout: 15000 });
}

describe("语音生命周期（VOICE-L01/L06，pending）", () => {
  afterEach(async () => {
    await browser.execute(() => {
      (
        window as unknown as { __voiceLifecycleProbe?: VoiceProbe }
      ).__voiceLifecycleProbe?.restore();
      Reflect.deleteProperty(window, "__voiceLifecycleProbe");
    });
    await clearAppData();
  });

  it("VOICE-L01：Esc 释放底层拾音且迟到 final 不进入草稿", async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
    await installMedia("webSpeech");
    await configureVoice();
    const mic = await $('[data-testid="v4-composer-voice-entry"]');
    await mic.click();
    await expect(mic).toHaveAttribute("data-voice-leg", "recording");
    expect(
      await browser.execute(
        () =>
          (window as unknown as { __voiceLifecycleProbe: VoiceProbe }).__voiceLifecycleProbe
            .activeTracks,
      ),
    ).toBe(1);
    // 预览条在输入框上方，键盘焦点路径无需点击其遮盖区域。
    await browser.execute(
      (id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.focus(),
      TID_V4_COMPOSER_INPUT,
    );
    await browser.keys("Escape");
    await expect(mic).toHaveAttribute("data-voice-leg", "idle");
    const state = await browser.execute(() => {
      const h = (window as unknown as { __voiceLifecycleProbe: VoiceProbe }).__voiceLifecycleProbe;
      h.emitFinal("VOICE_L01_LATE");
      return { activeTracks: h.activeTracks, aborts: h.aborts };
    });
    expect(state).toEqual({ activeTracks: 0, aborts: 1 });
    expect(await getV4ComposerText()).not.toContain("VOICE_L01_LATE");
  });

  it("VOICE-L06：remote 独立于 SpeechRecognition，final 恰一次追加", async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
    await installMedia("remote");
    await configureVoice(true);
    const mic = await $('[data-testid="v4-composer-voice-entry"]');
    await mic.click();
    await expect(mic).toHaveAttribute("data-voice-leg", "recording");
    await mic.click();
    await expect(mic).toHaveAttribute("data-voice-leg", "idle");
    await waitForV4ComposerText("VOICE_L06_FINAL", "remote final 未追加或出现重复");
    const state = await browser.execute(() => {
      const h = (window as unknown as { __voiceLifecycleProbe: VoiceProbe }).__voiceLifecycleProbe;
      return { activeTracks: h.activeTracks, uploads: h.uploads };
    });
    expect(state).toEqual({ activeTracks: 0, uploads: 1 });
  });
});
