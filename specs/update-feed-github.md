# 自动更新源切换 GitHub Release Spec

## 背景

强制升级门控移除后（见 specs/force-update-gate-removal.md），常规自动更新仍走
上游 manifest provider（`zcode.z.ai` 的 client/configs 下发更新清单）。Drora 的
更新源应为本仓库的 GitHub Release：安装包与 `latest*.yml` 通道清单已由 CI 产出。

## 决策

- electron-builder `publish` 从 generic 占位切换为
  `{ provider: "github", owner: "CavinHuang", repo: "Drora" }`；打包产物内嵌的
  `app-update.yml` 由此生成，electron-updater 内置 GitHub provider 直接消费。
- 删除桌面主进程的服务端 manifest provider（`manifestUpdateProvider.ts`、
  `applyManifestUpdateProvider`、`DRORA_UPDATE_FEED_URL`/`--drora-update-feed-url`
  dev 覆盖链、`deviceMid`/`resolveEndpointOrigin` 更新遥测参数）。
- 通道清单双架构合并：两个桌面构建位的 latest*.yml 各自只含本架构资产；
  非 arm64 构建位改名 `latest-*-x64.yml`上传，release job 合并回单一`latest.yml`/`latest-mac.yml`（electron-updater 按 `files[].url` 的架构后缀
  选择下载资产），保证 x64/arm64 自动更新都可用。

## 不变量

- 更新检查的用户入口（菜单"检查更新"、启动轮询、下载/安装流程）不变。
- Preview/dev 构建不检查更新（`canUseAutoUpdaterInCurrentRuntime`）不变。
- Release 资产集合不变（latest\*.yml 仍各只有一份，内容为双架构合并）。

## 验收

1. `pnpm typecheck`、`pnpm lint` 回基线；desktop 构建成功。
2. 打包产物内 `app-update.yml` 为 github provider（owner=CavinHuang, repo=Drora）。
3. Release 的 latest\*.yml 含双架构 `files` 条目且 sha512 与资产一致。
