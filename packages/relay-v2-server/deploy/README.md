# Relay V2 Server 部署与运维

协议与设计权威:`specs/relay-v2-server.md`;配置全量语义:其 §9。本文件只收运维操作。

## 两种部署形态

| | standalone(`docker-compose.standalone.yml`) | 双服务(`docker-compose.yml`) |
| --- | --- | --- |
| 组成 | 单容器:远控 API+WS+手机页静态+官方回源 | relay 容器 + Caddy 容器(静态挂载+catch-all 回源) |
| TLS | **外部终止**(自建 ingress/反代/云 LB)或 LAN 明文 | Caddy 容器内自动 HTTPS(ACME) |
| 适用 | NAS/家庭服务器/最小依赖单机 | 公网部署、要自动签发续期证书 |

两形态共用同一份 `Dockerfile` 与 `deploy/run-relay.mjs` 装配引导(构建配方单一出处);
行为差异经 env 关闭:双服务形态 `STATIC_ROOT=""`、`OFFICIAL_UPSTREAM_ORIGIN=""`
(静态与回源归 Caddy),standalone 默认开启。

## 快速开始(standalone)

```sh
cd packages/relay-v2-server/deploy
echo 'DRORA_PUBLIC_ORIGIN=https://你的自建域' >> .env   # 必填:OAuth redirect 构建期烘焙
# 可选:自有 OAuth 应用(spec §8.5——官方 client_id 的 redirect 白名单不含任意自建域;
# 在 ZAI/BigModel 登记自有应用并拿到 client_id/appId 后在这里透传烘焙):
# echo 'VITE_ZAI_OAUTH_CLIENT_ID=client_你的值' >> .env
# echo 'VITE_BIGMODEL_OAUTH_APP_ID=你的appId' >> .env
docker compose -f docker-compose.standalone.yml up -d --build
docker compose -f docker-compose.standalone.yml ps      # 等 healthy
curl -s http://127.0.0.1:8080/healthz                   # 五字段运维视图
```

国内网络 Docker Hub/npmjs 直连不稳时,`.env` 追加镜像源(Dockerfile ARG 已参数化):

```sh
echo 'NODE_BUILD_IMAGE=docker.m.daocloud.io/library/node:24.14.0-bookworm' >> .env
echo 'NODE_RUNTIME_IMAGE=docker.m.daocloud.io/library/node:24.14.0-slim' >> .env
echo 'NPM_REGISTRY=https://registry.npmmirror.com' >> .env
```

## 快速开始(双服务,Caddy 自动 TLS)

```sh
cd packages/relay-v2-server/deploy
# 1) 手机页静态(Caddy 挂载点;OAuth 烘焙需双 env,见 spec §8.2 实测注记)
#    自有 OAuth 应用(spec §8.5):VITE_ZAI_OAUTH_CLIENT_ID=client_你的值 \
#    VITE_BIGMODEL_OAUTH_APP_ID=你的appId 一并带入构建
VITE_DRORA_ENDPOINT_ORIGIN=https://自建域 DRORA_ENDPOINT_ORIGIN=https://自建域 \
  pnpm build:web-remote-control:v4
cp -R ../../packages/web/dist/. web-remote-control/
# 2) .env:SITE_ADDRESS=真实域名 + JWT 配置(多用户必须 introspect/jwks)
# 3) 启动
docker compose -f docker-compose.yml up -d --build
```

前置:自建域 `https://自建域/remote/v4` 必须在 ZAI/BigModel OAuth 应用回调白名单
(authorize 与 token exchange 两步都校验,spec §8.4)。

## 桌面端指向自建 relay

设置项 `webRemoteControlRelayOrigin`(远控弹窗 → Relay 服务 → 自建)填入
`https://你的自建域` 后保存,桌面会停止当前远控并按新源重连(spec §8.7)。
官方默认形态无需任何配置。

## 日志

```sh
docker compose -f docker-compose.standalone.yml logs -f relay
```

结构化 JSON Lines;级别经 `LOG_LEVEL`,消息级 trace 经 `MSG_TRACE`(默认关,启用时
仅摘要字段、永不落 payload 正文——红线见 `docs/web-remote-control-relay-message-logging.md`)。

## 备份与恢复

```sh
./backup.sh                    # VACUUM INTO 一致性快照到卷内 backups/(可与在线服务并发)
docker compose -f docker-compose.standalone.yml cp relay:/data/backups/<文件> .
```

红线:禁止直接 `cp` 运行中的 WAL 库(可能撕裂);恢复=停服务后以备份文件替换
`DB_PATH` 指向的库再启动(丢库等价于全部设备重新注册,桌面端会自动恢复)。

## 升级流程

桌面 App 升级后:重建手机页镜像(standalone:`docker compose build` 即可——
`DRORA_PUBLIC_ORIGIN` 不变时页面随镜像更新)并重启;数据库不动,桌面 SID 与
二维码保持有效(spec §7)。双服务形态需同步重拷 Caddy 挂载的静态产物(上方
快速开始第 1 步)后重启 Caddy。

## 健康与诊断

- `/healthz`(容器内 127.0.0.1 探活;公网直暴默认关闭):uptime/连接数/owner 数/
  设备行数/每连接收发计数——「桌面发了但手机没收到」类问题先看两侧计数器差值。
- 手机 401=登录态失效(客户端清会话回登录);503=relay 到官方 userinfo 不可达
  (可重试,不清会话);DEVICE_OFFLINE=桌面端断开(15 秒宽限重连)。
