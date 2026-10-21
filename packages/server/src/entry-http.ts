import {
  createServerHostServices,
  createTopicResourcePeers,
  getAppConfigDir,
} from "@drora/services/node";
import {
  materializeBundledDroraBuiltinProviderConfig,
  readBundledDroraBuiltinProviderConfig,
} from "./bundledDroraBuiltinProviderConfig.js";
import { createHttpServer, resolveHttpServerId } from "./http.js";

async function main(): Promise<void> {
  const droraBuiltinProviderConfigFilePath = await materializeBundledDroraBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledDroraBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["DRORA_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["DRORA_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["DRORA_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const topicResourcePeers = createTopicResourcePeers();
  const serverId = resolveHttpServerId();
  const { services, workspaceIdentityMapper, migrationFailedPathCount } =
    await createServerHostServices({
      topicResourceRelayChannel: (request) => topicResourcePeers.getChannel(request),
      sourceServerId: serverId,
      droraBuiltinProviderConfigFilePath,
      providerProvisioningTargetEnabled: Boolean(authToken),
    });

  createHttpServer(services, port, {
    serverId,
    workspaceIdentityMapper,
    migrationFailedPathCount,
    virtualProjects: true,
    topicResourcePeers,
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[drora-server:http] startup failed", error);
  process.exitCode = 1;
});
