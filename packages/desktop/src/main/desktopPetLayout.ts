export const PET_WIDTH = 112;
export const PET_HEIGHT = 128;
/** 气泡窗口宽度 = 气泡视觉的最大宽度；实际气泡随内容收缩（CSS fit-content 居中）。 */
export const BUBBLE_WIDTH = 260;
export const BUBBLE_HEIGHT = 140;
const BUBBLE_GAP = 6;

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
  size: { width: number; height: number } = { width: PET_WIDTH, height: PET_HEIGHT },
): Point {
  const area = saved
    ? (workAreas.find(
        (workArea) =>
          saved.x < workArea.x + workArea.width &&
          saved.x + size.width > workArea.x &&
          saved.y < workArea.y + workArea.height &&
          saved.y + size.height > workArea.y,
      ) ?? primary)
    : primary;
  return {
    x: clamp(
      saved?.x ?? area.x + area.width - size.width - 28,
      area.x,
      area.x + area.width - size.width,
    ),
    y: clamp(
      saved?.y ?? area.y + area.height - size.height - 28,
      area.y,
      area.y + area.height - size.height,
    ),
  };
}

export function draggedPetPosition(origin: Point, start: Point, current: Point): Point {
  return {
    x: origin.x + current.x - start.x,
    y: origin.y + current.y - start.y,
  };
}

/**
 * 气泡悬浮在宠物顶部、水平居中（气泡窗口 = 气泡最大边界，视觉随内容收缩）。
 * 越界时整体收进工作区：左右钳到 display 边缘，顶部钳到工作区上沿（极近任务栏
 * 或屏幕顶时允许压住宠物头部，避免把气泡推出屏幕外）。
 */
export function bubblePositionForPet(
  pet: Point,
  area: Rectangle,
  petWidth: number = PET_WIDTH,
): Point {
  const x = clamp(
    pet.x + petWidth / 2 - BUBBLE_WIDTH / 2,
    area.x,
    area.x + area.width - BUBBLE_WIDTH,
  );
  const y = clamp(pet.y - BUBBLE_HEIGHT - BUBBLE_GAP, area.y, area.y + area.height - BUBBLE_HEIGHT);
  return { x, y };
}
