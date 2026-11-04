# 强制升级门控移除 Spec

## 背景与决策

桌面端启动时（production + 已打包构建）请求 `DRORA_ENDPOINT/api/v1/client/configs`，
按远端 `forceUpdate.minimalVersion` 阻断主窗口（"需要升级"弹窗 → 自动/手动升级 → 退出）。
该门控是上游产品的旧版本 kill switch。Drora 版本线自 0.0.1 起**必然小于**上游
minimalVersion：正式包装上即被拦，弹窗内的"自动升级"还会拉取上游二进制覆盖 Drora。
上游远端配置对 Drora 无管辖权，故**整体移除**启动期远端强制升级门控（历史实现保留在
git 历史，Drora 未来运营自有后端时可按需恢复）。

## 移除面

| 层           | 内容                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| desktop/main | `maybeBlockStartupForForceUpdate` 调用与 `forceUpdateMainWindowCreationBlocked` 全部状态分支（canCreateWindow / open-url / second-instance / 诊断字段）、`focusForceUpdateGateWindow`                |
| desktop/main | 删除 `forceUpdateGuard.ts`、`forceUpdatePrompt.ts`                                                                                                                                                   |
| desktop/main | `autoUpdater.ts` 仅服务于强更的导出面：`requestForceAutoUpdate`、`ForceAutoUpdateState`、`notifyForceAutoUpdate` 及其监听器/进度桶；常规更新流（菜单检查/轮询/下载安装）保留                         |
| shared       | 删除 `forceUpdate.ts`（compareSemverVersions / resolveForceUpdateRequirement）及其 re-export；`remoteAppConfig.getForceUpdateMinimalVersionFromConfig`；`coding-plan-subscription.ForceUpdateConfig` |
| services     | `codingPlanSubscription.getForceUpdateConfig` 接口成员与 bigmodel provider 实现（含 `unwrapClientConfigForceUpdate`），均无消费方                                                                    |

## 不变量

- 不触碰常规自动更新（服务端 manifest provider、菜单检查、轮询、差分下载）。
- Preview/dev 构建原本就跳过 gate，行为不变；production 打包从"可能被上游拦"变为"不拦"。

## 例外：compareSemverVersions 作为通用工具回迁（2026-11-01，v3.17.1 S5 段）

上游 v3.17.1 的新消费方（`packages/ui/src/data-sync/domain/compare.ts` 的行版本比较、
`sourceServerUpdateAction` 对 `SOURCE_SERVER_LIFECYCLE_CONTROL_MIN_VERSION` 的门槛判断）
从 `@zcode/shared` 导入 `compareSemverVersions`。该函数在上游与强更门控同住
`forceUpdate.ts`，但其本身是纯 semver 比较，与"远端强制升级"语义无关。按本 spec 删除
forceUpdate.ts 后，为避免 UI 侧复制第二份实现，把该函数及其解析辅助**逐行原样**迁至
`packages/shared/src/semver.ts` 并从 shared index 导出；`resolveForceUpdateRequirement`、
`ForceUpdateRequirement`、`ForceUpdateConfig` 与 client/configs 强更链路维持删除，不随迁。

## 验收

1. 全仓无 forceUpdate 残留引用（typecheck 证明）。
2. `pnpm typecheck`、`pnpm lint` 回基线；desktop 构建成功。
3. production 打包启动不再请求 client/configs 做强更判断。

> 2026-11-04 注记（v3.17.2 合并）：上游 v3.17.2 演进恢复了 `getForceUpdateConfig` 客户端配置读取链（bigmodelCodingPlanSubscriptionProvider），与本 spec 当年的删除面并存——以最新上游为权威保留恢复版，本 spec 保留为历史裁定记录。同合并中，update-feed-github spec 的 dev 覆盖链（updateFeed.ts/resolver/env 开关）已按删除面补删收口（1b76eaaea 后续修正）。
