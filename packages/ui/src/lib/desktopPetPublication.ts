import {
  DESKTOP_PET_CONTRACT,
  DESKTOP_PET_ACTIVITY_PRIORITY as priority,
  desktopPetTargetKey,
  type DesktopPetPresentation,
  type DesktopPetActivity,
  type IPlatformService,
} from "@drora/shared";

const windows = new WeakMap<IPlatformService, Map<symbol, DesktopPetPresentation>>();

export function mergeDesktopPetPresentations(
  sources: readonly DesktopPetPresentation[],
): DesktopPetPresentation {
  const rows = new Map<string, DesktopPetActivity>();
  for (const source of sources)
    for (const row of source.activities ?? []) {
      const key = desktopPetTargetKey(row.target);
      if ((rows.get(key)?.revision ?? -1) <= row.revision) rows.set(key, row);
    }
  const activities = [...rows.values()].sort(
    (a, b) => priority[a.mode] - priority[b.mode] || b.revision - a.revision,
  );
  const first = activities[0];
  return {
    mode: first?.mode ?? "idle",
    target: first?.target,
    preview: first?.preview,
    activeCount: Math.min(activities.filter((row) => row.mode === "working").length, 999),
    attentionCount: Math.min(activities.filter((row) => row.mode === "attention").length, 999),
    activities: activities.slice(0, DESKTOP_PET_CONTRACT.maxActivities),
  };
}

/** A lease withdraws only its workspace's derived view; runtime facts stay in sessions-index. */
export function leaseDesktopPetPublication(platform: IPlatformService) {
  let entries = windows.get(platform);
  if (!entries) {
    entries = new Map();
    windows.set(platform, entries);
  }
  const window = entries;
  const lease = Symbol();
  let released = false;
  const publish = () =>
    platform.publishDesktopPet?.(mergeDesktopPetPresentations([...window.values()]));
  return {
    update(value: DesktopPetPresentation) {
      if (!released) {
        window.set(lease, value);
        publish();
      }
    },
    release() {
      if (released) return;
      released = true;
      window.delete(lease);
      publish();
    },
  };
}
