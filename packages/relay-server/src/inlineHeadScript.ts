/** 仅改写出站 HTML；冻结资产与磁盘缓存仍保持上游原始字节。 */
export function injectInlineHeadScript(html: string, marker: string, scriptBody: string): string {
  if (html.includes(marker)) return html;
  const script = `<script>${scriptBody}</script>`;
  const headMatch = /<head[^>]*>/i.exec(html);
  if (headMatch) {
    const index = headMatch.index + headMatch[0].length;
    return `${html.slice(0, index)}${script}${html.slice(index)}`;
  }
  return `${script}${html}`;
}
