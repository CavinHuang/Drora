// §33.18.15 终端侧板换装（specs/mobile-relay-r3-frontend.md：§33.18.14 存续分歧
// 「readline 自研 vs 官方 xterm」清偿）：直接换装 ui 包官方侧板终端
// SidePaneTerminalPane（xterm + PTY registry 保活）。数据面 = 手机 accessor 的
// terminalService——ProxyChannel.toService 全方法透明 RPC 代理（remoteServiceAccess
// :121），ui TerminalSession 消费的 create/write/resize/dispose/onDynamicData/
// onDynamicExit 六口全部透传，桥零改动。
import { lazy, Suspense } from "react";
import type { IServiceAccessor } from "@drora/services";
import { DroraIntlProvider } from "@drora/ui/git-pane";
import { resolveLocale } from "../ui/intl.js";

const SidePaneTerminalPane = lazy(() =>
  import("@drora/ui/side-pane-terminal").then((module) => ({
    default: module.SidePaneTerminalPane,
  })),
);

export interface RemoteSidePaneTerminalProps {
  accessor: IServiceAccessor;
  /** 保活键（persistentKey）：任务 id，跨面板开合复用 PTY/scrollback。 */
  sessionId: string;
  /** workspace 身份隔离 key（workspaceIdentity?.trim() || workspacePath，回收键）。 */
  workspaceKey?: string;
  cwd?: string;
}

export function RemoteSidePaneTerminal(props: RemoteSidePaneTerminalProps) {
  return (
    <DroraIntlProvider initialLocale={resolveLocale()}>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <SidePaneTerminalPane
          services={props.accessor}
          sessionId={props.sessionId}
          workspaceKey={props.workspaceKey}
          cwd={props.cwd}
          isVisible
          // TODO(协议面)：桌面 OS 信息随连接元数据下发后再接（官方 isWindowsDesktop
          // 驱动 PowerShell readline 归一化；本仓连接态暂无该字段，缺省 false）。
          isWindowsDesktop={false}
          onOpenBrowserUrl={() => {
            // 手机页无浏览器打开通道（协议面未含），终端链接打开动作降级忽略。
          }}
        />
      </Suspense>
    </DroraIntlProvider>
  );
}
