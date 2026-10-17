import type { DesktopPetCatalog } from "@drora/shared";
import { desktopPetMotion } from "./desktopPetArtwork.js";
import { desktopPetCatgirlCharacters } from "./desktopPetCatgirlArtwork.js";
import {
  DESKTOP_PET_CHARACTERS,
  desktopPetActionRowFor,
  desktopPetArtworkFor,
} from "./desktopPetCharacter.js";

/**
 * 虚拟宠物管理中心（specs/desktop-pet.md §third release）的角色目录：
 * 纯打包资产读数——id/双语名/图集 data URL/待机静帧定位。无窗口依赖、无任务事实；
 * 设置页用它渲染图库预览，UI 包不持有镜像的角色表。
 */
export function buildDesktopPetCatalog(): DesktopPetCatalog {
  return DESKTOP_PET_CHARACTERS.map((character) => {
    if (character.kind === "violet") {
      // violet：idle 动作行由动画清单声明，静帧列取该行 stillFrame。
      const idleRow = Math.max(
        0,
        desktopPetMotion.findIndex((track) => track.mode === "idle"),
      );
      return {
        id: character.id,
        nameZh: character.nameZh,
        nameEn: character.nameEn,
        preview: {
          dataUrl: desktopPetArtworkFor(character),
          frameWidth: character.art.width,
          frameHeight: character.art.height,
          column: desktopPetMotion[idleRow]?.stillFrame ?? 0,
          row: idleRow,
          columns: 8,
          rows: desktopPetMotion.length,
        },
      };
    }
    const entry = desktopPetCatgirlCharacters.find((candidate) => candidate.id === character.id);
    const idleAction = desktopPetActionRowFor(character, "idle");
    return {
      id: character.id,
      nameZh: character.nameZh,
      nameEn: character.nameEn,
      preview: {
        dataUrl: desktopPetArtworkFor(character),
        frameWidth: character.art.width,
        frameHeight: character.art.height,
        // 猫娘等时长帧游标从第 0 列起步，待机静帧即 idle 行首帧。
        column: 0,
        row: idleAction?.row ?? 0,
        columns: 8,
        rows: entry?.actions.length ?? 1,
      },
    };
  });
}
