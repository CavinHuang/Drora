import { VaultView } from "@/v4/VaultView.js";

/** 自研主区注册点：数据、授权和业务状态仍由 Vault/Knowledge 服务持有。 */
export function isDroraWorkspaceMainView(view: string): boolean {
  return view === "vault";
}

export function DroraWorkspaceMainView({
  sessionId,
  workspaceKey,
}: {
  sessionId?: string;
  workspaceKey: string;
}) {
  return <VaultView sessionId={sessionId} workspaceKey={workspaceKey} />;
}
