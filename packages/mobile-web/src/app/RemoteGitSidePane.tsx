// R3 P6 GitPane 一期装配壳（specs/mobile-relay-r3-frontend.md §25）：官方 GitPane 复原件
// （packages/ui/src/GitPane.tsx，D6 冻结域）经窄公开入口 @drora/ui/git-pane 装配。
// Provider 壳（§25.3 壳形取证 + §25.3 修正）：ServiceProvider{accessor}（useServices
// 极简 Context）+ StoreProvider{broadcast mock} + TabStoreProvider（自建）+
// DroraIntlProvider/TooltipProvider/PluginReferenceIconProvider（照抄
// RemoteConversationTimeline 官方壳三件套）。
// 层序契约：useGitRepository 内部 useServices/useDroraIntl 必须在对应 Provider 内
// 执行——外层 RemoteGitSidePane 只做壳挂载，GitPaneBody（Provider 内层组件）承载数据
// 派生与 GitPane。开合：open 归 App（side-pane-toggle 联动，§23.15）；官方窄壳侧板 =
// 右侧覆盖浮层。
import * as React from "react";
import {
  GitPane,
  PlatformProvider,
  useGitRepository,
  type GitPaneRepositoryState,
} from "@drora/ui/git-pane";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { PluginReferenceIconProvider } from "@/v4/pluginReferenceIconContext.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { StoreProvider } from "@/store/StoreProvider.js";
import { TabStoreProvider } from "@/store/TabStoreProvider.js";
import { createRemoteWebPlatform } from "./remoteWebPlatform.js";
import type { IServiceAccessor, IBroadcastService } from "@drora/services";
import type { Event } from "@drora/rpc";
import { X } from "lucide-react";
import { useIntl, resolveLocale } from "../ui/intl.js";

/** GitPane 一期 mock 广播服务（六成员 no-op；store 构造存而不用，无订阅方）。 */
function createMockBroadcastService(): IBroadcastService {
  const noopEvent: Event<unknown> = Object.assign(() => ({ dispose: () => {} }), {});
  return {
    send: () => Promise.resolve(),
    acquireClaim: () => Promise.resolve({ status: "unavailable" } as never),
    commitClaim: () => Promise.resolve(),
    releaseClaim: () => Promise.resolve(),
    tryClaim: () => Promise.resolve(false),
    onMessage: noopEvent as never,
  };
}
const MOCK_BROADCAST = createMockBroadcastService();
// 远控 web 平台适配（§28 受控移植：官方 createWebPlatform 逐方法对照，自持零依赖图污染）。
const WEB_PLATFORM = createRemoteWebPlatform();
const ACCESSOR_IDS = new WeakMap<IServiceAccessor, number>();
let nextAccessorId = 0;

function accessorId(accessor: IServiceAccessor): number {
  const existing = ACCESSOR_IDS.get(accessor);
  if (existing !== undefined) return existing;
  const id = ++nextAccessorId;
  ACCESSOR_IDS.set(accessor, id);
  return id;
}

export interface RemoteGitSidePaneProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 桥远端会话 id（Host 侧 git 目标识别；一期 mobile 桥未暴露，传 null 走本地直连语义）。 */
  remoteSessionId?: string | null;
  /** 桥服务 accessor（taskSession 持有；Host git 通道经此消费）。 */
  accessor: IServiceAccessor;
  activeTaskId: string | null;
  onRefreshGit?: () => void;
  className?: string;
}

const __modId = ((globalThis as { __svcModuleId?: string }).__svcModuleId ??= "shell-" + Math.random().toString(36).slice(2, 8)) as string;

export function RemoteGitSidePane({
  open,
  onClose,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  accessor,
  activeTaskId,
  onRefreshGit,
  className,
}: RemoteGitSidePaneProps) {
  const { formatMessage } = useIntl();
  (globalThis as { __prov?: string[] }).__prov ??= [];
  const prov = ((globalThis as { __prov?: string[] }).__prov ??= []);
  prov.push(String("GitSidePane-shell:" + __modId));
  if (!open) return null;
  return (
    <aside
      className={
        "absolute inset-y-0 right-0 z-20 flex w-80 max-w-[85%] flex-col border-l border-border bg-background shadow-lg " +
        (className ?? "")
      }
      aria-label={formatMessage({ id: "workspaceSidebar.showFileTree" })}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-ui-sm font-medium text-foreground">
          {formatMessage({ id: "workspaceSidebar.showFileTree" })}
        </span>
        <button
          type="button"
          aria-label={formatMessage({ id: "common.cancel" })}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Provider 先于消费（层序契约）：GitPaneBody 在全套 Provider 内承载数据派生。 */}
        <DroraIntlProvider initialLocale={resolveLocale()}>
          <TooltipProvider delayDuration={0}>
            <PluginReferenceIconProvider value={null}>
              <PlatformProvider platform={WEB_PLATFORM}>
              <TabStoreProvider>
                <StoreProvider broadcastService={MOCK_BROADCAST}>
                  <ServiceProvider services={accessor}>
                    <GitPaneBody
                      key={`${workspaceIdentity?.trim() || workspacePath}:${activeTaskId}:${accessorId(accessor)}`}
                      workspacePath={workspacePath}
                      activeTaskId={activeTaskId}
                      onClose={onClose}
                      onRefreshGit={onRefreshGit}
                    />
                  </ServiceProvider>
                </StoreProvider>
              </TabStoreProvider>
              </PlatformProvider>
            </PluginReferenceIconProvider>
          </TooltipProvider>
        </DroraIntlProvider>
      </div>
    </aside>
  );
}

/** Provider 内层：git 数据派生 + GitPane 挂载（本地交互态归此层）。 */
function GitPaneBody({
  workspacePath,
  activeTaskId,
  onClose,
  onRefreshGit,
}: {
  workspacePath: string;
  activeTaskId: string | null;
  onClose: () => void;
  onRefreshGit?: () => void;
}) {
  const [selectedSourceId, setSelectedSourceId] = React.useState<string>("unstaged");
  const [findNavRequest, setFindNavRequest] = React.useState(0);
  const [gitRefreshToken, setGitRefreshToken] = React.useState(0);
  const gitState: GitPaneRepositoryState = useGitRepository({
    workspacePath,
    activeTaskId,
    refreshToken: gitRefreshToken,
    // 手机桥已绑定当前 Host；桌面 remote workspace 注册表不参与此查询。
    // 传入远端 identity 且没有 desktop remoteSessionId 会让原 hook 禁止 Git RPC。
  });
  return (
    <GitPane
      workspacePath={workspacePath}
      gitState={gitState}
      selectedSourceId={selectedSourceId as never}
      fileChangeFindActiveIndex={0}
      fileChangeFindNavigationRequestId={findNavRequest}
      fileChangeFindQuery=""
      onFileChangeFindMatchCountChange={() => {}}
      onSelectSource={(sourceId) => setSelectedSourceId(sourceId as string)}
      onClose={onClose}
      onRefresh={() => {
        setGitRefreshToken((token) => token + 1);
        onRefreshGit?.();
      }}
    />
  );
}
