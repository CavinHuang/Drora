import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Pages 静态导出（项目站点子路径 /Drora/）
  output: "export",
  // ui 包源码按 Vite 语义编写（图片 import=URL string、import.meta.env 等），
  // Next 的类型环境（StaticImageData/无 vite types）与之天然冲突且会接连报错；
  // 类型保障边界=ui 包自身 tsc + apps/website 独立 tsc，构建期跳过检查。
  typescript: { ignoreBuildErrors: true },
  basePath: "/Drora",
  assetPrefix: "/Drora",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@drora/ui", "@drora/shared"],
};

export default nextConfig;
