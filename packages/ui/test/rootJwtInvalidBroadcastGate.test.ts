// @vitest-environment jsdom
/**
 * JWT-invalid 广播门接线测试（ui-auth-1/ui-auth-2 修复，2026-10-17）：
 * 门函数本体恒真断言之外，真正的回归风险在「Root 传参 → 广播早退」的接线层——
 * 启动恢复未落定（user 仍为 null）时到达的真实过期广播必须挂起，恢复落定后：
 * 恢复成功 → 照常弹过期窗；确为登出 → 丢弃不劫持离线 Vault。
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IServiceAccessor } from "@drora/services";
import { DRORA_JWT_INVALID_BROADCAST_CHANNEL, type IPlatformService } from "@drora/shared";
import { useRootOAuthEffects } from "@/root/useRootOAuthEffects.js";

// confirmed=false → 走 onReauthenticationRequired 分支，便于断言（不触发 reload）。
const { requestAlertMock } = vi.hoisted(() => ({ requestAlertMock: vi.fn(async () => false) }));
vi.mock("@/hooks/useAlertDialog.js", () => ({ useAlertDialog: () => requestAlertMock }));
// intl 必须跨渲染稳定：否则 modal effect 依赖逐渲染变化、闭包 disposed 提前翻转。
const { intlMock } = vi.hoisted(() => ({
  intlMock: { formatMessage: ({ id }: { id: string }) => id },
}));
vi.mock("@/i18n/IntlProvider.js", () => ({ useDroraIntl: () => ({ intl: intlMock }) }));
vi.mock("@/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), lifecycle: { warn: vi.fn() } },
}));

type BroadcastHandler = (message: { channel: string }) => void;

function mountGate(initial: { hasAuthenticatedUser: boolean; restoring: boolean }) {
  let handler: BroadcastHandler | null = null;
  const services = {
    oauthService: {
      restoreCachedSessionState: vi.fn(async () => ({ status: "signed-out" })),
      getActiveProvider: vi.fn(async () => null),
    },
    broadcastService: {
      onMessage: vi.fn((h: BroadcastHandler) => {
        handler = h;
        return { dispose: vi.fn() };
      }),
    },
    providerSettingsService: {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      getView: vi.fn(async () => ({ revision: 1, providers: [] })),
    },
  } as unknown as IServiceAccessor;
  const props = {
    hasAuthenticatedUser: initial.hasAuthenticatedUser,
    isRestoringOAuthSession: initial.restoring,
    accountIntentKey: "test-account/individual",
    platform: {
      onOAuthCallback: vi.fn(() => vi.fn()),
      notifyRendererReady: vi.fn(),
      executeDesktopCommand: vi.fn(async () => true),
    } as unknown as IPlatformService,
    services,
    refreshProviderState: vi.fn(async () => undefined),
    refreshAppSettings: vi.fn(async () => undefined),
    setUser: vi.fn(),
    setIsRestoringOAuthSession: vi.fn(),
    setOAuthError: vi.fn(),
    oauthPollingActive: false,
    setOAuthPollingActive: vi.fn(),
    markOAuthSuccess: vi.fn(),
    onReauthenticationRequired: vi.fn(),
  };
  const mounted = renderHook(
    (next: typeof props | undefined) => {
      Object.assign(props, next ?? {});
      return useRootOAuthEffects(props);
    },
    { initialProps: props },
  );
  return {
    props,
    mounted,
    broadcast: (channel: string): void => {
      expect(handler, "broadcast 订阅必须已建立").toBeInstanceOf(Function);
      (handler as BroadcastHandler)({ channel });
    },
  };
}

describe("JWT-invalid 广播门：恢复窗口挂起与落定重判", () => {
  it("恢复未落定时到达的真实过期广播不弹窗也不吞掉；恢复成功后照常弹出", async () => {
    const gate = mountGate({ hasAuthenticatedUser: false, restoring: true });
    // 恢复窗口内：user=null 但 restoring=true → 挂起而非忽略（弹窗未弹）。
    gate.broadcast(DRORA_JWT_INVALID_BROADCAST_CHANNEL);
    expect(requestAlertMock).not.toHaveBeenCalled();
    expect(gate.props.onReauthenticationRequired).not.toHaveBeenCalled();
    await gate.mounted.rerender({
      ...gate.props,
      hasAuthenticatedUser: true,
      isRestoringOAuthSession: false,
    });
    // 恢复落定且登录态恢复成功 → 挂起的广播被重判：弹窗真实弹出，用户选择
    // 「暂不重启」→ 走重新认证分支（ui-auth-2：接线层不再零覆盖）。
    await waitFor(() => {
      expect(requestAlertMock).toHaveBeenCalledTimes(1);
      expect(gate.props.onReauthenticationRequired).toHaveBeenCalledTimes(1);
    });
  });

  it("恢复落定后确为已登出：挂起的广播被丢弃，离线 Vault 不被过期弹窗劫持", async () => {
    const gate = mountGate({ hasAuthenticatedUser: false, restoring: true });
    gate.broadcast(DRORA_JWT_INVALID_BROADCAST_CHANNEL);
    await gate.mounted.rerender({
      ...gate.props,
      hasAuthenticatedUser: false,
      isRestoringOAuthSession: false,
    });
    // 已落定且无登录用户：挂起广播被丢弃；随后新广播按原逻辑直接忽略。
    gate.broadcast(DRORA_JWT_INVALID_BROADCAST_CHANNEL);
    expect(gate.props.onReauthenticationRequired).not.toHaveBeenCalled();
  });
});
