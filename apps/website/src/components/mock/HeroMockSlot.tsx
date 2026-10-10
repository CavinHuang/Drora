"use client";

/**
 * hero mock 挂载槽：服务端渲染烘焙静态片（hero-mock.generated.html）作为
 * 无 JS/首帧兜底，挂载后切换为真组件 <WebsiteMock />。
 *
 * 为什么必须挂载后切换：ConversationTimeline 的 @tanstack/react-virtual 渲染器
 * 依赖运行时测高，静态烘焙产物里聊天流恒为空壳；而直接 SSR+水合会因 mock 的
 * Date.now() 相对时间在构建期与浏览期不一致产生水合失配（specs/website.md、
 * mock-recipe §5）。挂载门（首次客户端渲染复现 SSR 标记，effect 后翻转）同时
 * 规避两者：水合零失配，真组件树不与烘焙时间比对。
 */
import { useEffect, useState } from "react";
import { WebsiteMock } from "./WebsiteMock.mock";

export function HeroMockSlot({ fallbackHtml }: { fallbackHtml: string }) {
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  // 参考站初始停在对话末尾（最新轮次+文件卡贴着 composer）；虚拟化时间线挂载后
  // 需等测高完成，延时把滚动容器推到底。
  useEffect(() => {
    if (!live) return;
    const timer = window.setTimeout(() => {
      const timeline = document.querySelector("[data-testid='v4-timeline']");
      let node: HTMLElement | null = timeline instanceof HTMLElement ? timeline : null;
      while (node && node !== document.body) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          node.scrollTop = node.scrollHeight;
          break;
        }
        node = node.parentElement;
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [live]);
  if (!live) {
    return <div dangerouslySetInnerHTML={{ __html: fallbackHtml }} />;
  }
  return <WebsiteMock />;
}
