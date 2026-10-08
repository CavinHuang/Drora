import { desktopPetArtworkDataUrl, desktopPetMotion } from "./desktopPetArtwork.js";
import { desktopPetCatgirlCharacters } from "./desktopPetCatgirlArtwork.js";

export const DESKTOP_PET_CHARACTER_IDS = ["violet", "noir", "snow", "ginger"] as const;
export type DesktopPetCharacterId = (typeof DESKTOP_PET_CHARACTER_IDS)[number];

export interface DesktopPetCharacterSpec {
  id: DesktopPetCharacterId;
  /** 展示名（zh/en 双语由 nameEn 承担，设置页选择器直接用）。 */
  nameZh: string;
  nameEn: string;
  kind: "violet" | "catgirl";
  /** 精灵图显示格尺寸（#pet-art 的 CSS 像素）。 */
  art: { width: number; height: number };
  /** 宠物 BrowserWindow 尺寸（含拖拽把手与留白）。 */
  window: { width: number; height: number };
}

const VIOLET: DesktopPetCharacterSpec = {
  id: "violet",
  nameZh: "紫罗兰 · 小猫",
  nameEn: "Violet the cat",
  kind: "violet",
  art: { width: 96, height: 96 },
  window: { width: 112, height: 128 },
};

// 猫娘帧原始 320×640（1:2），×0.3 → 96×192 显示格；窗口高度 = 紫猫 128 + 96。
const catgirlSpecs: DesktopPetCharacterSpec[] = desktopPetCatgirlCharacters.map((character) => ({
  id: character.id as DesktopPetCharacterId,
  nameZh: character.name,
  nameEn: character.nameEn,
  kind: "catgirl" as const,
  art: { width: 96, height: 192 },
  window: { width: 112, height: 224 },
}));

export const DESKTOP_PET_CHARACTERS: DesktopPetCharacterSpec[] = [VIOLET, ...catgirlSpecs];

export function isDesktopPetCharacterId(value: unknown): value is DesktopPetCharacterId {
  return (
    typeof value === "string" &&
    (DESKTOP_PET_CHARACTER_IDS as readonly string[]).includes(value)
  );
}

export function resolveDesktopPetCharacter(id: unknown): DesktopPetCharacterSpec {
  return DESKTOP_PET_CHARACTERS.find((character) => character.id === id) ?? VIOLET;
}

export function desktopPetCharacterLabel(
  character: DesktopPetCharacterSpec,
  locale: string,
): string {
  return locale.startsWith("zh") ? character.nameZh : character.nameEn;
}

/** violet 用内嵌单图集；猫娘按角色取自己的图集。 */
export function desktopPetArtworkFor(character: DesktopPetCharacterSpec): string {
  return character.kind === "violet"
    ? desktopPetArtworkDataUrl
    : (desktopPetCatgirlCharacters.find((entry) => entry.id === character.id)?.dataUrl ??
        desktopPetArtworkDataUrl);
}

/** violet 的动作=desktopPetMotion 行；猫娘 5 个任务态动作的图集行号。 */
export function desktopPetActionRowFor(
  character: DesktopPetCharacterSpec,
  mode: "idle" | "working" | "attention" | "completed" | "error",
): { row: number; frameCount: number; fps: number; loop: boolean } | null {
  if (character.kind === "violet") return null;
  const entry = desktopPetCatgirlCharacters.find((candidate) => candidate.id === character.id);
  // 任务态→动作映射（specs TASK-STATES.md）：completed 播 happy 一遍回 idle。
  const actionId =
    mode === "completed" ? "happy" : (entry?.actions.find((a) => a.id === mode)?.id ?? "idle");
  const action = entry?.actions.find((candidate) => candidate.id === actionId);
  if (!action) return null;
  return { row: action.row, frameCount: action.frameCount, fps: action.fps, loop: action.loop };
}
