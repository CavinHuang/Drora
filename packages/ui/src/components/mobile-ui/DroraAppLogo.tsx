import type { DroraAppLogoProps } from "@/components/mobile-ui/contract.js";
import { cn } from "@/components/lib/utils.js";
// 移植自 packages/ui/src/WorkspaceSidebar/WorkspaceSidebarCollapsedRail.tsx（69049ebd4/ee041bf2f 品牌与改名提交）：
// 应用品牌 logo 使用 Drora 资产 drora-mark.svg（specs/drora-rename.md：「drora-mark.svg 继续只承担
// 应用图标/顶栏/侧栏角色」）；logo-zai.svg 仅保留给 OAuth provider 图标（oauthProviderIcon.tsx）。
import appLogoUrl from "@/assets/drora-mark.svg";

/**
 * 桌面端标题栏左上角同款应用 logo（Drora D 形标记，自带底色，深浅主题通用）。
 * 装饰性图片：调用方负责在旁边给出可读的品牌文字，避免屏幕阅读器重复朗读。
 */
export function DroraAppLogo({ className }: DroraAppLogoProps) {
  return (
    <img
      src={appLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      // 稳定的测试/E2E 钩子：打包器可能把 SVG 内联为 data URL，不能靠文件名断言。
      data-app-logo="drora"
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}
