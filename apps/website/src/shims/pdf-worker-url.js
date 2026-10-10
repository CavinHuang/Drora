/* 垫片：pdfjs-dist 的 ESM worker（v4+）无 default 导出，Next 的 esbuild 打包
 * 对 "?url" 导入报 No matching export。装饰 mock 不实例化 worker，导出空串。 */
export default "";
