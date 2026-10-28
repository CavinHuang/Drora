import { useCallback } from "react";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";

/**
 * composerTextInsertRequest 的应用结果监听（§9.9.2-H4 多槽形态，2026-10-26）。
 *
 * 判定以**槽态**为准（不再比较全局 composerTextInsertVersion）——requestId 全局唯一
 * 且逐槽写入，任何**其他槽**的新请求 bump 全局 version 都不代表本请求被取代：
 * - ① 槽内 requestId === 本 id → pending 继续等；
 * - ② 本 id 已不在槽且该槽为空 → applied（消费 clear 与任何后续写入是两个独立 set，
 *   Zustand 订阅同步触发，本监听在 clear set 上即 settle，不会观察到「清除后新写入」
 *   复合态；promise 创建与首跑 inspect 之间的同步间隙内不可能完成消费+新写入——
 *   消费依赖 effect/re-render 异步任务）；
 * - ③ 槽内是更晚 requestId（同槽 replace 替换或 append 合并）→ superseded。
 *
 * 旧谓词「superseded = version > requestId」在多槽下会把跨槽 bump 交错（如语音 final
 * 注入他会话槽）误判为 superseded，令插件推荐流 finishMutation 误弹 Failed popover
 * —— 全局 version 仅作 requestId 发号来源，不参与判定。
 *
 * @param slotKey 发送方写入的槽键（`targetSessionId ?? ""`，与 requestComposerTextInsert
 *   的 targetSessionId 缺省语义同构；草稿 composer 生产方传 ""）。
 */
export function useComposerTextInsertApplied(workspacePath: string, workspaceIdentity?: string) {
  return useCallback(
    (requestId: number, slotKey: string, signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        let unsubscribe: () => void = () => undefined;
        let settled = false;
        const finish = (applied: boolean) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          signal.removeEventListener("abort", handleAbort);
          resolve(applied);
        };
        const handleAbort = () => {
          finish(false);
          // 扫槽清除本 id（requestId 全局唯一，无歧义；abort 语义不变）。
          useDroraSessionStore
            .getState()
            .clearComposerTextInsertRequest(workspacePath, requestId, workspaceIdentity);
        };
        const inspect = () => {
          const state = useDroraSessionStore
            .getState()
            .getWorkspaceState(workspacePath, workspaceIdentity);
          const slotRequest = state.composerTextInsertRequests[slotKey];
          if (slotRequest != null) {
            if (slotRequest.requestId === requestId) {
              return; // ① pending：本请求仍在槽内。
            }
            finish(false); // ③ 同槽更晚请求（replace 替换 / append 合并）→ superseded。
            return;
          }
          finish(true); // ② 本 id 已不在槽且槽空 → applied。
        };
        if (signal.aborted) {
          resolve(false);
          return;
        }
        unsubscribe = useDroraSessionStore.subscribe(inspect);
        signal.addEventListener("abort", handleAbort, { once: true });
        inspect();
      }),
    [workspaceIdentity, workspacePath],
  );
}
