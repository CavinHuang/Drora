// 一次性 token 存储单测（specs/relay-v2-server.md §5.1 规则 2/§5.2 规则 2，行为参照
// fake-relay-v2.ts；评审 token-sweep 补惰性清扫覆盖）。
// 覆盖：签发形态（22 字符 base64url、expires_in 60）、消费即删、过期拒收、
// issue 惰性清扫（已过期项被淘汰、未过期保留——Map 收缩）。
// 红线：token 本体不落日志（本文件不打印任何 token 值）。

import { describe, expect, it } from "vitest";
import { createTokenStore } from "../src/tokens.js";
import type { RelayTokenIdentity } from "../src/types.js";

describe("TokenStore 基础语义（spec §5.1 规则 2 / §5.2 规则 2）", () => {
  it("签发 22 字符 base64url、expires_in 60；消费即删；过期视同未知", () => {
    let nowMs = 1_700_000_000_000;
    const store = createTokenStore({ now: () => nowMs });
    const issued = store.issue("alice", "device");
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(issued.expiresIn).toBe(60);
    expect(store.consume(issued.token)).toEqual({
      userId: "alice",
      role: "device",
      expiresAt: nowMs + 60_000,
    });
    // 消费即删：同一 token 二次消费为未知
    expect(store.consume(issued.token)).toBeUndefined();
    // 过期（expiresAt <= now）视同未知
    const late = store.issue("alice", "terminal");
    nowMs += 60_000;
    expect(store.consume(late.token)).toBeUndefined();
  });
});

describe("issue 惰性清扫（评审 token-sweep）", () => {
  it("清扫只针对已过期项：未过期 token 在清扫后仍可正常消费", () => {
    let nowMs = 1_700_000_000_000;
    const backing = new Map<string, RelayTokenIdentity>();
    const store = createTokenStore({ now: () => nowMs, tokens: backing });

    const first = store.issue("alice", "device").token; // t0
    const second = store.issue("alice", "terminal").token; // t0
    expect(backing.size).toBe(2);

    nowMs += 30_000;
    const alive = store.issue("alice", "device").token; // t0+30s，有效期至 t0+90s
    expect(backing.size).toBe(3);

    nowMs += 31_000; // t0+61s：first/second 已过期（60s），alive 仍有效（90s）
    const fresh = store.issue("bob", "device"); // 签发触发惰性清扫
    // 两个过期项被清扫：Map 从 3 收缩到 2（alive + fresh）
    expect(backing.size).toBe(2);
    expect(backing.has(first)).toBe(false);
    expect(backing.has(second)).toBe(false);
    expect(backing.has(alive)).toBe(true);
    expect(backing.has(fresh.token)).toBe(true);
    // 清扫不影响语义：alive 仍可正常消费
    expect(store.consume(alive)).toMatchObject({ userId: "alice", role: "device" });
  });
});
