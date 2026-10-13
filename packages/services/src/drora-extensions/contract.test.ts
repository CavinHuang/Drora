import { expect, it } from "vitest";
import { buildCuaProductHelperAgentEnv } from "./cuaAgentEnvironment.js";
it("non-CUA sessions add no helper authority or broker credentials", async () => {
  expect(await buildCuaProductHelperAgentEnv(undefined)).toEqual({});
});

import { vi } from "vitest";
import type { ISettingService } from "../setting/setting.js";
import { assembleDroraKnowledgeHost } from "./knowledgeHost.js";
it("unreadable settings fail closed without blocking the Host or creating a semantic model", async () => {
  const warn = vi.fn();
  const settingService = {
    get: vi.fn(async () => {
      throw new Error("settings_unavailable");
    }),
  } as unknown as ISettingService;
  const host = await assembleDroraKnowledgeHost(settingService, { warn });
  expect(host.knowledgeEmbeddingPort).toBeNull();
  expect(await host.knowledgeJevConfigSource()).toBeNull();
  expect(warn).toHaveBeenCalledTimes(2);
});
