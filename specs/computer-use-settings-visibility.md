# 电脑控制设置分区可见性（对齐原版 3.14.3）

用户报告：Drora 桌面端设置里没有"电脑控制"，内置插件列表也看不到 computer-use。
对照原版 3.14.3 发行物 renderer（`D:\software\ZCode\resources` app.asar）实测其隐藏集合为：

```js
new Set([`automations`, `plugins`, `workspaceFileSearch`]); // 不含 computerUse
```

而本仓库 `HIDDEN_SETTINGS_SECTIONS`（开源 drop 872ad96 引入）多含 `computerUse`，
与 `settingsPageConfig.ts` 的既有设计注释（"macOS/Windows/Linux 必须继续通过
createSettingsPageConfig 动态加入 Computer Use"）自相矛盾，导致桌面端永远不渲染该分区。

## 产品规则

- 桌面端（macOS/Windows）：设置页显示"电脑控制"分区（`groupId: basics`，紧跟"浏览器"），
  内容 = 插件启用开关 + 输入框入口显隐 + 平台可用性说明。
- Web/Linux：不显示该分区（`SETTINGS_SECTIONS` 静态过滤 + `createSettingsPageConfig`
  的 `showComputerUse` 门控双层排除）。
- computer-use 插件**默认安装但默认关闭**（`official-plugin-definitions.ts` 记录的产品决策，
  原版一致：`computerUseComposerEntryHidden` 默认 true）；启用入口就是本分区。
- 插件 seed/discovery 层的门控（`bundled-plugins.ts` 的
  `isDroraCuaInternalFeatureEnabled`）保持不变：flag 默认开，packaged 应用正常 seed。

## 状态所有者

- 分区路由/隐藏集合：`packages/ui/src/lib/settingsNavigation.ts`（唯一所有者）。
- 分区平台可见性：`packages/ui/src/settings/settingsPageConfig.ts`（isDesktop 等平台事实）。
- 分区内容：`packages/ui/src/settings/ComputerUseSection.tsx`。
- 插件启停/seed：bootstrap `bundled-plugins.ts` + `official-plugin-definitions.ts`（不改）。

## 验收

1. `packages/ui/test/computerUseSettingsNavigation.test.ts`：
   computerUse 不在隐藏集合、Web 静态配置排除、桌面配置包含。
2. 桌面端设置页出现"电脑控制"分区；输入框 CUA 入口的"打开设置"深链能直达该分区。
3. 插件页"已安装"分组仍列出 computer-use（默认关闭态，可开）。
