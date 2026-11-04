import { cn } from "@/components/lib/utils.js";

import { MATE_LAMP_TONE_CLASS, type MateLampTone } from "./statusTone.js";

/**
 * Mate 状态灯（01 §5 五档映射的渲染件；档位类出自 statusTone.ts 单一出处）。
 * 观察档=空心灯（描边不填充），其余为语义色实心圆点；颜色永远伴随可读文本出现
 * （DESIGN.md「never by color alone」），本组件只承担灯本身。
 */
export function MateLamp({ tone, className }: { tone: MateLampTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", MATE_LAMP_TONE_CLASS[tone], className)}
    />
  );
}
