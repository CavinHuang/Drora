// 还原自发行 bundle（官方 0.6.5 win32 entry :21534-21566，
// src/broker/server/windowsDeliveryReceipt.ts）：win32 后台/前台投递的轨迹封套。
// appendAttempt 记录单次尝试（path + dispatch_status + reason）；finalizeDelivery
// 依据 attempts 收敛最终 path（最后一个 sent/possibly_sent 的 path）与 escalated
// （前台升级成功且此前后台尝试全部 not_sent 才算升级；否则视为并存/降级）。
// 供 dispatchWindowsClick / postMessageLevel / 后台投递族（keyed/scroll/drag/
// insertion）与 element_set_value 读回封套共用。mac 无对应原生 ABI 时消费链
// 走官方同款降级，本模块不探测平台。
export interface DeliveryAttempt {
  path: string;
  dispatch_status: "sent" | "possibly_sent" | "not_sent";
  reason?: string;
}

export interface DeliveryReadback {
  verify: string;
  focus_unchanged?: boolean;
  idempotent?: boolean;
  axEchoDemoted?: boolean;
}

export interface DeliveryReceipt {
  path: string;
  effect: string;
  attempts: DeliveryAttempt[];
  escalated: boolean;
  readback?: DeliveryReadback;
}

export function appendAttempt(delivery: DeliveryReceipt | null, attempt: DeliveryAttempt): DeliveryReceipt {
  if (!delivery) {
    return {
      path: attempt.path,
      effect: "unverifiable",
      attempts: [attempt],
      escalated: false,
    };
  }
  delivery.attempts.push(attempt);
  return delivery;
}

export function finalizeDelivery(delivery: DeliveryReceipt | null): DeliveryReceipt | null {
  if (!delivery) return null;
  const sentAttempts = delivery.attempts.filter(
    (a) => a.dispatch_status === "sent" || a.dispatch_status === "possibly_sent",
  );
  const last = sentAttempts[sentAttempts.length - 1];
  if (last) delivery.path = last.path;
  const foregroundAttempt = delivery.attempts.find(
    (a) =>
      a.path === "foreground_send_input" &&
      (a.dispatch_status === "sent" || a.dispatch_status === "possibly_sent"),
  );
  if (!foregroundAttempt) {
    delivery.escalated = false;
    return delivery;
  }
  const predecessorIndex = delivery.attempts.indexOf(foregroundAttempt);
  const backgroundPredecessors = delivery.attempts
    .slice(0, predecessorIndex)
    .filter((a) => a.path !== "foreground_send_input");
  const predecessorsAllNotSent =
    backgroundPredecessors.length > 0 &&
    backgroundPredecessors.every((a) => a.dispatch_status === "not_sent");
  delivery.escalated = predecessorsAllNotSent && foregroundAttempt.dispatch_status === "sent";
  return delivery;
}
