import path from "node:path";
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
  resolve: {
    // ui 包（Vite 语义）的 ?url 资产导入（如 pdf.js worker 的 ESM 无 default 导出）
    // 在 esbuild 打包下报 No matching export——alias 垫片绕开。
    alias: {
      "pdfjs-dist/build/pdf.worker.min.mjs?url": path.resolve(
        __dirname,
        "src/shims/pdf-worker-url.js",
      ),
    },
  },
  webpack: (config) => {
    // ui 包源码内部以 `.js` 后缀导入 `.ts/.tsx` 文件（NodeNext 风格，如
    // websiteHeroMock 的 `@/WorkspaceSidebarItem.js`）；webpack 需 extensionAlias 解析。
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    // webpack 的 alias 按 query 前的请求串匹配，带 `?url` 的键永不命中——
    // 这里再挂无 query 的键，让 pdf worker 的 ?url 导入落到垫片（与 resolve.alias 同值）。
    config.resolve.alias["pdfjs-dist/build/pdf.worker.min.mjs"] = path.resolve(
      __dirname,
      "src/shims/pdf-worker-url.js",
    );
    // ui 包（Vite 语义）的 ?url 资产导入（如 pdf.js worker）：按 asset/resource
    // 处理——源文件随产物发出、导出 URL 字符串，对齐 Vite 的 ?url 后缀语义。
    // unshift 保证先于 js 处理规则匹配。
    config.module.rules.unshift({
      test: /\?url$/,
      type: "asset/resource",
      generator: { filename: "static/assets/[hash][ext]" },
    });
    return config;
  },
};

export default nextConfig;
