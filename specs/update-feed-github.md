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

---

## macOS 发布签名身份（2026-09-27 用户裁定：自签名过渡）

### 背景

ad-hoc 签名使 Squirrel.Mac 自动更新在结构上不可用。macOS 更新链路的最后一环由
原生 Squirrel.Mac 完成「解压 → 以 host 的 designated requirement 校验更新包
签名 → 换身 → 重启」；ad-hoc host 的 requirement 锚定**单一构建的 cdhash**
（`identifier "dev.drora.app" and cdhash H"<当前构建>"`），任何不同构建——
包括内容完全正确的新版本——校验必然失败。实测（0.0.2 → 0.0.3）两次显式
quitAndInstall 与一次后台 staging 均报
`SQRLCodeSignatureErrorDomain code -1`（"code failed to satisfy specified
code requirement(s)"）。链路其余环节（manifest 检查、下载/差分、状态机、
退出准备）均正常，仅此一环被堵。

### 决策

- 采用**自签名 Code Signing 证书**（CN 稳定、代码签名 EKU、导入 login
  keychain 并信任）作为过渡发布身份。构建经既有
  `CSC_NAME`（或 `APPLE_SIGNING_IDENTITY`）+ `DRORA_ENABLE_MAC_SIGN=1`
  通道启用，electron-builder 以真实身份签名并自动跳过路线 A 的 afterSign
  adhoc 重签，无需新接线。
- requirement 随之从 cdhash 锚变为证书锚
  （`identifier ... and certificate leaf[subject.CN] = "<CN>"`），跨构建
  稳定：同证书签名的所有后续版本校验必过，自动更新链自续。
- **范围界定**：本决策只覆盖桌面 app 主体的自更新链与主 app TCC 持久化
  （TCC 授权主体随证书稳定，更新后不再重授）。CUA Helper 的官方严格链
  （Developer ID + TeamID `8A5X4JJ39T` 锚）不因自签名恢复，
  路线 A（specs/mac-cua-helper-app-alignment.md §七.0a）保持不变；
  自有 Developer ID + 公证仍为待定终态（§七.2）。
- **过渡代价（一次性，如实）**：现网 ad-hoc 已装包（≤ 0.0.3）的
  requirement 锚死 adhoc cdhash，对任何重签名版本校验必败——该批用户须
  **手动安装首个自签名版本一次**，此后自动更新自续。证书日后更换将重演
  同样的手动过渡；证书有效期即更新链寿命（到期前须以新证书重签存量基座）。

### 不变量

- 打包产物集合、publish（github provider）、通道清单双架构合并策略不变。
- 无证书环境（`DRORA_ENABLE_MAC_SIGN` 未置）默认构建仍走路线 A adhoc。

### 验收

1. `security find-identity -v -p codesigning` 列出有效自签名身份。
2. 签名包 `codesign -d -r-` 的 designated requirement 为证书锚
   （含 `certificate leaf`），非 cdhash 锚。
3. Squirrel 等价校验：以第一构建的 requirement 校验第二构建
   （`codesign --verify -R=<第一构建 requirement> <第二构建>`）通过。

### 实施记录（2026-09-27）

- 证书：CN=`Drora Desktop Signing`，O=Drora，RSA-3072，有效期
  2026-09-27 → 2036-09-24，`extendedKeyUsage=codeSigning`；经
  `openssl pkcs12 -export -legacy`（macOS `security` 不认 OpenSSL 3 默认的
  AES-256 p12 MAC，导入报 "MAC verification failed"）导入 login keychain，
  `security add-trusted-cert -p codeSign` 信任。私钥仅存本机钥匙串。
- 本地验证全部通过：`find-identity -v` 列出身份；测试签名 DR 为
  `certificate root = H"8287008F…"`（证书本体 SHA-1，跨构建稳定）；
  不同内容双构建 Squirrel 等价校验（`codesign -v -R=`）PASS。
