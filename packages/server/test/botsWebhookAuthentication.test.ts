import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { ServiceCollection, IBotsService } from "@drora/services";
import { createHttpServer } from "../src/http.js";
import {
  baseConfig,
  createMemoryRepo,
  createBotsService,
  createCredentialService,
  createBroadcastService,
  createLegacyTaskService,
} from "../../services/test/botsService.fixtures.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("real Bot service webhook authentication", () => {
  it.each([
    [{ "x-zcode-bot-secret": "secret" }, true],
    [{ "x-drora-bot-secret": "secret" }, true],
    [{ "x-zcode-bot-secret": "secret", "x-drora-bot-secret": "secret" }, true],
    [{}, false],
    [{ "x-drora-bot-secret": "wrong" }, false],
    [{ "x-zcode-bot-secret": "secret", "x-drora-bot-secret": "wrong" }, false],
  ] as const)(
    "binds only a credential-verified actor via HTTP: %j",
    async (headers, shouldBind) => {
      const repo = createMemoryRepo(structuredClone(baseConfig));
      const bots = createBotsService({
        repo,
        credentialService: createCredentialService({ "secret-1": "secret" }),
        broadcastService: createBroadcastService(),
        legacyTaskService: createLegacyTaskService(),
      });
      const code = await bots.createBindCode({ botId: "webhook-1" });
      const server = createHttpServer(new ServiceCollection().register(IBotsService, bots), 0);
      disposals.push(
        () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      );
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots/webhook`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({
            botId: "webhook-1",
            userId: "verified-user",
            text: `/bind ${code.code}`,
          }),
        },
      );
      await response.json();
      const config = await repo.readConfig();
      expect(config.bots[0]?.providerUserId).toBe(shouldBind ? "verified-user" : undefined);
      if (
        "x-zcode-bot-secret" in headers &&
        "x-drora-bot-secret" in headers &&
        headers["x-zcode-bot-secret"] !== headers["x-drora-bot-secret"]
      )
        expect(response.status).toBe(401);
      // Header 兼容不改写用户的出站配置，也不会新增业务 owner。
      expect(config.bots[0]?.webhookAuthHeaderName).toBe(baseConfig.bots[0]?.webhookAuthHeaderName);
    },
  );
});
