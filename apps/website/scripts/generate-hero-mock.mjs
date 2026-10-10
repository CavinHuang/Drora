/**
 * 首页 hero「真组件 mock」构建期烘焙器。
 *
 * 为什么由本脚本而不是 next build 渲染：Next 15 App Router 的 RSC 编译禁止 server
 * 图谱引入含 React hooks 的模块（packages/ui 的 provider/组件链内部使用 useState 等）；
 * 而烘焙语义要求 mock 子树零水合（mock-data 的 Date.now() 基准与组件相对时间在构建期
 * 烘焙后不得在浏览器重算，见 WebsiteMock.mock.tsx 头注与 mock-recipe §5）。因此 ui 组件树
 * 不进 next 的模块图谱，改由本脚本在构建期用 esbuild 打包（tsconfig paths 解析 ui 源码
 * 的 `@/*.js` 导入）+ react-dom/server renderToStaticMarkup 渲染为静态 HTML 片段，
 * 写入 src/components/mock/hero-mock.generated.html（提交入库），由 src/app/page.tsx 读入拼接。
 *
 * 产品 UI 变更后重跑：pnpm --filter @drora/website generate:hero-mock（next build 前也会自动执行）。
 * 临时 bundle 落在 .hero-mock-tmp/，用后即删。
 */
import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pkgDir = path.resolve(import.meta.dirname, "..");
const tmpDir = path.join(pkgDir, ".hero-mock-tmp");
const outfile = path.join(tmpDir, "bundle.mjs");
const generatedPath = path.join(pkgDir, "src", "components", "mock", "hero-mock.generated.html");

try {
  await mkdir(tmpDir, { recursive: true });
  await build({
    stdin: {
      contents: [
        'import { renderToStaticMarkup } from "react-dom/server";',
        'import { WebsiteMock } from "../src/components/mock/WebsiteMock.mock";',
        "export function render() {",
        "  return renderToStaticMarkup(<WebsiteMock />);",
        "}",
      ].join("\n"),
      loader: "tsx",
      resolveDir: path.join(pkgDir, "scripts"),
      sourcefile: "hero-mock-entry.tsx",
    },
    tsconfig: path.join(pkgDir, "tsconfig.json"),
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    outfile,
    // ui 源码按 vite 语义 import 资产（pluginIconSource.ts 的官方插件图标 png 等）；
    // mock 子树不渲染这些图标，置空即可，避免为构建期 bundle 内联资产
    loader: {
      ".png": "empty",
      ".svg": "empty",
      ".webp": "empty",
      ".jpg": "empty",
      ".mjs?url": "empty",
    },
    plugins: [
      {
        name: "vite-url-shim",
        setup(build) {
          // Vite 的 ?url 资产导入（如 pdf.js worker 的 ESM 无 default 导出）：
          // 导出请求路径字符串垫片（装饰 mock 不实例化 worker），对齐 Vite ?url 语义。
          build.onResolve({ filter: /\?url$/ }, (args) => ({
            path: args.path,
            namespace: "vite-url",
          }));
          build.onLoad({ filter: /.*/, namespace: "vite-url" }, (args) => ({
            contents: `export default ${JSON.stringify(args.path)};`,
            loader: "js",
          }));
        },
      },
    ],
    // 产物是构建期输入而非运行时代码：固定 production 语义，避免开发版 react 的额外分支
    define: { "process.env.NODE_ENV": '"production"' },
    // ESM 产物里 react-dom/server.node（CJS）动态 require node 内建模块，
    // 用 createRequire 注入真实 require（esbuild 处理 CJS 依赖进 ESM 的标准修法）
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
    },
    logLevel: "warning",
    legalComments: "none",
  });

  const { render } = await import(pathToFileURL(outfile).href);
  const html = render();
  if (typeof html !== "string" || html.length < 10_000 || !html.includes("mock-wrap")) {
    throw new Error(`hero mock 渲染结果异常（${typeof html}，${html?.length ?? 0}B）`);
  }
  await writeFile(generatedPath, html);
  console.log(
    `hero mock baked: ${path.relative(pkgDir, generatedPath)} (${Buffer.byteLength(html)}B)`,
  );
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
