// oxlint-disable-file -- 还原自发行 bundle 的 request-access 状态 schema。
// 设置页「请求访问」面板按此 schema 读取 Helper 写入的状态元数据。
import { z } from "zod";
export const CUA_REQUEST_ACCESS_STATUS_META_KEY = "zcode.cua/request-access-status-v1";
// zod schema 的 safeParse 结构与 request-access-contract.d.ts 的
// CuaRequestAccessStatusSchema 接口逐字段兼容（error 为 ZodError extends Error）。
export var cuaRequestAccessStatusSchema = z
    .object({
    schemaVersion: z.literal(1),
    platform: z.literal("darwin"),
    // grantOwner 校验对齐原版 rio schema（zcode.cjs @5028721/宿主 dist 同款）：
    // 曾误还原为裸 z.string()，空串/超长/带空白 owner 会被接受。
    grantOwner: z.string().trim().min(1).max(512),
    accessibility: z.enum(["granted", "stale", "denied"]),
    screenRecording: z.enum(["unknown", "granted", "denied"]),
})
    .strict();
