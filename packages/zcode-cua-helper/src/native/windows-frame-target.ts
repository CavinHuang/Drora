// 还原自发行 bundle（官方 0.6.5 win32 entry :29815-29844，
// src/native/windows-frame-target.ts）：win32 帧目标选择。capture_app 请求
// window_id 时按 frame surface 枚举判定请求窗与 presentation 的关系——
// owned_popup 集里挑已证明的模态面板；requested 缺席时唯一面板即 actual，
// 多面板抛 ambiguous_observation_root 语义（Error("ambiguous_observation_root")
// 由调用方转 elementUnavailable）；与 presentation 无关且 exe 不同 →
// window_identity_unverified。independent 标记独立 surface（后续物理输入需
// operation association 才放行）。
const exeKey = (value) => value.replaceAll("/", "\\").toLowerCase();

export function selectWindowsFrameTarget(presentation, requested, surfaces, read) {
  const proven = surfaces
    .filter((s) => s.window_id !== presentation.window_id && s.surface_kind === "owned_popup")
    .map((s) => read(s.window_id))
    .filter(
      (c) =>
        c !== null &&
        c.visible &&
        c.enabled &&
        !c.is_menu &&
        surfaces.some((s) => s.window_id === c.window_id && s.pid === c.pid),
    );
  const panels = proven.filter(
    (c) =>
      c.is_modal ||
      (c.owner_window_id === presentation.window_id
        ? !presentation.enabled
        : read(c.owner_window_id)?.enabled === false),
  );
  if (requested !== void 0) {
    const actual = read(requested);
    if (!actual || (!actual.visible && !(actual.minimized && requested === presentation.window_id)))
      throw new Error("window_gone");
    const related =
      requested === presentation.window_id ||
      surfaces.some(
        (s) => s.window_id === requested && s.pid === actual.pid && s.surface_kind !== "child_window",
      );
    if (!related && exeKey(actual.bundle_id) !== exeKey(presentation.bundle_id))
      throw new Error("window_identity_unverified");
    return {
      actual,
      presentation: related ? presentation : actual,
      independent: !related,
      ...(requested === presentation.window_id && panels.length === 1 ? { modal_blocker: panels[0] } : {}),
      candidates: [],
    };
  }
  if (panels.length > 1)
    return { actual: null, presentation, independent: false, candidates: panels };
  return { actual: panels[0] ?? presentation, presentation, independent: false, candidates: [] };
}
