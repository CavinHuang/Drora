import { describe, expect, it } from "vitest";

import { relayV2ServerModule } from "./module.js";
import { exampleRelayV2Server } from "./contract.example.js";
import type { RelayV2ServerContract } from "./contract.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
describe("relay-v2-server contract", () => {
  it("declares its module manifest", () => {
    expect(relayV2ServerModule.id).toBe("relay-v2-server");
    expect(relayV2ServerModule.requires).toContain("web-remote-relay");
  });

  it("start → stop 生命周期往返（装配示例走通契约面）", async () => {
    const calls: string[] = [];
    const contract: RelayV2ServerContract = {
      start: async () => {
        calls.push("start");
        // 句柄公开面含 port（唯一出处 src/index.ts，contract.ts re-export）：桩按真实形状返回
        return {
          port: 0,
          stop: async () => {
            calls.push("stop");
          },
        };
      },
    };
    await exampleRelayV2Server(contract);
    expect(calls).toEqual(["start", "stop"]);
  });
});
