export interface PetPointer {
  pointerId: number;
  x: number;
  y: number;
}
export interface PetGesture {
  pointerId: number;
  origin: { x: number; y: number };
  last: { x: number; y: number };
  moved: boolean;
  direction: "running-left" | "running-right" | null;
}

export function beginPetGesture(
  event: PetPointer & { button: number; ctrlKey: boolean },
): PetGesture | null {
  if (event.button !== 0 || event.ctrlKey) return null;
  return { pointerId: event.pointerId, origin: event, last: event, moved: false, direction: null };
}

export function advancePetGesture(state: PetGesture, event: PetPointer): PetGesture {
  if (state.pointerId !== event.pointerId) return state;
  const dx = event.x - state.last.x;
  const dy = event.y - state.last.y;
  const intent = Math.abs(dx) >= 4 || Math.abs(dy) >= 4;
  const moved =
    state.moved ||
    Math.abs(event.x - state.origin.x) >= 4 ||
    Math.abs(event.y - state.origin.y) >= 4;
  return {
    ...state,
    moved,
    last: intent ? event : state.last,
    direction: dx >= 4 ? "running-right" : dx <= -4 ? "running-left" : state.direction,
  };
}

export function finishPetGesture(state: PetGesture, event: PetPointer, cancelled: boolean) {
  const next = advancePetGesture(state, event);
  return { ...next, activate: !cancelled && event.pointerId === state.pointerId && !next.moved };
}
