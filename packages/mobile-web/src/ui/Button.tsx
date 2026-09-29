// R3 P2a 自包含 Button（最小面）：仅移动壳用到的 variant（ghost/outline）与 size
// （sm/icon-sm）。视觉对齐 packages/ui button 的对应分支；ui 冻结，本包自持。
// 触控目标 ≥44px 由调用方显式给 size-11（与 ui MobileHomeShell 同约定）。
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";

export type MobileButtonVariant = "ghost" | "outline";
export type MobileButtonSize = "sm" | "icon-sm";

const VARIANT_CLASSES: Record<MobileButtonVariant, string> = {
  ghost: "hover:bg-surface-hover",
  outline: "border border-border bg-transparent hover:bg-surface-hover",
};

const SIZE_CLASSES: Record<MobileButtonSize, string> = {
  sm: "h-8 rounded-md px-3 text-ui-sm",
  "icon-sm": "size-6 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: MobileButtonVariant;
  size?: MobileButtonSize;
}

export function Button({
  variant = "ghost",
  size = "sm",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-ui-sm font-medium text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    />
  );
}
