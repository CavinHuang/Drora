/**
 * voice 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const voiceModule = {
  id: "voice",
  requires: ["services", "shared", "ui"],
  provides: ["voice"],
  // 与 architecture-policy.yaml voice.publicEntrypoints 同步维护（policy 为权威；
  // 全域审查修复：此前漂移 4 项——跨模块消费面集中在 settings/model-capabilities）。
  publicEntrypoints: [
    "contract.ts",
    "voiceTuning.ts",
    "voiceRecordingControl.ts",
    "voiceVendorBaseUrl.ts",
    "ttsPreview.ts",
    "voiceVendorFetch.ts",
  ],
} as const;
