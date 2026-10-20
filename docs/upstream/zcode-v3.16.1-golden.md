# ZCode v3.16.1 合并黄金校验（S0）

状态：收敛完成（2026-10-20）。本文是 `scripts/upstream/transform-upstream-tree.mjs` 的规则依据与残差白名单；改动占位保护前必须先更新本文。

## 方法

- base = `transform(aac4755)`（上游 v3.15.1 全树经改名转换），golden = Drora `780721e7`（v3.15.1 集成产品树，2026-10-13）。
- `diff -rq` 全树比对；残差必须全部可归类为「已记录的有意分歧」，否则修转换规则。
- 早期错误基线教训：`82b02c14`（2026-10-11）在 v3.15.1 集成**之前**，不能作 golden。

## 收敛终态

| 类别 | 数量 | 结论 |
| --- | --- | --- |
| 内容不同 | 465 | 全部归入下方分歧桶；零哨兵残留/零重编码损坏（gb2312 夹具逐字一致） |
| Drora 独有 | 194 | 自研新增簇（见 §自研独有） |
| 上游独有 | 11 | 全部有据（见 §上游独有 11 条） |

转换覆盖：16880 文件（content 16.4k / cuaLimited 26 / verbatim 221 / binary 194；5452 路径重写）。

## 占位保护清单（规则 0 扩充，逐案核对依据）

1. **z.ai 后端 wire 契约**：`cdn-zcode.z.ai`、`zcode.z.ai`（含正则转义形态）、`/zcode/official-plugin/`、`/api/v1/zcode-plan`、`zcode-plan/anthropic`、`zcode_type` 载荷字段、header 族 `x-zcode-trace-id`/`x-zcode-session-type`/`x-zcode-bot-secret`/`X-ZCode-Mobile-Connection-Id`/`X-Zcode-App-Version`/`x-zcode-app-version`/`x-zcode-rpc-host-capability`/`x-zcode-rpc-client-mode`/`x-zcode-query-source`/`x-zcode-channel`/`x-zcode-agent`/`x-zcode-intranet-token`（含 Title-case 变体）、`appId: "zcode"`。
   - 注意方向：`zcode-plan` **仅 API 路径**保留；品牌叙述/本地测试路径 Drora 改为 drora-plan（随规则 8）。
   - 文档中 `x-drora-query-source` 等改写为 Drora 形态的行属文档分歧（残差），代码 wire 名保留。
2. **桌面 deep-link 双 scheme**：`zcode://`、`zcode:/`、`x-scheme-handler/zcode`、`"zcode", "drora"` 双 scheme 字面量——Drora 注册并等价接受两个 scheme。
3. **`_meta`/注册表键**：`zcode/csp`（资源级 CSP 放宽键）。
4. **官方锚点**：`dev.zcode.app`（launcher 门钉）、`zai-org/ZCode`、`zcode-cua.git`、`aminer.cn/codegeex/zcode-cua`、`.zcode-plugin`/`.zcode-plugin-seed.json`（磁盘格式约定）。
5. **zcode-cua 双上下文**：路径/仓库上下文保留（`packages/zcode-cua`、`zcode-cua-plugin`、`zcode-cua-helper`、`/zcode-cua/` CDN 子路径、`bump-zcode-cua-producer`、`sync-skill-from-zcode-cua`、`zcode-cua-windows-dev` 协议通道、还原区导出标识符 `isPotentialZCodeCuaAgentMcpServer` 等 3 个）；身份上下文随规则 8b 改名（`@drora/drora-cua`、`drora-cua@marketplace`、`mcp__plugin_drora-cua_*`）。
6. **方向修正记录**（勿回退）：`ZCODE_HOME`/`ZCODE_SKILL_DIR`/`ZCODE_CUA_PLUGIN_ROOT`/`Symbol.for("zcode.node-repl.*-bridge")` **不保护**——Drora 主形态是 `DRORA_*`/`drora.node-repl.*`（ZCODE_ 兼容读取只存在于 Drora 自有还原文件，不经转换）；`zcode/electron/releases` **不保护**——Drora 更新源自建（remoteCdn.ts 用 drora/ 形态）。

## 465 个内容差异桶（纯内容 245 + 含保留字面 220）

| 桶 | 数量 | 代表 |
| --- | --- | --- |
| A 品牌/资产 | ~40 | 图标/favicon/aboutWindow/App.tsx logo import、web index.html boot SVG |
| B 工具链/构建 | ~24 | 根与各包 package.json（R4 裁定后 vitest/wdio 将随上游）、vitest.config、knip.json、SEA 打包 |
| C 自研扩展挂载 | ~85 | droraAgentService、relay/远控、vault/knowledge、desktopPet、captcha、desktopMainIpcPlatform |
| D 还原区替换 | 6+9 | packages/zcode-cua（上游占位包 vs Drora 还原实现）、d.ts.map 偏移 |
| E 集成期修复 | ~60 | permission S03、processTreeWaiter Linux 僵尸、DNS rebinding、相对路径别名、21 个测试（含 spec/bundle 偏移注释） |
| F 文档改写 | ~40 | README/AGENTS/DESIGN/引用上游叙述保留 zcode |
| G 平台/发行 | ~8 | electron-builder yml、签名/更新源脚本 |

已知单点：`WorkspaceShellLayout.tsx` 含 formatter 行宽漂移（C 桶挂载之外的空白差异）；`useWorkflowRunNodeResult.ts` 的 `\x00` 缓存键分隔符为故意设计。

## 自研独有 194 条簇

knowledge/Obsidian（~45）、手机远控/relay（~30）、CUA 还原链（~20）、specs/治理文档（~30）、桌宠（~20）、测试/脚本/CI（~25）、drora-extensions（4）、website（~4）、更新/验证码/CLI 增强（~16）。

## 上游独有 11 条

forceUpdate 家族 7 条（specs/force-update-gate-removal.md、update-feed-github.md 记录的删除）；`apps/drora-cli/pnpm-lock.yaml`+`pnpm-workspace.yaml`（CLI 并入根 workspace，集成决策）；`zcode-cua-plugin/tsconfig.json`（db98147cf 删除包内 TS 构建）；`docs/cua-permission-broker/zcode-cua-permission-broker.md`（改名 drora-cua-permission-broker.md）。

## 合并时的引用

- 三方合并 base=transform(aac4755)、theirs=transform(upstream/main)；上述 A–G 桶 = ours 侧真实改动，冲突仅在重叠处。
- 哨兵机制教训：unprotect 必须用 `!` 结界（base64url 字母表外），否则贪婪匹配吞掉哨兵后原文产生乱码字节。
