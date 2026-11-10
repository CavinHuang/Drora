// 还原自发行 bundle（官方 0.6.5 win32 entry :20006-20138，
// src/lib/windows-operation-association.ts）：win32 菜单操作关联（operation
// association）的证明结构与校验机械。
// - parseWindowsMenuAssociation：外部传入的 proof 逐字段形状校验（relation=
//   operation_association、root/host/candidate 身份五元组、dispatch_path 三值、
//   visible_windows/chain_window_ids、会话键、expected_menu∈{context_menu,expand}、
//   visibility_transition∈{created,hidden_to_visible}），不合法返回 null。
// - associateWindowsMenu：投递前后场景对比，产出新 proof 或结构化拒绝码
//   （dispatch_unproven/host_changed/competing_input/previous_chain_unproven/
//   previous_target_unproven/input_context_unknown/candidate_not_unique/
//   host_scope_mismatch/menu_content_unproven）。
// - revalidateWindowsMenuFacts/revalidateWindowsMenuAssociation：既有 proof 对当前
//   场景的二次校验（菜单域防偷换）。
// - advanceWindowsMenuAssociation：链上一次动作后推进 mutation_sequence。
// 消费方：windows-operation-request.ts（instrument 守卫与 evidence 采集）、
// windows-menu-observation.ts（快照域观察）、app-frame-surfaces.ts（surface 集里
// 的 operation_association 记录）。

export function parseWindowsMenuAssociation(value) {
  if (!value || typeof value !== "object") return null;
  const proof = value;
  const identity = (item) =>
    !!item &&
    [item.window_id, item.pid, item.tid, item.window_generation, item.root_window_id].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) &&
    Number.isSafeInteger(item.owner_window_id) &&
    item.owner_window_id >= 0 &&
    typeof item.bundle_id === "string" &&
    item.bundle_id.length > 0 &&
    typeof item.process_start_time === "string" &&
    /^\d+$/.test(item.process_start_time) &&
    typeof item.visible === "boolean" &&
    Array.isArray(item.bounds) &&
    item.bounds.length === 4 &&
    item.bounds.every(Number.isFinite);
  if (
    proof.relation !== "operation_association" ||
    !identity(proof.root) ||
    !identity(proof.host) ||
    !identity(proof.candidate) ||
    !validTarget(proof.target) ||
    !["ax", "post_message", "foreground_send_input"].includes(proof.dispatch_path) ||
    !Array.isArray(proof.visible_windows) ||
    !proof.visible_windows.every(
      (item) =>
        Number.isSafeInteger(item.window_id) &&
        item.window_id > 0 &&
        Number.isSafeInteger(item.window_generation) &&
        item.window_generation > 0,
    ) ||
    !Array.isArray(proof.chain_window_ids) ||
    !proof.chain_window_ids.every((id) => Number.isSafeInteger(id) && id > 0) ||
    ![proof.session_id, proof.call_id, proof.method, proof.producer_id, proof.content_fingerprint].every(
      (s) => typeof s === "string" && s.length > 0,
    ) ||
    ![proof.session_generation, proof.mutation_sequence, proof.external_input_sequence].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    !["context_menu", "expand"].includes(proof.expected_menu) ||
    !["created", "hidden_to_visible"].includes(proof.visibility_transition)
  )
    return null;
  return structuredClone(proof);
}

function validTarget(target) {
  return (
    !!target &&
    ((typeof target.native === "string" && target.native.length > 0) ||
      (!!target.point && Number.isFinite(target.point.x) && Number.isFinite(target.point.y)) ||
      (typeof target.key === "string" &&
        target.key.length > 0 &&
        Number.isSafeInteger(target.window_id) &&
        target.window_id > 0))
  );
}

function sameIdentity(a, b) {
  return (
    a.window_id === b.window_id &&
    a.pid === b.pid &&
    a.tid === b.tid &&
    a.bundle_id.toLowerCase() === b.bundle_id.toLowerCase() &&
    a.process_start_time === b.process_start_time &&
    a.window_generation === b.window_generation &&
    a.root_window_id === b.root_window_id &&
    a.owner_window_id === b.owner_window_id
  );
}

function contentFingerprint(content) {
  const items = content.items.filter(
    (item) => /MenuItem/i.test(item.role) && item.title.trim() && item.actions.some((action) => /Press|Invoke|Expand|ShowMenu/i.test(action)),
  );
  if (items.length === 0) return null;
  return JSON.stringify([
    content.role,
    items.map((item) => [item.role, item.title.trim(), [...item.actions].sort()]),
  ]);
}

function coherentInput(scene, candidates = []) {
  const values = [...Object.values(scene.input), ...Object.values(scene.root_input ?? {})].filter(
    (id) => id !== 0,
  );
  const allowed = new Set([scene.root.window_id, scene.host.root_window_id, scene.host.window_id, ...candidates]);
  return values.length > 0 && values.every((id) => allowed.has(id) || allowed.has(scene.input_roots[String(id)]));
}

