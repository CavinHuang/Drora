# Computer Use 对齐状态（2026-09-27 · 第 50–66 轮终态）

一页交接文档；过程档案见 `docs/cua-restoration-manifest.md`（第 50–66 轮逐轮），
产物契约与遗留决策见 `specs/mac-cua-helper-app-alignment.md`。

## 当前状态：可观测面零确认缺口

对官方 ZCode 3.14.3（本机 `/Applications/ZCode.app`；3.11.2 存档 `ZCode_副本.app`）：

| 层 | 状态 | 验证方式 |
| --- | --- | --- |
| Helper 产物（可执行/addon 125 导出/版本线 3.14.3） | ✅ 字节级 | SHA-256 + 溯源冒烟 |
| glm 内嵌插件与 darwin 原生件（koffi/sharp/libvips） | ✅ 字节级 | 种子替换 + afterSign 保真 |
| payload 可观测行为面（守卫/校验/文案/诊断） | ✅ token 级零缺口 | 跨 minify 产物 token 级比对 |
| 首用链（安装/信任/发射/身份/状态） | ✅ 双路径 live 闭环 | 五处断裂修复各有测试/live 锚 |
| 生命周期（认领超时 90s 兜底 / 闲置 300s 自眠） | ✅ 双路实测 | 直启观测 |
| 渲染层 / 权限浮窗 / main 胶水 / agent 胶水 | ✅ 逐字同构 | 全文比对（浮窗仅产品名差） |
| 认证模型 v2（token 移除/双向 peer 互验/协议 v2） | ⚠️ **签名身份门控** | spec §七.3（五面一体） |
| win32 行为面 | ⚠️ 本机不可验 | 随 win32 对齐线 |

## 分发形态（路线 A：ad-hoc）

- 包内 Helper 为自建折叠产物（`CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1`），
  buildId `drora-<版本>`；`LSEnvironment.DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1`
  贯穿 launcher 门/安装校验/live 复核（`adhocDistribution` 分支）。
- 首用自动安装至 `~/.drora/computer-use`（ZCODE_HOME 路由），meta/lock 齐备，
  buildId 变更自动重装。
- 代价（固有）：每次重打包 cdhash 变 → TCC 授权需重授。

## 复验命令

```bash
# 套件（构建→探针→契约→双轨 parity）
pnpm --filter @drora/drora-cua-helper-runtime verify:mac
# 生产形态认证链 E2E + 严格门对照
node packages/zcode-cua/test/adhoc-distribution-profile.mjs
# services 全量（含构建身份回归 4/4）
cd packages/services && node --import tsx --test test/*.node-test.mjs
# 打包（正式身份）
cd packages/desktop && DRORA_ENV=production pnpm bundle
```

构建工具链注意：volta 自带 pnpm 绑 node 18 不可用——
`PATH="$HOME/.volta/tools/image/node/24.14.0/bin:$PATH" corepack enable --install-directory /tmp/ci-bin && PATH=/tmp/ci-bin:$PATH pnpm …`

## 待用户输入的两项

1. **GUI 10 秒手工确认**：打开 App → 任开会话 → 设置 → 电脑控制 →
   徽章应为「未授权」（可点）而非「未知」→ 点「打开辅助功能设置」应弹系统设置。
   （服务端依赖链已逐环 live 验证。）
2. **签名身份裁定**（Developer ID 或自签）：解锁 v2 认证五面整体还原
   （token 链移除、clientApiVersion:2、双向原生 peer 互验、
   `--permission-broker-socket`、launcher 门回收）——spec §七.2/3。

## 工作树

第 50–58 轮代码 + 51–66 轮文档共 28+ 文件未提交（`git status` 可查）；
62–66 轮为纯审查/验证轮，零代码改动，已装包与树零漂移（三处 SHA 复核）。
