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

function overlapArea(point: Point, size: { width: number; height: number }, area: Rectangle) {
  return (
    Math.max(0, Math.min(point.x + size.width, area.x + area.width) - Math.max(point.x, area.x)) *
    Math.max(0, Math.min(point.y + size.height, area.y + area.height) - Math.max(point.y, area.y))
  );
}

export function visiblePetPosition(
  saved: Point | undefined,
  workAreas: readonly Rectangle[],
  primary: Rectangle,
  size: { width: number; height: number },
): Point {
  let area = primary;
  let bestOverlap = saved ? overlapArea(saved, size, primary) : 0;
  if (saved) {
    // 跨屏时不能取枚举中的第一个相交屏，否则宠物主体已在另一屏仍会被拉回旧屏。
    // 与 Electron getDisplayMatching 一致比较交叠面积；screen 坐标已是 DIP，不再按缩放倍率换算。
    for (const workArea of workAreas) {
      const overlap = overlapArea(saved, size, workArea);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        area = workArea;
      }
    }
  }
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
