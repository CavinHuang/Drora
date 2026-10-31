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
# ## 构建验证状态（2026-10-23 实测，docker 28.0.4 / Docker Desktop，daemon 内存 8GB）
#
# 首次真实 build + 容器级验证已完成：镜像构建成功；容器内逐项通过——healthz 五字段、
# /remote/v4 页面与资产 200、无凭据 401、穿越 403、stub 鉴权全流程（注册→device waiting
# →terminal matched→matched 推送 terminal_sid=""→data 透传）。
# 构建期间修复并已固化的三件事（后续维护者遇到同类问题先查这里）：
# ① buildkit 对「阶段前重声明 ARG 再 FROM」误判 ARG 未声明——两个基础镜像 ARG 已提升
#    到首个 FROM 前的全局作用域（全局 ARG 对所有 FROM 生效）；
# ② 过滤安装的 filter 尾缀 `...` 必须保留——否则传递工作区包（ui）不建 node_modules
#    链接，vite 解析 @drora/shared 子路径失败；
# ③ 国内网络 Docker Hub/npmjs 不可达时用 NODE_*_IMAGE/NPM_REGISTRY 切镜像源（compose
#    已透传；本机验证即经 docker.m.daocloud.io 完成）。
#
# ## 运行时形态
#
# - TLS 不由本容器终止：由外部入口（用户自己的 ingress/反代/云 LB）终止后回源 8080，
#   或局域网明文直连（选择指引与前提见 docker-compose.standalone.yml 头注释）。
# - BIND_HOST=0.0.0.0：容器内必须绑全部网卡，否则 docker 端口映射不可达——这与仓库默认
#   127.0.0.1（预期客户端是本机反代，spec §9）不同，是容器形态的必需差异。
# - dist 全自包含（tsup noExternal 内联 @drora/shared+zod+ws，spec §13）：runtime 阶段
#   无任何 npm install，只需 dist + 引导脚本 + 静态产物三件。

# 基础镜像可替换（spec §8.6）：国内网络对 docker.io 的直连/元数据解析不稳时，
# compose 传镜像源形态（如 docker.m.daocloud.io/library/node:24.14.0-bookworm）。
# 缺省保持官方路径。两个 ARG 必须都在首个 FROM 之前的全局作用域声明：本环境 buildkit
# （dockerd 内置 v0.20.2 与 buildx 容器 v0.33.1 实测一致）对「阶段前重声明 ARG 后再
# FROM」会误判 ARG 未声明（UndefinedArgInFrom/blank base），全局 ARG 对所有 FROM
# 生效是文档化行为，规避之（v4 复现→全局化 PASS）。
ARG NODE_BUILD_IMAGE=docker.io/library/node:24.14.0-bookworm
ARG NODE_RUNTIME_IMAGE=docker.io/library/node:24.14.0-slim
FROM ${NODE_BUILD_IMAGE} AS build
# node 24.14.0 与仓库工具链（mise.toml）及 tsup target=node24 对齐（spec §3）。
WORKDIR /repo

# npm 源可替换（spec §8.6）：国内拉包慢/超时时传 https://registry.npmmirror.com。
# COREPACK_NPM_REGISTRY 供 corepack prepare 拉 pnpm；npm config 供后续 pnpm install。
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY
RUN npm config set registry "$NPM_REGISTRY"

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
# filter 尾缀 `...` 必不可少：它选中依赖闭包内的全部工作区包并为每个创建 node_modules
# 链接（首版无尾缀时 ui 只作为传递依赖被装入虚拟库、自身 node_modules 不建链接，
# vite 从 ui 源码解析 @drora/shared 子路径失败——评审 standalone build 实证）。
# --frozen-lockfile：lockfile 与 manifests 已一致（此前的 ui react-popper 失配已随
# 后续 install 写回 lockfile 修齐），镜像构建期锁定依赖保证可复现；若未来再现失配，
# frozen 会直接报 lock 不一致——修 lockfile 而不是删掉本参数。
RUN pnpm install --frozen-lockfile --filter @drora/relay-v2-server... --filter @drora/web...

# 1) relay 服务端 dist（tsup，自包含产物）
RUN pnpm --filter @drora/relay-v2-server run build

# 2) /remote/v4 手机页静态（vite 构建）。
# DRORA_PUBLIC_ORIGIN 是唯一部署侧输入，同时注入两个键——spec §8.2 实测注记：web 包的
# vite define 链消费**无 VITE_ 前缀**的 DRORA_ENDPOINT_ORIGIN，只设 VITE_ 变量时 OAuth
# redirect 仍会静默烘焙官方默认域 zcode.z.ai。产物形态由 relay 包 tools/verify-v4-build.mjs
# 的判别逻辑背书（base=/remote/v4/ 前缀 + 自建域 redirect 烘焙）。
ARG DRORA_PUBLIC_ORIGIN
# 自建页 OAuth 应用（spec §8.5/§8.7）：官方 client_id 的 redirect 白名单不含任意自建域，
# 自有 OAuth 应用经这里透传烘焙；缺省沿用官方公开值（与桌面对齐）。
ARG VITE_ZAI_OAUTH_CLIENT_ID
ARG VITE_BIGMODEL_OAUTH_APP_ID
ENV VITE_DRORA_ENDPOINT_ORIGIN=${DRORA_PUBLIC_ORIGIN} \
    DRORA_ENDPOINT_ORIGIN=${DRORA_PUBLIC_ORIGIN} \
    VITE_ZAI_OAUTH_CLIENT_ID=${VITE_ZAI_OAUTH_CLIENT_ID} \
    VITE_BIGMODEL_OAUTH_APP_ID=${VITE_BIGMODEL_OAUTH_APP_ID}
RUN pnpm --filter @drora/web exec vite build --base=/remote/v4/

# ————— runtime：仅三件运行闭包 —————
FROM ${NODE_RUNTIME_IMAGE}
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
RUN mkdir -p /data /home/node/data && chown node:node /data /home/node/data
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
