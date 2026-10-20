import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRORA_JWT_INVALID_BROADCAST_CHANNEL } from "@drora/shared";

const { effects, requestAlert } = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  requestAlert: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => effects.push(effect),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@/hooks/useAlertDialog.js", () => ({ useAlertDialog: () => requestAlert }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/root/useAccountConnectionLossNotification.js", () => ({
  useAccountConnectionLossNotification: vi.fn(),
}));
vi.mock("@/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { useRootOAuthEffects } from "@/root/useRootOAuthEffects.js";

describe("运行时登录失效进入重新登录", () => {
  beforeEach(() => {
    effects.length = 0;
    requestAlert.mockReset();
  });
  it.each([true, false])("提示结果 %s 都使用登录入口，不重启 App", async (confirmed) => {
    let finish!: (value: boolean) => void;
    requestAlert.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    let receive!: (message: { channel: string }) => void;
    const setUser = vi.fn(),
      onReauthenticationRequired = vi.fn(),
      executeDesktopCommand = vi.fn();
    useRootOAuthEffects({
      accountIntentKey: "synthetic",
      // Drora 三态门控（ui-auth-1）：已登录才放行过期弹窗；恢复已落定避免广播被挂起重判。
      hasAuthenticatedUser: true,
      isRestoringOAuthSession: false,
      platform: { executeDesktopCommand } as never,
      services: {
        oauthService: { getActiveProvider: async () => null },
        broadcastService: {
          onMessage: (listener: typeof receive) => {
            receive = listener;
            return { dispose: vi.fn() };
          },
        },
      } as never,
      refreshProviderState: vi.fn(),
      setUser,
      setIsRestoringOAuthSession: vi.fn(),
      setOAuthError: vi.fn(),
      oauthPollingActive: false,
      setOAuthPollingActive: vi.fn(),
      markOAuthSuccess: vi.fn(),
      onReauthenticationRequired,
    });
    // S5 合并后广播处理拆为三个 effect：effects[1]=订阅（Drora 三态门控）、
    // effects[2]=恢复落定重判（ui-auth-1）、effects[3]=弹窗实现（写入
    // showJwtInvalidDialogRef）。只跑订阅 effect 时 ref 仍是空操作，
    // 需先执行弹窗实现 effect 再订阅，广播才能触发 requestOAuthReauthentication。
    const disposeDialog = effects[3]() as () => void;
    const dispose = effects[1]() as () => void;
    receive({ channel: DRORA_JWT_INVALID_BROADCAST_CHANNEL });
    receive({ channel: DRORA_JWT_INVALID_BROADCAST_CHANNEL });
    await vi.waitFor(() => expect(setUser).toHaveBeenCalledWith(null));
    expect(requestAlert).toHaveBeenCalledOnce();
    expect(requestAlert).toHaveBeenCalledWith(
      expect.objectContaining({ actionLabel: "login.expired.action" }),
    );
    expect(onReauthenticationRequired).not.toHaveBeenCalled();
    finish(confirmed);
    await vi.waitFor(() => expect(onReauthenticationRequired).toHaveBeenCalledOnce());
    expect(executeDesktopCommand).not.toHaveBeenCalled();
    disposeDialog();
    dispose();
  });

  it.each(["before-alert", "during-alert"])(
    "新登录在 %s 完成时不显示或执行旧过期提示",
    async (timing) => {
      let finish!: (value: boolean) => void;
      requestAlert.mockReturnValue(
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
      );
      let activeProvider: "zai" | null = timing === "before-alert" ? "zai" : null;
      const getActiveProvider = vi.fn(async () => activeProvider),
        setUser = vi.fn(),
        onReauthenticationRequired = vi.fn();
      let receive!: (message: { channel: string }) => void;
      useRootOAuthEffects({
        accountIntentKey: "synthetic",
        // 同上：已登录 + 恢复已落定，走标准过期弹窗链路。
        hasAuthenticatedUser: true,
        isRestoringOAuthSession: false,
        platform: {} as never,
        services: {
          oauthService: { getActiveProvider },
          broadcastService: {
            onMessage: (listener: typeof receive) => {
              receive = listener;
              return { dispose: vi.fn() };
            },
          },
        } as never,
        refreshProviderState: vi.fn(),
        setUser,
        setIsRestoringOAuthSession: vi.fn(),
        setOAuthError: vi.fn(),
        oauthPollingActive: false,
        setOAuthPollingActive: vi.fn(),
        markOAuthSuccess: vi.fn(),
        onReauthenticationRequired,
      });
      // 同上：先执行弹窗实现 effect（effects[3]），再执行广播订阅 effect（effects[1]）。
      const disposeDialog = effects[3]() as () => void;
      const dispose = effects[1]() as () => void;
      receive({ channel: DRORA_JWT_INVALID_BROADCAST_CHANNEL });
      if (timing === "before-alert") {
        await vi.waitFor(() => expect(getActiveProvider).toHaveBeenCalledOnce());
        expect(requestAlert).not.toHaveBeenCalled();
        expect(setUser).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => expect(requestAlert).toHaveBeenCalledOnce());
        activeProvider = "zai";
        finish(true);
        await vi.waitFor(() => expect(getActiveProvider).toHaveBeenCalledTimes(2));
      }
      expect(onReauthenticationRequired).not.toHaveBeenCalled();
      disposeDialog();
      dispose();
    },
  );
});
