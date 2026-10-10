declare module "*.css";
declare module "@drora/ui/styles.css";

// 官网（Next.js 静态导出）消费 @drora/ui 源码时的环境类型补齐。
// ui 个别模块（lib/fileDisplay.tsx 等）按 vite 消费方语义读取 import.meta.env.BASE_URL；
// web/desktop 消费方由各自的 env.d.ts 提供声明，官网此前缺失导致整程序 tsc 报错。
// GitHub Pages 静态导出没有 vite 运行时，这里按可选字段声明（运行时值由 next.config
// 的 basePath/assetPrefix 承担，读取方有字符串守卫兜底）。
interface ImportMetaEnv {
  readonly BASE_URL?: string;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
