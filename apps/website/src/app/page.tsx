import { readFileSync } from "node:fs";
import path from "node:path";

import { HeroMockSlot } from "../components/mock/HeroMockSlot";

// 官网首页：迁移自 vanilla 站。hero 文案区与页面尾段为 site-src 静态片段注入；
// hero 窗口由 HeroMockSlot 渲染——服务端出构建期烘焙的静态壳
// （scripts/generate-hero-mock.mjs，生成物提交入库），客户端挂载后切换为真组件
// WebsiteMock（ConversationTimeline 虚拟化需要运行时测高才能出行；挂载门规避
// Date.now() 相对时间的水合失配）。架构详见 specs/website.md。
// before / slot / after 三段拼接：与 vanilla 时代 DOM 形态一致（单个 main#top 地标）。
const heroMock = readFileSync(
  path.join(process.cwd(), "src/components/mock/hero-mock.generated.html"),
  "utf8",
);
const before = readFileSync(path.join(process.cwd(), "site-src/home-before.html"), "utf8");
const after = readFileSync(path.join(process.cwd(), "site-src/home-after.html"), "utf8");

export default function Home() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: before }} />
      <HeroMockSlot fallbackHtml={heroMock} />
      <div dangerouslySetInnerHTML={{ __html: after }} />
    </>
  );
}
