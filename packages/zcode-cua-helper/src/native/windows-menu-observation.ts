// 还原自发行 bundle（官方 0.6.5 win32 entry :29845-29912，
// src/native/windows-menu-observation.ts）：快照域菜单观察。capture_app 组装
// frame surface 报告时调用：①重验 context.associations 里已证明的链（root 匹配
// 才保留）；②context.pending（host 传入的上次未决 evidence）与当前场景比对，
// mutation 序列未动且候选窗仍在 → associateWindowsMenu 补关联（previous_chain
// 同步推进 mutation_sequence/visible_windows/chain_window_ids）；③把 proof 候选窗
// 升为 menu_popup/operation_association surface（从 independent_candidates 移除）。
// 返回仍在 surface 报告里的 proof（relation=operation_association）。
// windowsOperationScene ABI 缺失（mac 官方形态）时直接返回 []，快照无关联域。
import {
  readWindowsOperationScene,
  readWindowsMenuContent,
  verifyWindowsOperationChain,
} from "./windows-operation-request.js";
import { associateWindowsMenu } from "../lib/windows-operation-association.js";

export function observeWindowsOperationMenus(native, report, rootId, context) {
  if (!context || !native.windowsOperationScene) return [];
  const proofs = [];
  for (const proof of context.associations ?? []) {
    if (proof.root.window_id !== rootId) continue;
    if (verifyWindowsOperationChain(native, [proof], context.session_id)) proofs.push(proof);
  }
  const pending = context.pending;
  if (
    pending?.session_id === context.session_id &&
    pending.session_generation === context.session_generation &&
    pending.before.root.window_id === rootId
  ) {
    const current = readWindowsOperationScene(native, rootId, pending.before.host.window_id);
    if (
      current &&
      current.mutation_sequence === pending.after.mutation_sequence &&
      current.external_input_sequence === pending.after.external_input_sequence &&
      pending.after.windows
        .filter((window) => window.visible && !pending.before.windows.some((old) => old.window_id === window.window_id && old.visible))
        .every((window) =>
          current.windows.some(
            (live) =>
              live.window_id === window.window_id &&
              live.visible &&
              live.window_generation === window.window_generation &&
              live.owner_window_id === window.owner_window_id,
          ),
        )
    ) {
      const contents = current.windows
        .filter(
          (window) =>
            window.visible &&
            !window.decorative &&
            !report.surfaces.some((surface) => surface.window_id === window.window_id),
        )
        .map((window) => readWindowsMenuContent(native, window.pid, window.window_id))
        .filter((item) => !!item);
      const result = associateWindowsMenu({ ...pending, after: current }, contents);
      if (
        result.association &&
        !report.surfaces.some((surface) => surface.window_id === result.association.candidate.window_id)
      ) {
        const linked = result.association;
        for (const previous of pending.previous_chain ?? [])
          proofs.push({
            ...previous.association,
            mutation_sequence: linked.mutation_sequence,
            visible_windows: linked.visible_windows,
            chain_window_ids: linked.chain_window_ids,
            last_action_call_id: linked.call_id,
          });
        proofs.push(linked);
      }
    }
  }
  for (const proof of proofs) {
    if (report.surfaces.some((surface) => surface.window_id === proof.candidate.window_id)) continue;
    const candidate = report.independent_candidates.find((item) => item.window_id === proof.candidate.window_id);
    if (!candidate) continue;
    report.surfaces.push({
      window_id: candidate.window_id,
      pid: proof.candidate.pid,
      tid: proof.candidate.tid,
      class_name: candidate.class_name,
      title: candidate.title,
      bounds: candidate.bounds,
      layer: candidate.layer,
      surface_kind: "menu_popup",
      relation: "operation_association",
    });
    report.independent_candidates = report.independent_candidates.filter(
      (item) => item.window_id !== candidate.window_id,
    );
  }
  return proofs.filter((proof) =>
    report.surfaces.some(
      (surface) => surface.window_id === proof.candidate.window_id && surface.relation === "operation_association",
    ),
  );
}
