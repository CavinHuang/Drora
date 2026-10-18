import type { DesktopPetAnimationTrack, DesktopPetSpriteFrame } from "@drora/shared";

/** Values verified against the installed Codex 26.1013.31256 bundle; see evidence spec. */
export function codexPetTracks(): DesktopPetAnimationTrack[] {
  const idle = [280, 110, 110, 140, 140, 320].map((durationMs, column) => ({
    row: 0,
    column,
    durationMs: durationMs * 6,
  }));
  const definitions = [
    ["running-right", 1, 8, 120, 220],
    ["running-left", 2, 8, 120, 220],
    ["waving", 3, 4, 140, 280],
    ["jumping", 4, 5, 140, 280],
    ["failed", 5, 8, 140, 240],
    ["waiting", 6, 6, 150, 260],
    ["running", 7, 6, 120, 220],
    ["review", 8, 6, 150, 280],
  ] as const;
  return [
    { state: "idle", frames: idle, loopStart: 0 },
    ...definitions.map(([state, row, count, hold, last]): DesktopPetAnimationTrack => {
      const frames = Array.from({ length: count }, (_, column) => ({
        row,
        column,
        durationMs: column === count - 1 ? last : hold,
      }));
      return { state, frames: [...frames, ...frames, ...frames, ...idle], loopStart: count * 3 };
    }),
  ];
}

export function petLookFrame(
  bounds: { x: number; y: number; width: number; height: number },
  pointer: { x: number; y: number },
  version?: number,
): DesktopPetSpriteFrame | null {
  if (version !== 2) return null;
  const dx = pointer.x - bounds.x - bounds.width / 2;
  const dy = pointer.y - bounds.y - bounds.height / 2;
  if (Math.hypot(dx, dy) <= 1) return null;
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const direction = Math.round(angle / 22.5) % 16;
  return { row: 9 + Math.floor(direction / 8), column: direction % 8, durationMs: 0 };
}
