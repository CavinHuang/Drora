// 还原自发行 bundle（官方 3.17.2 / 0.6.5）：IPC 版本 2→3。官方 SEA 证据：
// `var CUA_BROKER_IPC_VERSION = 3`（broker/ipcVersion.js，SEA offset ~85211750 区），
// 鉴权/ping 双门语义不变（clientVersion > 服务端版本才拒，老客户端 v2 兼容）。
// v3 客户端（zcode-cua-0.6.5.index.js 切段，CUA_BROKER_IPC_VERSION=3）配 v2 服务端会被
// version_mismatch 拒——本 bump 是 P3 切段落地的配套必改（specs/cua-3.17.2-alignment.md P4）。
export var CUA_BROKER_IPC_VERSION = 3;
