import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  // GitHub Pages 项目站点子路径的最终 URL；og/twitter 绝对链接以此解析（消除 metadataBase 回落 localhost 警告）
  metadataBase: new URL("https://cavinhuang.github.io/Drora"),
  title: "Drora | GLM-5.3 开源氛围编程工具",
  description:
    "Drora 是新一代氛围编程工具：多智能体协作完成复杂目标，桌面宠物一路陪伴，手机远控随时随地尽在掌控。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <Script src="/Drora/assets/js/components.js" strategy="afterInteractive" />
        <Script src="/Drora/assets/js/i18n.js" strategy="afterInteractive" />
        <Script src="/Drora/assets/js/main.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
