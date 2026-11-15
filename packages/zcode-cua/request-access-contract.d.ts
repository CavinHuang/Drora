// 对齐上游 v3.18.2 桩 d.ts 的具名接口（CuaRequestAccessStatus / CuaRequestAccessStatusSchema）；
// 此前仅暴露 zod 推导类型，import 具名接口会失败。运行时 schema（.js）不动。
export declare const CUA_REQUEST_ACCESS_STATUS_META_KEY: string;

export interface CuaRequestAccessStatus {
  schemaVersion: 1;
  platform: "darwin";
  grantOwner: string;
  accessibility: "granted" | "stale" | "denied";
  screenRecording: "unknown" | "granted" | "denied";
}

export interface CuaRequestAccessStatusSchema {
  safeParse(
    input: unknown,
  ): { success: true; data: CuaRequestAccessStatus } | { success: false; error: Error };
}

export declare const cuaRequestAccessStatusSchema: CuaRequestAccessStatusSchema;
