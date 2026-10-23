# syntax=docker/dockerfile:1
#
# Relay V2 standalone 单容器镜像（specs/relay-v2-server.md §8.6）：
# 一个镜像同时承载远控 API+WS（relay dist）、/remote/v4 手机页静态（web 包 vite 构建）
# 与官方 catch-all 回源（进程内代理，OFFICIAL_UPSTREAM_ORIGIN）。
#
# ## 构建（build context = 仓库根，编排见同目录 docker-compose.standalone.yml）
#
#   docker build -f packages/relay-v2-server/deploy/Dockerfile \
#     --build-arg DRORA_PUBLIC_ORIGIN=https://你的自建域 .
#
# DRORA_PUBLIC_ORIGIN 必填：手机页 OAuth 的 redirect_uri 在**构建期**烘焙（spec §8.2），
# 不设或设错则手机登录链路指向错误域，运行期无法纠正。
#
# ## 首次构建验证状态（如实登记）
#
# 本 Dockerfile 交付时本机 docker daemon 未运行，**尚未实际 build 过**；已验证的是：
# dist 产物自包含（隔离目录无 node_modules 可独立运行，tools/smoke-process.mjs 通过）、
# compose 语法（docker compose config -q）、静态/回源行为测试（test/static-and-proxy.test.ts）。
# 首次真实 build 如遇 workspace 图谱/网络问题，优先排查 pnpm install 过滤闭包（见下）。
#
# ## 运行时形态
#
# - TLS 不由本容器终止：由外部入口（用户自己的 ingress/反代/云 LB）终止后回源 8080，
#   或局域网明文直连（选择指引与前提见 docker-compose.standalone.yml 头注释）。
# - BIND_HOST=0.0.0.0：容器内必须绑全部网卡，否则 docker 端口映射不可达——这与仓库默认
#   127.0.0.1（预期客户端是本机反代，spec §9）不同，是容器形态的必需差异。
# - dist 全自包含（tsup noExternal 内联 @drora/shared+zod+ws，spec §13）：runtime 阶段
#   无任何 npm install，只需 dist + 引导脚本 + 静态产物三件。

FROM node:24.14.0-bookworm AS build
# node 24.14.0 与仓库工具链（mise.toml）及 tsup target=node24 对齐（spec §3）。
WORKDIR /repo

# pnpm 版本与仓库 packageManager 字段钉版一致（pnpm@10.33.2）。
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

ENV CI=1 \
    HUSKY=0

# 整仓拷贝（体积由根 .dockerignore 收敛：node_modules/dist 等不入 context）。
# 不做「只拷清单再 install」的分层缓存优化：过滤安装要求 pnpm 能解析全部 workspace
# 成员清单（@drora/web 的依赖横跨 ui/shared/services 等十余个包），逐包枚举清单脆弱
# 且本镜像无法在本机验证，正确性优先——代价是源码变更会令依赖层缓存失效，可接受
#（本镜像构建频率低，非 CI 热路径）。
COPY . .

# 过滤安装，只装 relay 服务端与 web 包的依赖闭包——避开 desktop/electron 的庞大依赖树
# 与原生构建（electron 下载、node-pty 编译等，构建容器里既慢又不需要）。
# 禁止 --frozen-lockfile：main 分支既有 @drora/ui react-popper 的 manifest/lock 失配
# （pnpm install 在 frozen 模式直接报 lock 不一致），修齐前容器内必须允许 lockfile 就地解析。
RUN pnpm install --filter @drora/relay-v2-server --filter @drora/web

# 1) relay 服务端 dist（tsup，自包含产物）
RUN pnpm --filter @drora/relay-v2-server run build

# 2) /remote/v4 手机页静态（vite 构建）。
# DRORA_PUBLIC_ORIGIN 是唯一部署侧输入，同时注入两个键——spec §8.2 实测注记：web 包的
# vite define 链消费**无 VITE_ 前缀**的 DRORA_ENDPOINT_ORIGIN，只设 VITE_ 变量时 OAuth
# redirect 仍会静默烘焙官方默认域 zcode.z.ai。产物形态由 relay 包 tools/verify-v4-build.mjs
# 的判别逻辑背书（base=/remote/v4/ 前缀 + 自建域 redirect 烘焙）。
ARG DRORA_PUBLIC_ORIGIN
ENV VITE_DRORA_ENDPOINT_ORIGIN=${DRORA_PUBLIC_ORIGIN} \
    DRORA_ENDPOINT_ORIGIN=${DRORA_PUBLIC_ORIGIN}
RUN pnpm --filter @drora/web exec vite build --base=/remote/v4/

# ————— runtime：仅三件运行闭包 —————
FROM node:24.14.0-slim
WORKDIR /app

# dist 全自包含（头注释），直接可用；run-relay.mjs 保持与仓库内相同的 /app/deploy +
# /app/dist 相对布局（其 ../dist/ import 在两侧解析一致，spec §13 单一装配引导）。
COPY --from=build /repo/packages/relay-v2-server/dist/ ./dist/
COPY packages/relay-v2-server/deploy/run-relay.mjs ./deploy/run-relay.mjs
COPY --from=build /repo/packages/web/dist/ ./public/

ENV NODE_ENV=production \
    # 容器端口映射必需：绑 127.0.0.1 会让发布的端口不可达（差异说明见头注释）
    BIND_HOST=0.0.0.0 \
    # standalone 两开关（spec §8.6/§9）：托管镜像内静态页 + 回源官方（覆盖 OAuth token
    # 交换与 Coding Plan API 等非远控路径）。回源目标可用环境变量覆盖。
    STATIC_ROOT=/app/public \
    OFFICIAL_UPSTREAM_ORIGIN=https://zcode.z.ai \
    # 设备注册表落具名卷挂载点，重启后桌面 SID 与二维码保持有效（spec §7）
    DB_PATH=/data/relay-v2.db

# 数据卷挂载点预建并归属 node 用户：首挂具名卷时 Docker 会复制镜像内目录的属主，
# 不预建则以 root 属主挂载导致 node 用户无法写 SQLite。
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data

EXPOSE 8080
# spec §9：/healthz 五字段运维面，探活走容器内 127.0.0.1（slim 无 curl/wget，用 node 自带
# fetch；端口随 LISTEN_PORT env 走，改端口无需改本文件）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (Number(process.env.LISTEN_PORT) || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# 与进程冒烟/同源冒烟/双服务 compose 共用的单一装配引导（spec §10/§13）：启动路径与
# 已验证路径逐字相同。SIGTERM/SIGINT 优雅停机由引导内接（docker stop 默认信号即覆盖）。
CMD ["node", "deploy/run-relay.mjs"]
