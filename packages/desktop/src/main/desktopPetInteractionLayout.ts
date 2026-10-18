import type { Point, Rectangle } from "./desktopPetLayout.js";

/** Codex Alt-drag uses six anchors, rather than nearest-corner-only snapping. */
export function snapPetPosition(
  pointer: Point,
  area: Rectangle,
  size: { width: number; height: number },
): Point {
  const fraction = (pointer.x - area.x) / area.width;
  const center =
    fraction < 1 / 3
      ? area.x + 16 + size.width / 2
      : fraction >= 2 / 3
        ? area.x + area.width - 16 - size.width / 2
        : area.x + area.width / 2;
  return {
    x: Math.round(center - size.width / 2),
    y: pointer.y < area.y + area.height / 2 ? area.y + 16 : area.y + area.height - 16 - size.height,
  };
}

export function trayBoundsForPet(pet: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(330, area.width);
  const height = Math.min(400, area.height);
  const above = pet.y - area.y;
  const below = area.y + area.height - pet.y - pet.height;
  const y = above >= height + 8 || above > below ? pet.y - height - 8 : pet.y + pet.height + 8;
  return {
    x: Math.round(
      Math.max(area.x, Math.min(pet.x + pet.width / 2 - width / 2, area.x + area.width - width)),
    ),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    width,
    height,
  };
}
