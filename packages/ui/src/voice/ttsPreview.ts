/**
 * §15 语音试听公开面（voice 模块 publicEntrypoint）：单次合成 + Blob 播放，供
 * settings/model-capabilities 表单跨模块消费（specs/model-capabilities.md §15.3）。
 * 适配器实现（cloudTtsAdapter.ts）本身不对外公开——播报链路消费方仍在模块内。
 */
export { playTtsBlob, synthesizeOnce } from "./cloudTtsAdapter.js";