function usableScene(scene) {
  return (
    scene.monitor_ready &&
    !!scene.producer_id &&
    scene.root.visible &&
    scene.host.visible &&
    scene.host.root_window_id === scene.root.window_id &&
    [scene.root, scene.host].every(
      (item) =>
        item.pid > 0 &&
        item.tid > 0 &&
        item.window_generation > 0 &&
        /^\d+$/.test(item.process_start_time),
    )
  );
}

export function associateWindowsMenu(evidence, contents) {
  const { before, after } = evidence;
  const reject = (reason) => ({ association: null, reason });
  if (
    !evidence.session_id ||
    !evidence.call_id ||
    !evidence.method ||
    !evidence.expected_menu ||
    evidence.dispatch_status !== "sent" ||
    !validTarget(evidence.target)
  )
    return reject("dispatch_unproven");
  if (
    !usableScene(before) ||
    !usableScene(after) ||
    before.producer_id !== after.producer_id ||
    !sameIdentity(before.root, after.root) ||
    !sameIdentity(before.host, after.host)
  )
    return reject("host_changed");
  if (
    after.mutation_sequence !== before.mutation_sequence + 1 ||
    after.external_input_sequence !== before.external_input_sequence
  )
    return reject("competing_input");
  const previous = evidence.previous_chain ?? [];
  if (
    previous.some(({ association, content: content2 }) =>
      !revalidateWindowsMenuAssociation(association, before, content2, evidence.session_id),
    )
  )
    return reject("previous_chain_unproven");
  const chain = previous.map((item) => item.association.candidate.window_id);
  if (previous.length && !chain.includes(evidence.target.window_id ?? 0))
    return reject("previous_target_unproven");
  if (!coherentInput(before, chain)) return reject("input_context_unknown");
  const appeared = after.windows.filter(
    (item) => item.visible && !item.decorative && !before.windows.some((old) => old.window_id === item.window_id && old.visible),
  );
  if (appeared.length !== 1) return reject("candidate_not_unique");
  const candidate = appeared[0];
  if (
    candidate.pid !== after.host.pid ||
    candidate.tid !== after.host.tid ||
    candidate.process_start_time !== after.host.process_start_time ||
    candidate.bundle_id.toLowerCase() !== after.host.bundle_id.toLowerCase()
  )
    return reject("host_scope_mismatch");
  if (!coherentInput(after, [...chain, candidate.window_id])) return reject("input_context_unknown");
  const content = contents.find((item) => item.window_id === candidate.window_id);
  const fingerprint2 = content && contentFingerprint(content);
  if (!fingerprint2) return reject("menu_content_unproven");
  return {
    association: {
      relation: "operation_association",
      session_id: evidence.session_id,
      session_generation: evidence.session_generation,
      call_id: evidence.call_id,
      method: evidence.method,
      target: evidence.target,
      dispatch_path: evidence.dispatch_path,
      visible_windows: after.windows
        .filter((window) => window.visible && !window.decorative)
        .map(({ window_id, window_generation }) => ({ window_id, window_generation })),
      chain_window_ids: [...chain, candidate.window_id],
      expected_menu: evidence.expected_menu,
      producer_id: after.producer_id,
      mutation_sequence: after.mutation_sequence,
      external_input_sequence: after.external_input_sequence,
      root: after.root,
      host: after.host,
      candidate,
      visibility_transition: before.windows.some((old) => old.window_id === candidate.window_id && !old.visible)
        ? "hidden_to_visible"
        : "created",
      content_fingerprint: fingerprint2,
    },
    reason: "associated",
  };
}

export function revalidateWindowsMenuFacts(proof, current, sessionId) {
  const candidate = current.windows.find((item) => item.window_id === proof.candidate.window_id);
  return (
    sessionId === proof.session_id &&
    usableScene(current) &&
    current.producer_id === proof.producer_id &&
    current.mutation_sequence === proof.mutation_sequence &&
    current.external_input_sequence === proof.external_input_sequence &&
    sameIdentity(proof.root, current.root) &&
    sameIdentity(proof.host, current.host) &&
    !!candidate?.visible &&
    sameIdentity(proof.candidate, candidate) &&
    coherentInput(current, proof.chain_window_ids) &&
    current.windows
      .filter((window) => window.visible && !window.decorative)
      .every((window) =>
        proof.visible_windows.some(
          (old) => old.window_id === window.window_id && old.window_generation === window.window_generation,
        ),
      )
  );
}

export function revalidateWindowsMenuAssociation(proof, current, content, sessionId) {
  return (
    revalidateWindowsMenuFacts(proof, current, sessionId) &&
    content.window_id === proof.candidate.window_id &&
    contentFingerprint(content) === proof.content_fingerprint
  );
}

export function advanceWindowsMenuAssociation(proof, before, after, content, callId) {
  if (!revalidateWindowsMenuAssociation(proof, before, content, proof.session_id)) return null;
  if (
    after.mutation_sequence !== before.mutation_sequence + 1 ||
    after.external_input_sequence !== before.external_input_sequence
  )
    return null;
  const advanced = {
    ...proof,
    mutation_sequence: after.mutation_sequence,
    last_action_call_id: callId,
  };
  return revalidateWindowsMenuAssociation(advanced, after, content, proof.session_id) ? advanced : null;
}
