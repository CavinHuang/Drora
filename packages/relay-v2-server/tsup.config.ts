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
  // ws 并入 noExternal（spec §8.6/§13 v2.4）：dist 全自包含——standalone 单容器 runtime
  // 只需 dist + deploy/run-relay.mjs 引导 + 静态产物，无需任何 node_modules 闭包。
  // banner 必须注入 createRequire：ws 是 CJS 包，内联进 ESM 产物后其内部 `require("events")`
  // 等内置模块调用被 esbuild 转为 __require 助手，该助手在 ESM 上下文（无 require 全局）会抛
  // 「Dynamic require of "events" is not supported」——banner 给产物顶层补模块级 require 绑定
  // 后助手可用（shims: true 对 node 目标注入的是空 shim，进程冒烟实测无效，故用 banner）。
  noExternal: ["@drora/shared", "zod", "ws"],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
});
