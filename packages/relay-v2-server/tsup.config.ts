import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "relay-v2-server": "src/index.ts" },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  // spec §3：Node ≥24（node:sqlite DatabaseSync 内置可用），与工具链钉版 node 24.14.0 对齐。
  target: "node24",
  sourcemap: true,
  splitting: false,
  // node:sqlite 只有带前缀的内置入口；与 drora-server-cli 同款保留 node: 前缀，
  // 防止打包器去掉 node: 后错误解析到第三方 sqlite 包。
  removeNodeProtocol: false,
  // @drora/shared 的 exports 指向 TS 源码（workspace:*），必须内联打包 dist 才可独立部署
  // （spec §13：tsup 打出零 workspace 源码依赖的可部署 dist，Docker 只消费产物）。
  // zod 是 web-remote-relay 契约模块的唯一外部依赖（spec §13），随内联一起进产物；
  // ws 保持默认 external，由部署闭包提供（对照 drora-server-cli 先例）。
  noExternal: ["@drora/shared", "zod"],
});
