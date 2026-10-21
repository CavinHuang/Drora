import { DESKTOP_PET_CONTRACT as C } from "@drora/shared";

/** Reuses the existing new-task draft path; this does not send a prompt or start a run. */
export function desktopPetCreationPrompt(
  directory: string,
  locale: string,
  source?: string,
): string {
  const intro = source
    ? locale.startsWith("zh")
      ? `帮我把现有桌面宠物升级到 v2，增加 16 个鼠标朝向。原宠物目录：${JSON.stringify(source)}。先查看现有图片和配置，保留角色、外观、名称和已有动作；缺少图片工具时请说明，不要用占位图。`
      : `Upgrade my existing desktop pet to v2 with 16 pointer-facing directions. Original pet directory: ${JSON.stringify(source)}. Inspect its artwork and manifest first; preserve its identity, name and existing animations. Explain if image tools are unavailable; never substitute placeholder artwork.`
    : locale.startsWith("zh")
      ? "帮我创建一只桌面宠物。角色描述尚未提供时，询问我想要的角色、外观和风格；描述明确后自主完成生成、校验、预览和保存。"
      : "Create a desktop pet. Ask for the character, appearance and style if they are still unspecified; otherwise complete generation, validation, previews and publishing.";
  const skill = `$${C.creationSkill}`;
  const instruction = locale.startsWith("zh")
    ? `先使用 Skill 工具加载内置技能 ${skill}，遵循其中的图片工具发现、图集处理、视觉审核和发布流程。`
    : `First load the bundled ${skill} with the Skill tool and follow its image-tool discovery, atlas processing, visual review and publishing workflow.`;
  return `${instruction}\n\n${intro}\n\nLocal Drora pet library (use this exact destination): ${JSON.stringify(directory)}. Never overwrite existing pets. Keep the creation run outside this library. Publish with the skill's publish_pet.py after all checks pass: ${C.manifest}, spriteVersionNumber: 2, ${C.spritesheet}, 1536×2288, 8×11 cells of 192×208, nine animation rows and sixteen look directions. If this task is remote and cannot access the desktop's local directory, ask to continue in a local task. If image tools or Pillow are unavailable, explain the missing capability; never substitute placeholder artwork. Return the saved folder and preview paths, then tell me to refresh and select it in Settings > Desktop pet.`;
}