- 构建接线：既有 `CSC_NAME` + `DRORA_ENABLE_MAC_SIGN=1` 通道直接生效，
  无需改 electron-builder 配置（afterSign adhoc 分支按既有开关自动跳过）。
  注意：该开关**只**切换 app 主体的签名身份，不改变 CUA Helper 分发路线——
  路线 A 折叠（`CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1`）默认恒生效，
  仅 `DRORA_CUA_HELPER_STRICT_CHAIN=1`（Developer ID 终态 + v2 整体还原）
  关闭（specs/mac-cua-helper-app-alignment.md §七.0a/§七.2）。
- CI：release.yml 新增可选签名段——配置
  `MAC_SIGNING_CERT_P12_BASE64` / `MAC_SIGNING_CERT_PASSWORD` 两个 secret
  后，mac 构建位导入 p12 至临时 keychain 并以
  `CSC_NAME="Drora Desktop Signing" DRORA_ENABLE_MAC_SIGN=1` 签名；
  secret 留空时维持无签名/路线 A adhoc 现状，行为不变。

### 上线步骤（签名链切换，一次性）

1. 把 p12（连同密码）配置为仓库 secrets `MAC_SIGNING_CERT_P12_BASE64` /
   `MAC_SIGNING_CERT_PASSWORD`（本机导出：
   `security export -k login.keychain-db -t secs -f pkcs12 -o drora.p12`，
   GUI 亦可）。
2. 打 tag 走 release.yml（或本地 `CSC_NAME` + `DRORA_ENABLE_MAC_SIGN=1`
   构建后手工发布），产出重签名安装包与 latest-mac.yml。
3. 所有 ad-hoc 存量用户（含本机 0.0.2）**手动下载安装该重签名版本一次**
   ——旧包的 requirement 锚死 adhoc cdhash，对重签名版本校验必败，这是
   唯一一次手动过渡；此后自动更新自续。
4. 证书更换/过期（2036 前需滚动）将重演步骤 3 的手动过渡；换机构建需先
   导出 p12 并在目标机导入 + 信任。

---

## macOS quitAndInstall 失败恢复（2026-09-27）

### 背景

安装器失败发生在退出准备完成之后：`quitAndInstallUpdate` 先执行
`onBeforeQuitAndInstall`（回收 host/agent、`markForceQuit`、
`hasPreparedAppQuit=true`），再把控制权交给 electron-updater。macOS 上
Squirrel 的安装任务异步执行，失败经 `error` 事件迟到（实测 ~9s），
且只走常规失败收敛（清 ready 回 idle、静默广播）。应用就此停留在
「该退未退、资源已回收」的半退出态：更新入口消失、后续点击静默 no-op、
遗留退化幽灵窗口（实测 0×33），用户视角即「点了没反应」。

### 决策

- `initAutoUpdater` 新增 `onQuitAndInstallFailed(error)` 回调。**仅当
  用户已显式请求 quitAndInstall 之后** electron-updater 在退出前上报
  error 时触发（一次性；重复 error 不重复触发）。
- desktop main 接线：`dialog.showErrorBox`（原生弹窗，不依赖 renderer
  存活）按当前 locale 告知「更新安装失败、应用将退出」，用户确认后
  `exitPreparedApp("auto-update-install-failed")` 完成退出。
- 不选「回滚退出准备」：`prepareAppQuit` 的清理不可逆（cron 调度器置空、
  telemetry 已停、forceQuit 已标记），半存活态比干净退出更危险；
  干净退出后用户重开即恢复（更新仍会被再次发现与下载）。

### 不变量

- 后台 staging 失败（无 quitAndInstall 请求）行为不变：静默收敛、不打断
  用户（官方形态同构，正常签名环境几乎不触发）。
- 退出准备先行于安装器的时序不变（Windows resources/glm 文件锁约束）。
- dev 态 relaunch fallback 分支不触发本回调。

### 验收

1. 单测：请求安装后收到 error → 恰好一次触发回调且常规收敛不再改写状态；
   未请求安装时 error 不触发回调。
2. `pnpm typecheck`、`pnpm lint` 回基线。
