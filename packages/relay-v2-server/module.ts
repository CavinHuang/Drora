/**
 * relay-v2-server 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 * client/rpc 仅 test/differential.test.ts（specs/relay-v2-server.md §10 L0 差异测试）消费：
 * 复用 @drora/client 的 rpc-frame 协议层与 @drora/rpc VSBuffer；src 构建闭包不变。
 */
export const relayV2ServerModule = {
  id: "relay-v2-server",
  requires: ["web-remote-relay", "client", "rpc"],
  provides: ["relay-v2-server"],
  publicEntrypoints: ["src/index.ts", "contract.ts"],
} as const;
