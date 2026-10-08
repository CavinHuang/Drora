// broker/server 公共出口（契约见 ./broker-server.d.ts）。
// 实现在 src/broker/server/（发行 bundle 还原），由该目录的 index.ts 统一映射为契约名。
export * from "./broker/server/index.js";
