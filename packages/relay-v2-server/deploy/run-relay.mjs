// Relay V2 单一装配引导（specs/relay-v2-server.md §10/§13）。dist 产物只导出装配函数、
// 无内置 main（src/index.ts 仅 export），「env → JWT 鉴权 → 监听 + 信号停机」的启动接缝
// 只有这一份：生产容器（deploy/docker-compose.yml）、进程冒烟（tools/smoke-process.mjs）
// 与同源冒烟（tools/verify-same-origin.mjs）三处复用本文件，不再各自内嵌同形脚本——
// 引导逻辑分叉即装配分叉，冒烟验证过的启动路径必须与生产逐字相同。
//
// 用法：
//   生产：node deploy/run-relay.mjs（config 全部来自进程 env，spec §9）
//   冒烟：RELAY_READY_PORT_PREFIX=<前缀> node deploy/run-relay.mjs——监听就绪后向 stdout
//         输出「<前缀>=<端口>」一行，供冒烟工具确认子进程存活并取得实际端口（生产不设
//         该 env，不产生额外输出，stdout 只剩结构化日志）。
// 停机：SIGTERM/SIGINT → handle.stop() 优雅停机（§5.3：停收新连接 → error INTERNAL →
//         flush → 退出；docker stop 的默认 SIGTERM 即触发）。
//
// import 路径说明：本文件按包内相对布局引用 ../dist/relay-v2-server.js（deploy/ 的上级即
// 包根）；容器内镜像层按同布局复制为 /app/deploy/run-relay.mjs + /app/dist/（见 compose
// dockerfile_inline），相对路径在两侧解析一致。dist 缺失时 import 即失败——冒烟工具在
// spawn 前另有产物存在性前置检查给出可执行提示。
import { createJwtAuth, createRelayServer, loadConfigFromEnv } from "../dist/relay-v2-server.js";

const config = loadConfigFromEnv(process.env);
const handle = await createRelayServer({ config, auth: createJwtAuth({ config }) });

const readyPrefix = process.env.RELAY_READY_PORT_PREFIX;
if (typeof readyPrefix === "string" && readyPrefix.length > 0) {
  process.stdout.write(`${readyPrefix}=${handle.port}\n`);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    void handle.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
