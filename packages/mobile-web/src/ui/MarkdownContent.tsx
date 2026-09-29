// R3 P3b markdown 渲染第一档（specs/mobile-relay-r3-frontend.md §15 第 2 条）。
// marked 解析 + DOMPurify 净化后注入：assistantText 是模型/远端产生的不可信文本，
// 直接 dangerouslySetInnerHTML 会引入 XSS（script 节点、事件属性、javascript: 协议），
// 因此 HTML 字符串必须先过 DOMPurify.sanitize 默认白名单再注入；链接经
// afterSanitizeAttributes 钩子补 target=_blank + rel=noopener noreferrer
// （DOMPurify 官方推荐模式：钩子在属性白名单过滤之后执行，补写的属性不会被洗掉）。
// 语法高亮归 P3 后续；userInput 保持纯文本（TaskTimeline 直出，不经本组件）。
// D6 自包含：不 import @drora/ui；样式走 styles.css 的 .drora-md 命名空间。
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "./cn.js";

// afterSanitizeAttributes 钩子挂在 DOMPurify 模块级全局状态上，只需装一次；
// 重复 addHook 会叠层执行（每个净化批次跑多遍同一段补属性逻辑）。
let linkSafetyHookInstalled = false;

function ensureLinkSafetyHook(): void {
  if (linkSafetyHookInstalled) return;
  linkSafetyHookInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    if (!node.hasAttribute("href")) return;
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  });
}

export interface MarkdownContentProps {
  /** 待渲染的 markdown 原文（不可信输入；组件内部强制净化后才注入 DOM）。 */
  text: string;
  className?: string;
}

/**
 * assistantText markdown 渲染（受控纯组件）：marked 同步解析 → DOMPurify 净化 →
 * dangerouslySetInnerHTML 注入。命名空间 .drora-md 提供代码块/表格/列表排版
 * （styles.css），根元素字号 text-ui-base 对齐时间线气泡。
 */
export function MarkdownContent({ text, className }: MarkdownContentProps) {
  ensureLinkSafetyHook();
  const html = useMemo(() => {
    // async:false 固定同步分支（类型收窄为 string，不走 Promise/worker 路径）。
    const raw = marked.parse(text, { async: false });
    // 安全面：净化为强制步骤，raw 不允许绕过 sanitize 直接进 DOM。
    return DOMPurify.sanitize(raw);
  }, [text]);
  return (
    <div
      className={cn("drora-md text-ui-base text-foreground", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
