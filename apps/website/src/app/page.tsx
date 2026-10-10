import { readFileSync } from "node:fs";
import path from "node:path";

// 官网首页：迁移自 vanilla 站，hero 窗口区域由真实 packages/ui 组件构建期烘焙（specs/website.md）。
// before = 页头 + hero 文案区；after = hero section 收尾 + 版本卡/能力/下载区 + 页脚。
// hero mock = scripts/generate-hero-mock.mjs 构建期经 esbuild + renderToStaticMarkup 烘焙的静态
// 片段（生成物提交入库）。ui 组件链含 React hooks，不能进入 next build 的 server 模块图谱
// （RSC 编译直接报错）；也不走 "use client" 水合边界——mock 的相对时间以 Date.now() 为基准在
// 构建期烘焙，浏览器重算会水合失配（见 WebsiteMock.mock.tsx 头注，配方 §5）。
// before 与 mock 拼接注入：与 vanilla 时代 DOM 形态一致（单个 main#top 地标，无多余包裹层）。
const heroMock = readFileSync(
  path.join(process.cwd(), "src/components/mock/hero-mock.generated.html"),
  "utf8",
);
const before =
  readFileSync(path.join(process.cwd(), "site-src/home-before.html"), "utf8") + "\n" + heroMock;
const after = readFileSync(path.join(process.cwd(), "site-src/home-after.html"), "utf8");

export default function Home() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: before }} />
      <div dangerouslySetInnerHTML={{ __html: after }} />
    </>
  );
}
