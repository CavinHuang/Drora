import katex from "katex";

/**
 * Shared KaTeX HTML renderer for editable Markdown surfaces.
 * Keep math generation out of editor widgets so every surface starts from the
 * same DOM contract as the Agent Markdown renderer.
 *
 * 还原自 Proma `apps/electron/src/renderer/lib/markdown-math.ts`：
 * LiveMarkdown 族（表格内联公式 / 块级公式 widget）依赖同一函数；
 * katex 与 katex CSS 均为本包既有依赖，不新增重依赖。
 */
export function renderMarkdownMath(latex: string, displayMode = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      output: "htmlAndMathml",
      throwOnError: false,
    });
  } catch {
    return latex;
  }
}
