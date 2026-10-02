// 文件 chip 相对目录基准窄公开入口（specs/mobile-relay-r3-frontend.md §32.20；
// §22 窄入口模式——mobile-web 经此设置 ui fileDisplay 还原件的全局默认 basePath，
// 不深引 lib 实现文件）。官方语义：upstream index chunk `useEffect(()=>{zCe(Ce)},[Ce])`
// ——活动工作区变化即设基准，文件 chip 的相对目录按工作区计算。
export { setDefaultFileDisplayBasePath } from "@/lib/fileDisplay.js";
