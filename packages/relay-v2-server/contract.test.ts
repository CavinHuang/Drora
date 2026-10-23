import { describe, expect, it } from "vitest";

import { relayV2ServerModule } from "./module.js";
import { exampleRelayV2Server } from "./contract.example.js";
import { createRelayServer } from "./src/index.js";
import type { RelayV2ServerContract } from "./contract.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
// 例外（评审裁定 contract-impl-assert）：用类型赋值把契约面与真实入口 createRelayServer 钉在
// 一起——真实入口的签名/句柄形状一旦漂移，此处编译期即失败，契约文档不再是纸面声明。
const impl: RelayV2ServerContract = { start: createRelayServer };

describe("relay-v2-server contract", () => {
  it("declares its module manifest", () => {
    expect(relayV2ServerModule.id).toBe("relay-v2-server");
    expect(relayV2ServerModule.requires).toContain("web-remote-relay");
  });

  it("真实入口 createRelayServer 满足 RelayV2ServerContract（编译期钉点 + 运行时形状）", () => {
    expect(typeof impl.start).toBe("function");
  });

  it("start → stop 生命周期往返（装配示例走通契约面）", async () => {
    const calls: string[] = [];
    const contract: RelayV2ServerContract = {
      start: async () => {
        calls.push("start");
        // 句柄公开面含 port 与 backupDevices（唯一出处 src/index.ts，contract.ts re-export）：
        // 桩按真实形状返回；缺 backupDevices 曾与真实句柄漂移（评审 contract-typecheck 已纠正）
        return {
          port: 0,
          backupDevices: () => {
            calls.push("backupDevices");
          },
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
