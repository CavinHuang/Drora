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
      ? "帮我创建一只桌面宠物。先问我想要的角色、外观和风格，再使用可用的图片生成工具制作透明动画；若没有生成工具，请说明，不要用占位图假装完成。"
      : "Help me create a desktop pet. First ask about the character, appearance and style, then use an available image-generation tool to create transparent animation. If no generation tool is available, explain that instead of substituting placeholder artwork.";
  return `${intro}\n\nSave a new, uniquely named folder under ${directory}. Never overwrite existing pets. Use Codex v2 format: ${C.manifest} with displayName, description, spriteVersionNumber: 2, spritesheetPath: "${C.spritesheet}". The transparent PNG/WebP atlas is exactly 1536×2288, 8 columns × 11 rows, cells 192×208. Rows 0–8: idle (6 distinct frames), running-right (8), running-left (8), waving (4), jumping (5), failed (8), waiting (6), running (6), review (6). Rows 9–10 contain 16 look directions clockwise from north in 22.5° increments. Keep character identity, scale and baseline stable; unused cells stay transparent. Review each animation at display size on light/dark backgrounds and validate dimensions/alpha before calling it complete. Return the saved folder, then tell me to refresh and select it in Settings > Desktop pet.`;
}
