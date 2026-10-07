import {
  droraProtocolMethods,
  droraPluginsReferenceCatalogResultSchema,
  type DroraPluginsReferenceCatalogParams,
} from "@drora/shared";
import type { DroraProtocolClient } from "#src/drora-agent/droraProtocolClient.js";

/** 旧协议严格校验响应；新展示字段走独立入口，只有 -32601 能证明旧 Agent 不支持。 */
export async function requestPluginReferenceCatalog(
  client: Pick<DroraProtocolClient, "request">,
  params: DroraPluginsReferenceCatalogParams,
) {
  try {
    return await client.request(
      droraProtocolMethods.pluginsReferenceCatalogWithCategory,
      params,
      droraPluginsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      droraProtocolMethods.pluginsReferenceCatalog,
      params,
      droraPluginsReferenceCatalogResultSchema,
    );
  }
}
