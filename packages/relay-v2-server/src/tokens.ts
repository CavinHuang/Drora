// 一次性 token 存储（specs/relay-v2-server.md §5.1/§5.2，行为参照 fake-relay-v2.ts）。
// 状态所有者（spec §4）：本模块内存独占全部未消费 token。token 形态与生命周期：
// 16 随机字节 base64url（22 字符无填充）、绑定 user + role 不绑 SID、60 秒有效、
// WS 升级前消费即删（同步 Map delete，Node 单线程下天然原子）；失败不恢复，重连必须重申请。
// 红线：token 本体不进任何日志（本模块不落日志，调用方同样不得输出）。

import { randomBytes } from "node:crypto";
import type { WebRemoteControlRelayV2Role } from "@drora/shared/web-remote-relay";
import type { RelayTokenIdentity, TokenStore } from "./types.js";

/** 有效期 60 秒（spec §5.1 `expires_in: 60`；契约 docs/web-remote-control/relay-v2-pairing.md）。
 * 模块私有（评审 unused-exports：无包外消费，`expires_in: 60` 字面量即对秒的公开口径） */
const TOKEN_TTL_MS = 60_000;
/** 16 随机字节 → base64url 22 字符无填充（spec §5.1，fake relay 同款） */
const TOKEN_BYTES = 16;

export interface CreateTokenStoreOptions {
  /** 可注入时钟（测试/对时）；默认 Date.now */
  now?: () => number;
  /**
   * 测试注入口：外部提供 Map 以便直接断言内部规模（评审 token-sweep 的惰性清扫用例）；
   * 缺省内部构造。生产方不传，状态所有者仍是本模块（spec §4）。
   */
  tokens?: Map<string, RelayTokenIdentity>;
}

export function createTokenStore(options: CreateTokenStoreOptions = {}): TokenStore {
  const now = options.now ?? Date.now;
  const tokens = options.tokens ?? new Map<string, RelayTokenIdentity>();
  /**
   * 惰性清扫（评审 token-sweep）：未消费 token 只在 consume 时删除，长期不被消费的
   * 过期项会让 Map 无界累积。借每次签发扫一遍 Map 淘汰已过期项——扫描量级=当前未消费
   * token 数（天然自界：签发速率决定），无需额外定时器。
   */
  const sweepExpired = (currentTime: number): void => {
    for (const [token, identity] of tokens) {
      // 过期判定与 consume 的 `expiresAt <= now()` 一致
      if (identity.expiresAt <= currentTime) tokens.delete(token);
    }
  };
  return {
    issue(userId, role: WebRemoteControlRelayV2Role) {
      const currentTime = now();
      sweepExpired(currentTime);
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      tokens.set(token, { userId, role, expiresAt: currentTime + TOKEN_TTL_MS });
      return { token, expiresIn: 60 };
    },
    consume(token) {
      const identity = tokens.get(token);
      if (identity === undefined) return undefined;
      // 消费即删（spec §5.2 规则 2）：无论后续是否命中有效期，token 都已消费，不复存在
      tokens.delete(token);
      // 过期判定与 fake relay 的 `expiresAt <= now()` 一致：过期视同未知，返回 undefined
      if (identity.expiresAt <= now()) return undefined;
      return identity;
    },
  };
}
