// §33.18.21 composer 草稿持久化（specs/mobile-relay-r3-frontend.md）：ui
// composerDraftStore 窄入口复用（官方 parity 的 per-workspace+per-session 草稿，
// localStorage 键 zcode-v4-composer-drafts:v1:<encoded-workspace>，语义=发送只清
// 内容、显式清理才删 scope；附件不入草稿——与 ui 裁决一致）。App 域包装避免
// App 直引 ui 子入口（§22 白名单按文件收口）。
import {
  clearV4ComposerDraft,
  persistV4ComposerDraft,
  readV4ComposerDraft,
} from "@zcode/ui/composer-draft-store";
import type { IServiceAccessor } from "@zcode/services";

export interface ComposerDraft {
  text: string;
}

export function readComposerDraft(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  scopeId: string;
}): ComposerDraft | null {
  const draft = readV4ComposerDraft(params.workspacePath, params.workspaceIdentity, params.scopeId);
  return draft ? { text: draft.text } : null;
}

export function persistComposerDraft(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  scopeId: string;
  text: string;
}): void {
  persistV4ComposerDraft(params.workspacePath, params.workspaceIdentity, params.scopeId, {
    text: params.text,
  });
}

export function clearComposerDraft(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  scopeId: string;
}): void {
  clearV4ComposerDraft(params.workspacePath, params.workspaceIdentity, params.scopeId);
}

/** 类型占位：保持与 services 面的依赖显式（未来 scope 内附件草稿裁决时用）。 */
export type ComposerDraftAccessor = IServiceAccessor;
