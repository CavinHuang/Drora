// 还原自发行 bundle（官方 0.6.5 win32 entry :23590-23664，
// src/lib/app-frame-surfaces.ts）：app frame surface 集的形状契约。
// 0.6.5 官方面相对早期还原稿扩展了 surface 域：kind 增加 owned_popup/menu_popup/
// child_window（win32 帧枚举），relation 增加 owner_chain/menu_thread_parent/
// uia_ancestor/parent_chain/operation_association（窗口世系链），surface 记录
// 可携带可选身份增强（owner_tid/window_generation/producer_id/process_start_time）
// 与 operation_association proof（经 parseWindowsMenuAssociation 逐字段校验且
// candidate 必须与 surface 本体一致）。不合法集返回 void 0（frame_provenance
// 记录随之拒绝）；缺省返回 null。
import { parseWindowsMenuAssociation } from "./windows-operation-association.js";

const SURFACE_KINDS = [
  "window",
  "attached_dialog",
  "open_panel",
  "save_panel",
  "popover",
  "owned_popup",
  "menu_popup",
  "child_window",
];
const SURFACE_RELATIONS = [
  "presentation_root",
  "ax_descendant",
  "owner_chain",
  "menu_thread_parent",
  "uia_ancestor",
  "parent_chain",
  "operation_association",
];

function asSurfaceKind(value) {
  return SURFACE_KINDS.includes(value) ? value : null;
}

function asSurfaceRelation(value) {
  return SURFACE_RELATIONS.includes(value) ? value : null;
}

function asBounds4(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) {
    return null;
  }
  return value;
}

export function parseAppFrameSurfaceSet(value) {
  if (value === void 0 || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record2 = value;
  if (
    !Number.isSafeInteger(record2.presentation_window_id) ||
    record2.presentation_window_id <= 0 ||
    typeof record2.before_fingerprint !== "string" ||
    record2.before_fingerprint.length === 0 ||
    typeof record2.after_fingerprint !== "string" ||
    record2.after_fingerprint.length === 0 ||
    record2.order !== "front_to_back" ||
    !Array.isArray(record2.surfaces) ||
    record2.surfaces.length < 1 ||
    record2.surfaces.length > 64
  ) {
    return void 0;
  }
  const surfaces = record2.surfaces.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const surface = entry;
    const kind = asSurfaceKind(surface.surface_kind);
    const relation = asSurfaceRelation(surface.relation);
    const bounds = asBounds4(surface.bounds);
    const association =
      surface.operation_association === void 0 ? void 0 : parseWindowsMenuAssociation(surface.operation_association);
    if (
      !Number.isSafeInteger(surface.actual_window_id) ||
      surface.actual_window_id <= 0 ||
      !Number.isSafeInteger(surface.presentation_window_id) ||
      surface.presentation_window_id <= 0 ||
      !kind ||
      !relation ||
      !Number.isSafeInteger(surface.owner_pid) ||
      surface.owner_pid <= 0 ||
      typeof surface.owner_bundle_id !== "string" ||
      surface.owner_bundle_id.length === 0 ||
      !Number.isSafeInteger(surface.layer) ||
      !bounds ||
      (relation === "operation_association" &&
        (!association ||
          association.candidate.window_id !== surface.actual_window_id ||
          association.candidate.pid !== surface.owner_pid)) ||
      (surface.operation_association !== void 0 && !association) ||
      (surface.owner_tid !== void 0 && (!Number.isSafeInteger(surface.owner_tid) || Number(surface.owner_tid) <= 0)) ||
      (surface.window_generation !== void 0 &&
        (!Number.isSafeInteger(surface.window_generation) || Number(surface.window_generation) <= 0)) ||
      (surface.producer_id !== void 0 && (typeof surface.producer_id !== "string" || !surface.producer_id)) ||
      (surface.process_start_time !== void 0 &&
        (typeof surface.process_start_time !== "string" || !/^\d+$/u.test(surface.process_start_time)))
    ) {
      return null;
    }
    return {
      actual_window_id: surface.actual_window_id,
      ...(association ? { operation_association: association } : {}),
      ...(surface.owner_tid !== void 0 ? { owner_tid: surface.owner_tid } : {}),
      ...(surface.window_generation !== void 0 ? { window_generation: surface.window_generation } : {}),
      ...(surface.producer_id !== void 0 ? { producer_id: surface.producer_id } : {}),
      ...(surface.process_start_time !== void 0 ? { process_start_time: surface.process_start_time } : {}),
      presentation_window_id: surface.presentation_window_id,
      surface_kind: kind,
      relation,
      owner_pid: surface.owner_pid,
      owner_bundle_id: surface.owner_bundle_id,
      layer: surface.layer,
      bounds,
    };
  });
  if (surfaces.some((surface) => surface === null)) return void 0;
  return {
    presentation_window_id: record2.presentation_window_id,
    before_fingerprint: record2.before_fingerprint,
    after_fingerprint: record2.after_fingerprint,
    order: "front_to_back",
    surfaces,
  };
}
