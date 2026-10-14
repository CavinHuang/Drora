// R3 P2a 自包含 class 合并工具。语义与 packages/ui cn 相同（clsx + tailwind-merge，
// text-ui-* 注册为字号组）；ui 冻结期不在其上扩展新字号。
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeUiClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-ui-lg", "text-ui-base", "text-ui-sm", "text-ui-xs"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return mergeUiClasses(clsx(inputs));
}
