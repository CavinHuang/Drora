import assert from "node:assert/strict";
import test from "node:test";
import {
  attemptPair,
  buildPairingUrl,
  createPairingCoreState,
  isSessionTokenValid,
  issuePairTicket,
  parsePairingPath,
  pickLanAddress,
} from "../src/main/desktopMobilePairingCore.js";

// 对齐原版后配对票据无 TTL：等待配对停留在 awaiting-pair（原版 relay pair_status
// 停留在 waiting），令牌一次性使用；停止时机归 Main 侧宿主。

test("配对令牌一次性：配对成功后同一令牌拒绝重放", () => {
  let state = createPairingCoreState();
  const issued = issuePairTicket();
  state = issued.state;

  const paired = attemptPair(state, issued.ticket.pairToken, 1000);
  assert.ok(paired.ok);
  assert.equal(paired.state.phase, "paired");
  assert.ok(paired.sessionToken);

  // 同一令牌第二次配对：票据已消费，拒绝。
  const replay = attemptPair(paired.state, issued.ticket.pairToken, 2000);
  assert.ok(!replay.ok);
  assert.equal(replay.failure, "unknown-token");
});

test("未知令牌拒绝配对并区分失败原因", () => {
  let state = createPairingCoreState();
  state = issuePairTicket().state;

  const unknown = attemptPair(state, "deadbeef".repeat(4), 1000);
  assert.ok(!unknown.ok);
  assert.equal(unknown.failure, "unknown-token");
});

test("已配对后新配对票据踢掉旧会话", () => {
  let state = createPairingCoreState();
  const issued = issuePairTicket();
  state = issued.state;
  const paired = attemptPair(state, issued.ticket.pairToken, 1);
  assert.ok(paired.ok && paired.sessionToken);

  // 换机场景：重新生成票据并配对成功，旧会话令牌随之失效。
  const second = issuePairTicket();
  assert.equal(second.state.phase, "awaiting-pair");
  const kicked = attemptPair(second.state, second.ticket.pairToken, 3);
  assert.ok(kicked.ok && kicked.sessionToken);
  assert.ok(!isSessionTokenValid(kicked.state, paired.sessionToken!));
  assert.ok(isSessionTokenValid(kicked.state, kicked.sessionToken!));

  assert.ok(!isSessionTokenValid(paired.state, "f".repeat(64)));
});

test("LAN 地址优先 192.168 段并排除虚拟网卡", () => {
  const picked = pickLanAddress({
    "vEthernet (WSL)": [{ address: "172.20.0.1", family: "IPv4", internal: false }],
    以太网: [{ address: "192.168.1.8", family: "IPv4", internal: false }],
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  });
  assert.ok(picked);
  assert.equal(picked.address, "192.168.1.8");

  const fallback = pickLanAddress({
    eth0: [{ address: "172.16.5.5", family: "IPv4", internal: false }],
  });
  assert.ok(fallback);
  assert.equal(fallback.address, "172.16.5.5");

  const loopbackOnly = pickLanAddress({
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  });
  assert.equal(loopbackOnly, null);
});

test("配对路径解析只接受 32 位 hex 令牌", () => {
  assert.equal(
    parsePairingPath("/p/abcdefabcdefabcdefabcdefabcdefab"),
    "abcdefabcdefabcdefabcdefabcdefab",
  );
  assert.equal(parsePairingPath("/p/short"), null);
  assert.equal(parsePairingPath("/p/../etc"), null);
  assert.equal(parsePairingPath("/index.html"), null);
});

test("配对 URL 使用 LAN 地址与随机端口", () => {
  assert.equal(
    buildPairingUrl({ address: "192.168.1.8", port: 45678, pairToken: "ab".repeat(16) }),
    "http://192.168.1.8:45678/p/abababababababababababababababab",
  );
});
