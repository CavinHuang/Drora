import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GitHub Pages 静态导出（项目站点子路径 /Drora/）
  output: "export",
  basePath: "/Drora",
  assetPrefix: "/Drora",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@drora/ui", "@drora/shared"],
};

export default nextConfig;
