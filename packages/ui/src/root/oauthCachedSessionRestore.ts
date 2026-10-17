import type { OAuthCachedSessionRestoreResult, UserInfo } from "@drora/shared";
import type { AlertDialogRequest } from "@/store/alertDialogStore.js";

export async function applyCachedOAuthSessionRestoreResult(params: {
  result: OAuthCachedSessionRestoreResult;
  setUser: (user: UserInfo | null) => void;
  requestAlert: (request: AlertDialogRequest) => Promise<boolean>;
  onReauthenticationRequired: () => void;
  copy: AlertDialogRequest;
}): Promise<boolean> {
  if (params.result.status === "authenticated") {
    params.setUser(params.result.userInfo);
    return true;
  }

  if (params.result.status === "reauthentication-required") {
    // 认证事实已经失效，不能等用户确认弹窗后才清 UI 登录态。
    params.setUser(null);
    await params.requestAlert(params.copy);
    params.onReauthenticationRequired();
  }

  return false;
}

/**
 * The global JWT-invalid broadcast may arrive from an unrelated provider
 * refresh while the desktop is already signed out. There is no authenticated
 * user to reauthenticate: showing a modal would wrongly block local/offline
 * Vault editing. This gate does not authorize any account request or preserve
 * invalid credentials; signed-in sessions still enter the normal expiry flow.
 */
export function shouldShowJwtInvalidSessionDialog(hasAuthenticatedUser: boolean): boolean {
  return hasAuthenticatedUser;
}
