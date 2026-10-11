# W10 交付报告——GUI E2E harness（部分交付：harness 落地，链路执行受阻已定性）

**日期：** 2026-10-11　**分支：** `feat/vaultview-w10-gui-e2e`（叠层基于 `feat/vaultview-w09-ui`）　**spec：** `specs/obsidian-knowledge.md` §5f.6

## 1. 交付内容

1. **P1 修复（已拆独立 PR #18，base main）**：`knowledgeDatabase.ts` 的 `node:sqlite` 经 `createRequire` 绑定。tsup 对 ESM 产物剥 `node:*` 前缀，`fs/path` 等老内建裸名恰好可用，但 `node:sqlite` 无裸名别名——裸 `"sqlite"` 解析到不存在的 npm 包，**桌面 main/打包产物自 W02 合入起加载即崩**（esbuild 对比实验证实重写者是 tsup 而非 esbuild）。
2. **GUI E2E harness v1**（`scripts/e2e/desktop-vaultview-gui-e2e.mjs`，407 行，零依赖）：
   - 隔离启动链：`pre-dev → agent CLI → tsup 单次 → vite 常驻 → electron . --remote-debugging-port=9333`，每步可观测、带超时；
   - 隔离不变量全落地：`DRORA_DATA_BASE_DIR` + `DRORA_DESKTOP_USER_DATA_DIR` + `DRORA_DESKTOP_APPLICATION_NAME`（每轮唯一身份，desktopRuntimeEnv 既有约定）+ `DRORA_DISABLE_FIXED_REMOTE_DEBUGGING_PORT=1` + setting.json 备份/恢复 + 真实实例运行守卫；
   - 原生 WebSocket CDP 客户端（每消息 8s 超时）+ 六步场景 + 逐里程碑截图；
   - 预置用 services 真实 `configureVaultAt`（与生产同形）。

## 2. 运行结果（13 轮迭代，诚实记录）

- 启动链全通：隔离环境构建/启动/窗口创建/host spawn 全部正常（App 本体健康）；
- **链路断点：CDP 会话层**。证据链：
  1. `/json/list` 在 Electron 启动后**只应答一次**，随后 HTTP+WS 对所有客户端（node fetch / ws 包 / PowerShell / curl）永久失聪；
  2. **判别实验一**：Electron 默认欢迎应用（零 Drora 代码）同端口同驱动 → CDP 连续应答、WS 会话正常、断开后服务存活 → **机器/防火墙/驱动层排除**；
  3. **判别实验二**：Drora 应用 + ws 包客户端 → 首个 WS 会话（Runtime.enable）即挂死且服务永久失聪 → **Drora 特有**；
  4. App 自身日志止于 `renderer-action-trace config refreshed`（正常静默），窗口/host 均健康——冻结点在 DevTools 服务层而非应用功能层。
- **强怀疑（未验证）**：真实 Drora 桌面实例在本机**带活跃 Agent 会话使用中**（OS 截屏实证），E2E 实例与其并存运行——尽管 userData/身份已隔离，仍可能存在更深层互扰（CPU 竞争、Chromium 磁盘缓存、单例信令）。守卫已升级为「发现任何 electron 进程即拒绝」。

## 3. 未执行（如实）

- 六步场景的点击级验证与 A21 截图证据：被上述 CDP 阻塞；
- 深色/窄屏截图；手机重连/远端隔离（不在脚本范围）。

## 4. 后续路径（建议）

1. **安静机器执行**：关闭真实 Drora 实例后重跑本脚本（守卫会先拒绝含干扰的环境）；
2. 或移植 fork 仓库既有的 Chromedriver 桌面 E2E 约定（desktopRuntimeEnv 的 env 族即为其预留）；
3. CDP 失聪根因可在安静环境下用本 harness 的诊断开关继续定位。

## 5. 回滚

`git revert` 本分支两笔提交即可；P1 修复独立在 PR #18（`fix/desktop-node-sqlite-bundle`），不受本分支回滚影响。
