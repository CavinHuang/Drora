import { z } from "zod";

/**
 * Drora agent 提供方的单一真源。
 *
 * 类型 DroraProvider、运行时 schema droraProviderSchema 都从这里派生,
 * 避免各处内联 z.enum([...]) 副本随新增/删除 provider 漂移。
 * 本模块只依赖 zod(叶子),可被 validation / drora-protocol 等无环引用。
 */
const DRORA_PROVIDERS = ["glm"] as const;

export const droraProviderSchema = z.enum(DRORA_PROVIDERS);

export type DroraProvider = (typeof DRORA_PROVIDERS)[number];
