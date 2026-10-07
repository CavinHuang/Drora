import type { DroraSessionFile, DroraTaskMeta } from "@drora/shared";
import { droraSessionFileSchema, droraTaskMetaSchema, droraTaskModeSchema } from "@drora/shared";

export type LegacyTaskSessionFile = Omit<DroraSessionFile, "meta"> & {
  meta: Omit<DroraTaskMeta, "mode"> & { mode?: DroraTaskMeta["mode"] };
};

const legacyTaskSessionFileSchema = droraSessionFileSchema.extend({
  // Claude 原生迁移会按清洗路径删除 meta.mode。
  // legacy snapshot 读取/写入仍要校验其它必需字段，但不能再强制把被过滤字段补回文件。
  meta: droraTaskMetaSchema.extend({
    mode: droraTaskModeSchema.optional(),
  }),
});

export function parseLegacyTaskSessionFile(input: unknown): LegacyTaskSessionFile {
  return legacyTaskSessionFileSchema.parse(input);
}

export function safeParseLegacyTaskSessionFile(input: unknown) {
  return legacyTaskSessionFileSchema.safeParse(input);
}
