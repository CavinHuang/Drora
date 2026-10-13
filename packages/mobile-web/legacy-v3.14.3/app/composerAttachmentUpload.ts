// §33.18.20 附件上传链（specs/mobile-relay-r3-frontend.md）：ui
// uploadAttachmentTransaction 窄入口复用（begin/chunk(384KiB)/commit 编排 + 校验和 +
// 失败 abort + 进度）——手机 accessor.droraAgentService 四方法结构化满足 agent 面，
// 零自研编排。上限 PROTOCOL_V4_LIMITS.attachmentMaxBytes = 20MiB（解码后）。
import { uploadAttachmentTransaction } from "@drora/ui/attachment-upload-transaction";
import type { AttachmentRef } from "@drora/shared/drora-protocol-v4";
import type { IServiceAccessor } from "@drora/services";

const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export async function uploadComposerAttachment(params: {
  accessor: IServiceAccessor;
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  file: File;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}): Promise<AttachmentRef> {
  if (params.file.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(`attachment too large: ${params.file.name} (max 20MiB)`);
  }
  const bytes = new Uint8Array(await params.file.arrayBuffer());
  let binary = "";
  const callStackSafeChunk = 0x8000;
  for (let index = 0; index < bytes.length; index += callStackSafeChunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + callStackSafeChunk));
  }
  const dataBase64 = btoa(binary);
  const mime = params.file.type || "application/octet-stream";
  const result = await uploadAttachmentTransaction(
    params.accessor.droraAgentService,
    {
      workspacePath: params.workspacePath,
      ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    },
    {
      sessionId: params.sessionId,
      fileName: params.file.name,
      mime,
      dataBase64,
    },
    {
      onProgress: (progress) => params.onProgress?.(progress.uploadedBytes, progress.totalBytes),
    },
  );
  return {
    ref: result.ref,
    fileName: params.file.name,
    mime,
    bytes: bytes.byteLength,
  };
}
