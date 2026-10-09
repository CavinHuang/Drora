import { desktopPetCatgirlCharacters } from "./desktopPetCatgirlArtwork.js";
import {
  desktopPetActionRowFor,
  type DesktopPetCharacterSpec,
} from "./desktopPetCharacter.js";

/** 猫娘动作是等时长帧（fps 均一），steps(1,end) 逐格走 8 列图集的对应行。 */
export function desktopPetCatgirlMotionCss(character: DesktopPetCharacterSpec): string {
  const { width: cellWidth, height: cellHeight } = character.art;
  const modes = ["idle", "working", "attention", "completed", "error"] as const;
  return modes
    .map((mode) => {
      const action = desktopPetActionRowFor(character, mode);
      if (!action) return "";
      const total = (action.frameCount / action.fps) * 1000;
      const stops: string[] = [];
      const last = action.loop ? 0 : action.frameCount - 1;
      for (let frame = 0; frame < action.frameCount; frame += 1) {
        const next = frame + 1 < action.frameCount ? frame + 1 : last;
        const x = -next * cellWidth;
        const y = -action.row * cellHeight;
        stops.push(
          `${((frame / action.frameCount) * 100).toFixed(4)}%{background-position:${x}px ${y}px}`,
        );
      }
      const repeat = action.loop ? "infinite" : "1 forwards";
      return `@keyframes pet-${mode}{${stops.join("")}}\n#pet[data-mode=${mode}] #pet-art{background-position:0 ${-action.row * cellHeight}px;animation:pet-${mode} ${total}ms steps(1,end) ${repeat}}`;
    })
    .join("\n");
}

export function desktopPetCatgirlBackgroundSize(character: DesktopPetCharacterSpec): string {
  const entry = desktopPetCatgirlCharacters.find((candidate) => candidate.id === character.id);
  const rows = entry?.actions.length ?? 1;
  return `${character.art.width * 8}px ${character.art.height * rows}px`;
}
