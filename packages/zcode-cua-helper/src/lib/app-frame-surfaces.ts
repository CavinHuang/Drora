function asSurfaceKind(value) {
  return value === "window" ||
    value === "attached_dialog" ||
    value === "open_panel" ||
    value === "save_panel" ||
    value === "popover"
    ? value
    : null;
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
    const bounds = surface.bounds;
    if (
      !Number.isSafeInteger(surface.actual_window_id) ||
      surface.actual_window_id <= 0 ||
      !Number.isSafeInteger(surface.presentation_window_id) ||
      surface.presentation_window_id <= 0 ||
      !kind ||
      (surface.relation !== "presentation_root" && surface.relation !== "ax_descendant") ||
      !Number.isSafeInteger(surface.owner_pid) ||
      surface.owner_pid <= 0 ||
      typeof surface.owner_bundle_id !== "string" ||
      surface.owner_bundle_id.length === 0 ||
      !Number.isSafeInteger(surface.layer) ||
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !bounds.every(Number.isFinite)
    ) {
      return null;
    }
    return {
      actual_window_id: surface.actual_window_id,
      presentation_window_id: surface.presentation_window_id,
      surface_kind: kind,
      relation: surface.relation,
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
