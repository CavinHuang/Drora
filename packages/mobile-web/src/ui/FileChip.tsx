// 官方文件 chip 组件还原（specs/mobile-relay-r3-frontend.md §32.17）。
// 证据：官方 bundle Nh（chip：icon + 文件名 + 可选相对路径）与 Ph（裸图标 img），
// onError 回退链 UCe（fileIcon.ts 移植）。默认 className/尺寸/结构逐字对照 bundle。
import { useEffect, useState, type ReactNode } from "react";
import { fileIconNameFor, fileIconSrc, resolveFileIconFallbackSrc } from "./fileIcon.js";

/** 图标 img（bundle Ph）：onError 逐级回退（原 URL → document.svg → 内联）。 */
export function FileIconImage({
  src,
  size = 16,
  className,
}: {
  src: string;
  size?: number;
  className?: string;
}) {
  const [current, setCurrent] = useState(src);
  useEffect(() => {
    setCurrent(src);
  }, [src]);
  return (
    <img
      src={current}
      alt=""
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      onError={() => {
        // 官方 UCe 链：`let e=UCe(r); e&&i(e)`——回退目标为 null（已是内联）时不再 setState。
        const fallback = resolveFileIconFallbackSrc(current);
        if (fallback) setCurrent(fallback);
      }}
    />
  );
}

/** FileChip 的路径元数据入参（bundle Mh/Nh 的 options 面）。 */
export interface FileChipOptions {
  /** 行类型（directory 恒 folder 图标，bundle Mh 的 kind 分支）。 */
  kind?: "directory" | "file";
  /** 图标尺寸（官方默认 16）。 */
  iconSize?: number;
  /** 隐藏图标（官方 showIcon===false 分支）。 */
  showIcon?: boolean;
  /** 是否渲染相对路径段（官方 showFilePath，需同时给出 filePath）。 */
  showFilePath?: boolean;
  /** 预计算的相对路径（本组件不重算路径语义，由调用方给出）。 */
  filePath?: string;
  className?: string;
  fileNameClassName?: string;
  filePathClassName?: string;
  /** 覆盖文件名显示（缺省取 path 末段）。 */
  name?: string;
}

/**
 * 文件 chip（bundle Nh）：inline-flex 容器 + 图标 + 文件名 +（可选）相对路径。
 * 受控展示组件——打开/选择等行为归调用方。
 */
export function FileChip({
  path,
  options,
  children,
}: {
  path: string;
  options?: FileChipOptions;
  children?: ReactNode;
}) {
  const iconName = fileIconNameFor(path, options?.kind);
  const iconSrc = fileIconSrc(iconName);
  const name = options?.name ?? path.split(/[\\/]/).pop() ?? path;
  return (
    <span className={options?.className ?? "inline-flex max-w-full items-center gap-1 "}>
      {options?.showIcon === false ? null : (
        <FileIconImage src={iconSrc} size={options?.iconSize ?? 16} className="shrink-0" />
      )}
      <span className={options?.fileNameClassName ?? "truncate text-ui-base font-medium text-foreground"}>
        {name}
      </span>
      {options?.showFilePath && options?.filePath ? (
        <span className={options?.filePathClassName ?? "truncate text-ui-base text-foreground-subtlest"}>
          {options.filePath}
        </span>
      ) : null}
      {children}
    </span>
  );
}
