import type { IPlatformService } from "@drora/shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { useDesktopPet } from "@/hooks/useDesktopPet.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export function DesktopPetTaskSync({
  enabled,
  workspaceTabs,
  platform,
}: {
  enabled: boolean;
  workspaceTabs: WorkspaceTabState[];
  platform: IPlatformService;
}) {
  if (!enabled || !platform.publishDesktopPet) return null;
  const unique = new Map(
    workspaceTabs
      .filter((tab) => tab.availability !== "unavailable-local-directory")
      .map((tab) => [
        JSON.stringify([tab.workspaceIdentity?.trim() || tab.workspacePath, tab.remoteSessionId]),
        tab,
      ]),
  );
  return (
    <>
      {[...unique.entries()].map(([key, tab]) => (
        <WorkspacePetSource key={key} tab={tab} platform={platform} />
      ))}
    </>
  );
}

function WorkspacePetSource({
  tab,
  platform,
}: {
  tab: WorkspaceTabState;
  platform: IPlatformService;
}) {
  const resolution = useWorkspaceServicesResolution(
    tab.workspacePath,
    tab.remoteSessionId,
    tab.workspaceIdentity,
    tab.remoteTarget,
  );
  return (
    <ServiceProvider services={resolution.services}>
      <WorkspacePetProjection
        tab={tab}
        platform={platform}
        rpcReady={resolution.rpcReady}
        remoteSessionId={resolution.remoteSessionId ?? undefined}
      />
    </ServiceProvider>
  );
}

function WorkspacePetProjection({
  tab,
  platform,
  rpcReady,
  remoteSessionId,
}: {
  tab: WorkspaceTabState;
  platform: IPlatformService;
  rpcReady: boolean;
  remoteSessionId?: string;
}) {
  useDesktopPet({
    workspacePath: tab.workspacePath,
    workspaceIdentity: tab.workspaceIdentity,
    endpointKey: remoteSessionId,
    rpcReady,
    enabled: true,
    platform,
  });
  return null;
}
