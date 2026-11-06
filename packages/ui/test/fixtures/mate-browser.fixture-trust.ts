/**
 * P4 修复轮信任门投影夹具状态件（mate-browser.fixture-service 拆出——单文件 ≤800 行
 * 纪律，先例：mate-browser.fixture-inventory.ts）。mate-trust-auto.test.mjs 消费。
 *
 * 真实统计/复核在 host 侧 trustGate 与 setMode 判定（assistantP4Host.test.ts 锁定）
 * ——夹具只造「达标投影」与一次性复核失败开关，不伪造判定：
 * - gateOpenProjection：开关打开时快照 trust 携带 gateOpen/rate/samples/阈值（取达标
 *   线等值 releaseRate=0.8 样本 15——UI 入口渲染的验收投影）；
 * - consumeAutoLockedRejection：下一次 setMode("auto") 模拟服务侧复核失败
 *   mate.auto.locked（确认框到 setMode 之间信任回落），一次性消费。
 */
import { ASSISTANT_ERROR_CODES, ASSISTANT_MODES } from "@drora/shared";
import type { AssistantErrorCode, AssistantMode } from "@drora/shared";

/** setMode("auto") 复核失败的拒绝形状（mate.auto.locked 同码——contracts ASSISTANT_ERROR_CODES.autoLocked）。 */
export interface FixtureAutoLockedRejection {
  ok: false;
  error: { code: AssistantErrorCode; reason: string };
}

export function createTrustGateFixture(publish: () => void): {
  /** 快照 trust 的达标投影（开关关闭=null=不携带，旧 Host 缺席语义保持可验）。 */
  gateOpenProjection(): {
    releaseRate: number;
    sampleCount: number;
    gateOpen: boolean;
    gateThresholds: { minRate: number; minSamples: number };
  } | null;
  /** setMode("auto") 的一次性复核失败拒绝（非 auto 调用或开关未挂=返回 null）。 */
  consumeAutoLockedRejection(next: AssistantMode): FixtureAutoLockedRejection | null;
  /** 信任门达标投影开关（既有场景不点不触发）。 */
  setTrustGateOpen(open: boolean): void;
  /** 挂下一次 setMode("auto") 的复核失败（一次性消费）。 */
  setAutoLockedNext(): void;
} {
  let trustGateOpen = false;
  let autoLockedNext = false;
  return {
    gateOpenProjection() {
      if (!trustGateOpen) return null;
      return {
        releaseRate: 0.8,
        sampleCount: 15,
        gateOpen: true,
        gateThresholds: { minRate: 0.8, minSamples: 15 },
      };
    },
    consumeAutoLockedRejection(next) {
      if (next !== ASSISTANT_MODES.auto || !autoLockedNext) return null;
      autoLockedNext = false;
      return {
        ok: false,
        error: {
          code: ASSISTANT_ERROR_CODES.autoLocked,
          reason: "信任门复核未达标（fixture 模拟）",
        },
      };
    },
    setTrustGateOpen(open) {
      trustGateOpen = open;
      publish();
    },
    setAutoLockedNext() {
      autoLockedNext = true;
    },
  };
}
