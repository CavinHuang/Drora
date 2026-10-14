import {
  V4_METHODS,
  v4AttachmentBeginResultSchema,
  v4AttachmentChunkResultSchema,
  v4AttachmentCommitResultSchema,
  v4AttachmentAbortResultSchema,
} from "@drora/shared/drora-protocol-v4";
import {
  droraTopicResourceReadResultSchema,
  type DroraPromptAttachment,
  type DroraProtocolTrace,
} from "@drora/shared";
import { uploadBotGroupAttachments } from "./groupAttachmentUpload.js";
import type { DroraProtocolClient } from "./droraProtocolClient.js";
import type { DroraAgentSessionTarget } from "./droraAgent.js";

/** 反向请求绑定实际 CLI 连接；上传不能再次按路径选择运行时。 */
export async function uploadTopicResourceToClient(
  client: Pick<DroraProtocolClient, "request">,
  connectionId: string,
  target: DroraAgentSessionTarget,
  attachment: DroraPromptAttachment,
  signal: AbortSignal,
  trace?: DroraProtocolTrace,
) {
  const [ref] = await uploadBotGroupAttachments(
    {
      attachmentBeginV4: (p) =>
        client.request(
          V4_METHODS.attachmentBegin,
          {
            connectionId,
            uploadId: p.uploadId,
            sessionId: p.sessionId,
            fileName: p.fileName,
            mime: p.mime,
            totalBytes: p.totalBytes,
            totalChunks: p.totalChunks,
            checksum: p.checksum,
          },
          v4AttachmentBeginResultSchema,
          { signal, trace },
        ),
      attachmentChunkV4: (p) =>
        client.request(
          V4_METHODS.attachmentChunk,
          {
            connectionId,
            uploadId: p.uploadId,
            sessionId: p.sessionId,
            chunkIndex: p.chunkIndex,
            dataBase64: p.dataBase64,
          },
          v4AttachmentChunkResultSchema,
          { signal, trace },
        ),
      attachmentCommitV4: (p) =>
        client.request(
          V4_METHODS.attachmentCommit,
          {
            connectionId,
            uploadId: p.uploadId,
            sessionId: p.sessionId,
          },
          v4AttachmentCommitResultSchema,
          { signal, trace },
        ),
      attachmentAbortV4: async (p) => {
        await client.request(
          V4_METHODS.attachmentAbort,
          {
            connectionId,
            uploadId: p.uploadId,
            sessionId: p.sessionId,
          },
          v4AttachmentAbortResultSchema,
        );
      },
    },
    target,
    [attachment],
    signal,
  );
  return droraTopicResourceReadResultSchema.parse(ref);
}
