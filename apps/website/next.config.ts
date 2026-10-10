import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // GitHub Pages 静态导出（项目站点子路径 /Drora/）
  output: "export",
  basePath: "/Drora",
  assetPrefix: "/Drora",
  trailingSlash: true,
  images: {
    unoptimized: true,
    // 官网不用 next/image；关掉静态图片导入类型后，next-env 不再引用 image-types/global，
    // `*.png` 回落到 @drora/ui assets.d.ts 的 vite 语义（string），消除 pluginIconSource 的
    // StaticImageData/string 类型冲突（ui 源码按 vite 消费方编写，不为本站改动）。
    disableStaticImages: true,
  },
  transpilePackages: ["@drora/ui", "@drora/shared"],
  webpack: (config) => {
    // @drora/ui 源码内部用 `@/xxx` 别名互相引用（1000+ 处，见 packages/ui/tsconfig.json paths）。
    // 与 packages/web/vite.config.ts 的消费方别名同款修法：把 `@` 指到 ui 包 src，
    // 保持 ui 组件源码不动。apps/website 自身代码不使用 `@/` 导入。
    config.resolve.alias["@"] = path.resolve(__dirname, "../../packages/ui/src");
    return config;
  },
};

export default nextConfig;
