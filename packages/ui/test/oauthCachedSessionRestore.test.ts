import { describe, expect, it, vi } from "vitest";
import {
  applyCachedOAuthSessionRestoreResult,
  shouldShowJwtInvalidSessionDialog,
} from "@/root/oauthCachedSessionRestore.js";

describe("applyCachedOAuthSessionRestoreResult", () => {
  it("clears the displayed user, shows one expiry alert, then opens reauthentication", async () => {
    const setUser = vi.fn();
    const requestAlert = vi.fn(async () => undefined);
    const onReauthenticationRequired = vi.fn();

    await applyCachedOAuthSessionRestoreResult({
      result: {
        status: "reauthentication-required",
        reason: "jwt-expired",
      },
      setUser,
      requestAlert,
      onReauthenticationRequired,
      copy: {
        title: "登录已过期",
        description: "为了保障账号安全，请重新登录。",
        actionLabel: "重新登录",
      },
    });

    expect(setUser).toHaveBeenCalledWith(null);
    expect(requestAlert).toHaveBeenCalledTimes(1);
    expect(requestAlert).toHaveBeenCalledWith({
      title: "登录已过期",
      description: "为了保障账号安全，请重新登录。",
      actionLabel: "重新登录",
    });
    expect(onReauthenticationRequired).toHaveBeenCalledTimes(1);
    expect(requestAlert.mock.invocationCallOrder[0]).toBeLessThan(
      onReauthenticationRequired.mock.invocationCallOrder[0],
    );
  });
});

describe("global expired-session UI vs offline Vault", () => {
  it("does not block a signed-out Vault with a stale background JWT notification", () => {
    expect(shouldShowJwtInvalidSessionDialog(false)).toBe(false);
  });

  it("still requires reauthentication for a currently signed-in user", () => {
    expect(shouldShowJwtInvalidSessionDialog(true)).toBe(true);
  });
});
