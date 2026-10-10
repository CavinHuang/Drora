/* 官方插件图标 png 在 website 侧的替换模块：hero mock 图谱把 pluginIconSource.ts
 * 拉进 Next 模块面，但 mock 子树从不渲染官方插件图标（商店 UI 才用）。tsconfig
 * paths 以更具体的 "@ /assets/plugin-icons/*.png" 映射拦截（先于 "@/*" 回退），
 * 类型侧避开 next/image-types 的 StaticImageData（与 ui 的 Vite string 语义冲突），
 * 运行时侧 webpack 同用此 alias——空串与 generate-hero-mock.mjs 的 empty loader 对齐。 */
const emptyIconUrl = "";
export default emptyIconUrl;
