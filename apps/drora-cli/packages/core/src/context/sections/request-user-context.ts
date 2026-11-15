// ============================================================
// Request User Context Section Builder
// ============================================================

import { join } from "node:path";

import { formatProjectMemoryIndexContent } from "../../memory/index-content.js";
import type {
  ContextSection,
  InstructionFile,
  ResolvedUserInstructionSource,
  ResolvedUserInstructions,
} from "../types.js";
import { estimateTokens } from "../utils.js";
import {
  createInstructionFile,
  INSTRUCTION_TYPE_AUTO_MEMORY,
  INSTRUCTION_TYPE_PROJECT,
  INSTRUCTION_TYPE_USER,
  renderInstructionAnnouncement,
} from "./instruction-files.js";

export function buildRequestUserContextSection(input: {
  userInstructions?: ResolvedUserInstructions;
  memoryIndexContent?: string;
  memoryRoot?: string;
}): ContextSection | null {
  const instructionFiles = buildInstructionFiles(input);
  if (instructionFiles.length === 0) {
    return null;
  }
  const content = renderInstructionAnnouncement(instructionFiles);

  return {
    name: "Request User Context",
    source: "request_user_context",
    injectionTarget: "meta_user",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
    instructionFiles,
  };
}

/** 指令文件在前、Memory 索引在后；正文为空的文件不出现。 */
function buildInstructionFiles(input: {
  userInstructions?: ResolvedUserInstructions;
  memoryIndexContent?: string;
  memoryRoot?: string;
}): InstructionFile[] {
  const files = input.userInstructions
    ? normalizedInstructionSources(input.userInstructions).flatMap((source) => {
        const file = buildInstructionSourceFile(source);
        return file ? [file] : [];
      })
    : [];
  const memoryIndexFile = buildProjectMemoryIndexFile(input.memoryRoot, input.memoryIndexContent);
  if (memoryIndexFile) files.push(memoryIndexFile);
  return files;
}

function buildProjectMemoryIndexFile(
  memoryRoot: string | undefined,
  indexContent: string | undefined,
): InstructionFile | null {
  if (!memoryRoot || indexContent === undefined) return null;
  const formatted = formatProjectMemoryIndexContent(indexContent);
  if (!formatted) return null;

  // 修复：memoryRoot 已归一为正斜杠，join 会再引入反斜杠（Windows），令提示词路径漂移。
  // 上游 v3.18.0 重构为 createInstructionFile(join(...))，renderInstructionFile 直接渲染
  // file.path——join 结果按本仓归一规则转回正斜杠，保持提示词路径稳定。
  return createInstructionFile(
    join(memoryRoot, "MEMORY.md").replaceAll("\\", "/"),
    INSTRUCTION_TYPE_AUTO_MEMORY,
    formatted,
  );
}

export function normalizedInstructionSources(
  instructions: ResolvedUserInstructions,
): ResolvedUserInstructionSource[] {
  if (instructions.sources && instructions.sources.length > 0) {
    return instructions.sources;
  }

  return [
    {
      scope: "workspace",
      filePath: instructions.filePath,
      fileName: instructions.fileName,
      content: instructions.content,
      bytesRead: instructions.bytesRead,
      sizeBytes: instructions.sizeBytes,
      truncated: instructions.truncated,
    },
  ];
}

function buildInstructionSourceFile(source: ResolvedUserInstructionSource): InstructionFile | null {
  const body = source.truncated
    ? `${source.content}\n\n[File truncated: ${source.fileName}]`
    : source.content;
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return null;
  }

  return createInstructionFile(
    source.filePath,
    source.scope === "user" ? INSTRUCTION_TYPE_USER : INSTRUCTION_TYPE_PROJECT,
    trimmedBody,
  );
}
