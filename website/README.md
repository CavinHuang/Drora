# Drora 产品官网（website/）

仿照官方 ZCode 营销站（https://zcode.z.ai/）设计语言的全静态产品站点，部署在 GitHub Pages。
纯 HTML + CSS + 原生 JS，无构建步骤、无运行时依赖。产品规则与验收场景见 `specs/website.md`。

## 本地预览

```bash
# 任选一种静态服务器
npx serve website
# 或
python3 -m http.server 8000 --directory website
```

## 目录结构

```text
website/
├── index.html              # 单页：Header / Hero（DOM 窗口模拟）/ 三形态 / 能力 / 下载 / Footer
└── assets/
    ├── css/style.css       # 设计令牌与全部样式（暗色 #161616 主题）
    ├── js/main.js          # 中英 i18n 字典、语言切换、平台检测 CTA、滚动显现
    ├── favicon.svg         # 复制自 packages/desktop/assets/Drora-desktop-app-icon.svg
    ├── icon.png            # 复制自 packages/desktop/assets/Drora-desktop-app-icon.png
    └── pets/*.webp         # 复制自 packages/desktop/assets/desktop-pet-catgirls/*/idle-atlas.webp
```

## 发布新版本时同步更新下载链接

下载行使用 GitHub Releases 的 `releases/latest/download/Drora-<version>-<platform>-<arch>.<ext>`
地址，文件名必须与 `.github/workflows/release.yml` 产物命名一致。发新版本时：

1. 在 `index.html` 中全局替换旧版本号（如 `3.14.3` → 新版本）；
2. 确认 `packages/desktop/package.json` 的 `version` 已同步；
3. 若新增平台/架构，同步新增下载行，并核对 `electron-builder.config.js` 的 `artifactName`。

## 部署

推送 `main` 且 `website/**` 有变更时，`.github/workflows/deploy-website.yml` 自动发布到 Pages；
也可在 Actions 页手动触发（workflow_dispatch）。仓库 Settings → Pages → Source 需选择
「GitHub Actions」。站点资源全部使用相对路径，兼容 `https://<owner>.github.io/Drora/` 子路径。
