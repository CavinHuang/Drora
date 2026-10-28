// 消息级 trace 红线的运行时验证（specs/relay-v2-server.md §9 红线 +
// docs/web-remote-control-relay-message-logging.md 的仓库既有裁决；评审 msgtrace-runtime-test）。
// 类型面（RelayMessageTraceFields）只能证明「入参形状受限」，这里打真实 loopback 补运行时
// 证据：msgTrace=true 下双端交换含大 payload 的 data，逐行断言 trace 输出的字段集 ⊆
// 允许摘要集且任何日志行不含 payload 正文子串；msgTrace=false 时零 trace 行。

import { afterEach, describe, expect, it } from "vitest";
import { createRelayLogger } from "../src/logger.js";
import type { RelayLogger } from "../src/logger.js";
import {
  authAndAck,
  closeStartedRelays,
  messages,
  registerDevice,
  startRelay,
  type RelayClient,
  type StartedRelay,
} from "./helpers.js";

afterEach(closeStartedRelays);

// trace 输出行的允许键全集 = 信封固定字段（ts/level/msg/scope，logger.ts emit/traceMessage）+
// RelayMessageTraceFields 允许摘要集（type / pair_status / role / code / drora_type /
// requestId / bridgeSessionId / bytes）。红线：字段集之外（尤其 payload 正文）永不出现。
const ALLOWED_TRACE_LINE_KEYS: ReadonlySet<string> = new Set([
  "ts",
  "level",
  "msg",
  "scope",
  "type",
  "pair_status",
  "role",
  "code",
  "drora_type",
  "requestId",
  "bridgeSessionId",
  "bytes",
]);

/** payload 正文探测标记：出现在任何日志行即红线破防 */
const LEAK_MARKER = "TRACE-LEAK-PROBE-9f8e7d6c";
/** 大 payload（约 1/4 MiB）：trace 若误吞正文，任何摘要字段都装不下它 */
const BIG_DOWNLINK = `${"x".repeat(200_000)}${LEAK_MARKER}${"y".repeat(50_000)}`;
const BIG_UPLINK = `${"u".repeat(50_000)}${LEAK_MARKER}${"v".repeat(200_000)}`;

/** 捕获输出行的日志（不落盘）；trace 总开关由用例控制，error 级静默生命周期行 */
function capturingLogger(trace: boolean): { logger: RelayLogger; lines: string[] } {
  const lines: string[] = [];
  const logger = createRelayLogger({
    level: "error",
    trace,
    scope: "relay-v2",
    write: (line) => lines.push(line),
  });
  return { logger, lines };
}

/** 双端配对并双向交换大 payload data，等两侧都收到后再断言（消除到达时序） */
async function pairAndExchangeBigData(relay: StartedRelay): Promise<[RelayClient, RelayClient]> {
  const { sid } = await registerDevice(relay, "machine");
  const device = await authAndAck(relay, sid, "device");
  const terminal = await authAndAck(relay, sid, "terminal");
  await expect
    .poll(() => messages(device).some((message) => message.type === "pair_status_ack"), {
      timeout: 2_000,
    })
    .toBe(true);
  terminal.send({ type: "data", payload: BIG_DOWNLINK });
  await expect
    .poll(
      () =>
        messages(device).some(
          (message) => message.type === "data" && message.payload === BIG_DOWNLINK,
        ),
      { timeout: 2_000 },
    )
    .toBe(true);
  device.send({ type: "data", payload: BIG_UPLINK });
  await expect
    .poll(
      () =>
        messages(terminal).some(
          (message) => message.type === "data" && message.payload === BIG_UPLINK,
        ),
      { timeout: 2_000 },
    )
    .toBe(true);
  return [device, terminal];
}

describe("消息级 trace 红线（spec §9；MSG_TRACE）", () => {
  it("msgTrace=true：trace 行字段集 ⊆ 允许摘要集，任何日志行不含 payload 正文子串", async () => {
    const { logger, lines } = capturingLogger(true);
    const relay = await startRelay({ logger, msgTrace: true });
    await pairAndExchangeBigData(relay);

    const traceLines = lines.filter((line) => line.includes("relay-message-trace"));
    // 追踪路径确实被走到：auth/push/data 全链每条消息都有 trace 行
    expect(traceLines.length).toBeGreaterThan(0);
    for (const line of traceLines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.msg).toBe("relay-message-trace");
      const keys = Object.keys(parsed);
      expect(
        keys.filter((key) => !ALLOWED_TRACE_LINE_KEYS.has(key)),
        `trace 行出现允许集之外的字段：${line}`,
      ).toEqual([]);
    }
    // 红线主体：全部日志行（trace + 生命周期）都不得出现 payload 正文子串
    expect(lines.filter((line) => line.includes(LEAK_MARKER))).toEqual([]);
  });

  it("msgTrace=false：双端交换大 payload 后零 trace 行，正文同样不落任何日志", async () => {
    const { logger, lines } = capturingLogger(false);
    const relay = await startRelay({ logger, msgTrace: false });
    await pairAndExchangeBigData(relay);

    expect(lines.filter((line) => line.includes("relay-message-trace"))).toEqual([]);
    expect(lines.filter((line) => line.includes(LEAK_MARKER))).toEqual([]);
  });
});
