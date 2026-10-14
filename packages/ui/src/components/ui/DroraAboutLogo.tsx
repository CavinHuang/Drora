import { cn } from "@/components/lib/utils.js";

export function DroraAboutLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="118"
      height="125"
      fill="none"
      viewBox="0 0 143 152"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M0 0H74C96.25 0 143 23.87 143 76C143 127.16 97.91 152 74 152H29L57 122C105.84 122 111 89.6 111 76C111 42.64 82.51 32 73 32H33V100C33 100.45 33.55 100.7 34.35 100.7H37L33.5 104L0 142V0Z"
      />
    </svg>
  );
}
/** 分享等新增官方场景使用 Drora 品牌，不复制上游 ZCode 的字标资产。 */
export function DroraWordmarkLogo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Drora" className={className}>
      <span className="inline-flex h-full items-center gap-2">
        <DroraAboutLogo className="h-full w-auto" />
        <span className="text-ui-base font-semibold">Drora</span>
      </span>
    </span>
  );
}
