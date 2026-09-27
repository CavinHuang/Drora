export const PET_WIDTH = 112;
export const PET_HEIGHT = 128;
export const BUBBLE_WIDTH = 240;
export const BUBBLE_HEIGHT = 120;
const BUBBLE_GAP = 8;

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle extends Point {
  width: number;
  height: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function visiblePetPosition(
  saved: Point | undefined,
  workAreas: readonly Rectangle[],
  primary: Rectangle,
): Point {
  const area = saved
    ? (workAreas.find(
        (workArea) =>
          saved.x < workArea.x + workArea.width &&
          saved.x + PET_WIDTH > workArea.x &&
          saved.y < workArea.y + workArea.height &&
          saved.y + PET_HEIGHT > workArea.y,
      ) ?? primary)
    : primary;
  return {
    x: clamp(
      saved?.x ?? area.x + area.width - PET_WIDTH - 28,
      area.x,
      area.x + area.width - PET_WIDTH,
    ),
    y: clamp(
      saved?.y ?? area.y + area.height - PET_HEIGHT - 28,
      area.y,
      area.y + area.height - PET_HEIGHT,
    ),
  };
}

export function draggedPetPosition(origin: Point, start: Point, current: Point): Point {
  return {
    x: origin.x + current.x - start.x,
    y: origin.y + current.y - start.y,
  };
}

export function bubblePositionForPet(pet: Point, area: Rectangle): Point {
  const left = pet.x - BUBBLE_WIDTH - BUBBLE_GAP;
  const right = pet.x + PET_WIDTH + BUBBLE_GAP;
  const x = left >= area.x ? left : clamp(right, area.x, area.x + area.width - BUBBLE_WIDTH);
  return {
    x,
    y: clamp(pet.y + 18, area.y, area.y + area.height - BUBBLE_HEIGHT),
  };
}
