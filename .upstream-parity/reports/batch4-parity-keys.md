# Batch 4 — 行为契约键族 parity 报告（原版 3.14.3 vs 本仓 drora.cjs）

- 日期：2026-10-19
- 原版 bundle：`D:/software/zcode/resources/glm/zcode.cjs`（3.14.3，15,127,039 字节）
- 本仓 bundle：`apps/drora-cli/packages/cli/dist/drora.cjs`（15,283,657 字节）
- 脚本：`scripts/check-bundle-key-parity.mjs`
- 性质：只读调研（脚本 + grep + git 只读命令）

## 1. 脚本检查的键族（读 `scripts/check-bundle-key-parity.mjs` 源码）

| 键族 | 正则 | 归一化 | 含义 |
| --- | --- | --- | --- |
| `metaKeys` | `"(?:zcode\|drora\|codex)\.cua/[a-z0-9./-]+"` | 本仓侧 `drora/codex.cua/` → `zcode.cua/` | 跨进程 `_meta`/wire 契约键（CUA 桥 meta 族） |
| `envKeys` | `"(?:ZCODE\|DRORA)_[A-Z0-9_]+"`（**带引号**） | `"DRORA_` → `"ZCODE_` | env 契约键（字符串字面量） |
| `permissionKeys` | `"(?:zcode\|drora):permission[a-z-]*:[a-z_]+"` | `drora:permission` → `zcode:permission` | 权限 capability 持久化键 |
| `diagCodes` | `"[a-z]+_[a-z_]*frame[a-z_]*"` | 无 | 帧完整性/栅格诊断码 |

退出码：`0` = 四族集合一致；`1` = 存在原版独有字面量需甄别（summary 计数）；`2` = 用法错误。
参数仅两个位置参数（原版、本仓路径），**无 `--json` 等其它参数**（源码仅读 `argv[2]/argv[3]`，多余参数被忽略）。

## 2. 脚本运行结果（完整 stdout + 退出码）

命令：`node scripts/check-bundle-key-parity.mjs "D:/software/zcode/resources/glm/zcode.cjs" "apps/drora-cli/packages/cli/dist/drora.cjs"`

```
### metaKeys
sets identical

### envKeys
sets identical

### permissionKeys
sets identical

### diagCodes
sets identical

summary: 0 original-only literal(s) need triage
```

- **stdout/stderr 如上（无 stderr）**；**退出码 = 0**。
- **脚本未报出任何差异**：原版独有 0 条、本仓独有 0 条。故任务 3 的"逐条溯源表"对脚本输出为空，下文改为对**手动补充差分**的发现逐条溯源。

## 3. 手动补充差分（脚本带引号正则覆盖不到的部分）

### 3.1 env 键映射完整度（任务 4，不带引号 `ZCODE_[A-Z_]+` vs `DRORA_[A-Z_]+`）

| 口径 | 原版唯一键数 | 本仓唯一键数 | 交集（改名映射后） |
| --- | --- | --- | --- |
| 不带引号 `[A-Z_]+`（任务指定 grep） | 157 | 161 | 157 |
| 带引号 `"…[A-Z0-9_]+"`（脚本同款） | 67 | 67 | 67 |

- 任务书给的"原版 162 键"与实测不符：实测原版不带引号口径为 **157**（无数字尾缀键），带引号口径 67。以下以实测为准。
- **缺失清单：空**。157 个原版 `ZCODE_*` 键逐一检查，`ZCODE_X → DRORA_X` 机械改名后 **全部存在** 于本仓 bundle（存在 157 / 缺失 0 / 改名不同 0）。改名映射完整度 **100%**。

方法教训：MSYS grep 对本仓 bundle 的 stdout 做 CRLF 翻译（输出行尾带 `^M`），首轮 `comm` 全量误报；加 `tr -d '\r'` 后得到真实差分。

### 3.2 本仓独有键溯源（4 条，均为**未加引号标识符**，非字符串字面量）

带引号字面量检查：4 键在本仓 bundle 中 `grep '"KEY"'` 均为 **0 次**；出现形态均为 `process.env.X` 属性访问或打包器导出表属性名（esbuild 保留属性名），原版侧同名 ZCODE_ 标识符为 0（被压缩内联）。**均不构成 wire/env 契约字面量，不参与脚本键族比对**。

| 本仓独有字面量 | 本仓定位（文件:行） | bundle 内形态（字节偏移） | 判定 |
| --- | --- | --- | --- |
| `DRORA_AGENTS_TEAM` | `apps/drora-cli/packages/contracts/src/config/index.ts:258`（注释引用；specs/agents-team.md §6.4 灰度开关，env 为过渡回落） | `process.env.DRORA_AGENTS_TEAM==="1"` @14456141 | **自研**（Agents Team 灰度回落 env），合法 |
| `DRORA_CUA_BROKER_TOKEN_ENV_KEY` | `packages/shared/src/runtimeEnv.ts:132`（值 = `"DRORA_CUA_PERMISSION_BROKER_TOKEN"`，该值键两侧共有） | 打包导出表属性名 `DRORA_CUA_BROKER_TOKEN_ENV_KEY:()=>qsn` @1078576 | **压缩产物**（常量名标识符；原版将等价常量内联，值键已映射），非 gap |
| `DRORA_LEGACY_WEBHOOK_SECRET_HEADER` | `packages/shared/src/bots.ts:39`（值 = `"x-drora-bot-secret"`）；消费方 `packages/services/src/drora-extensions/webhookSecret.ts:9` | 打包导出表属性名 @1079216 | **自研**（改名旧别名兼容 adapter，specs/drora-rename.md v3.15.1 补记），合法 |
| `DRORA_TUI_NODE_ALIAS_CHILD` | `apps/drora-cli/packages/cli/src/tui-runtime-loader.ts:63,88` | `process.env.DRORA_TUI_NODE_ALIAS_CHILD==="1"` @15255198 | **自研**（SEA Windows TUI 子进程防递归标记），合法 |

**gap 数量：0**。

### 3.3 本仓 bundle 残留 `ZCODE_` 字面量（官方锚点，非改名遗漏）

| 残留 | 位置/偏移 | 用途 | 判定 |
| --- | --- | --- | --- |
| `"ZCODE_SKILL_DIR"`（带引号 ×1）+ 未加引号 ×5 | @4312738（插件变量）、@5246944（hook 变量）、@7795426（skill 字节上限替换）、@14450547（自定义命令） | `${CLAUDE_SKILL_DIR\|DRORA_SKILL_DIR\|ZCODE_SKILL_DIR}` 三前缀兼容读/拒绝分支 | **兼容别名读**（原版为 CLAUDE\|ZCODE 双前缀，本仓加 DRORA 成三前缀），合法 |
| `ZCODE_CUA_PLUGIN_ROOT`（未加引号 ×1） | @14446809（`resolveBuiltInNodeRepl`） | env 双注入 `{DRORA_CUA_PLUGIN_ROOT: r.rootPath, ZCODE_CUA_PLUGIN_ROOT: r.rootPath}`——官方 zcode-cua-plugin seed（豁免区，逐字 seed）仍按官方名解析根目录 | **官方锚点**（specs/drora-rename.md 豁免区 1），合法 |

### 3.4 `.cua` metaKeys 键族明细（脚本判 identical 的构成）

| 原版 | 本仓 | 判定 |
| --- | --- | --- |
| `"zcode.cua/frame-integrity-rejections-v1"` | 同名逐字保留 @4128579 附近（与 `official_cua_frame_v1` 常量同域） | 官方锚点（帧完整性 wire） |
| `"zcode.cua/official-frame-integrity-v1"` | 同名逐字保留 | 官方锚点 |
| `"zcode.cua/request-access-status-v1"` | 同名逐字保留 | 官方锚点 |
| `"zcode.cua/target-app-display-v1"` | `"drora.cua/target-app-display-v1"` @1502975 | **品牌改名**（脚本归一化后匹配） |

### 3.5 permission / diag 键族明细

- permissionKeys：原版 `"zcode:permission-capability:official_cua"` ↔ 本仓 `"drora:permission-capability:official_cua"`（改名映射，各 1 处，归一化后一致）。
- diagCodes：两侧均为 `"official_cua_frame_pair_not_leading"`（逐字一致）。

### 3.6 `_meta` 键族检查（任务 5）

- 原版 2 处、本仓 2 处（`grep -o '"_meta' | wc -l`），**并非"原版没有"**。
- @~4.5MB：`RequestMetaEnvelopeSchema` 校验失败时的 problem-key 回退文案 `i.length>0?i.join("."):"_meta"`——两侧逻辑逐字等价（仅压缩标识符不同：`uie`↔`Kie`）。非 wire 键注入。
- @~10.2MB：内联 TS 编译器 `createUniqueName("_metadata")`/`_classThis` 内部唯一名。两侧相同来源。
- **结论：两侧均未注入独立 `_meta` wire 键；真正的 meta 契约族是 3.1/3.4 的 `*.cua/*` 键（脚本 metaKeys 族），已判一致。**

### 3.7 附带发现（header 族，脚本不覆盖）

- 本仓 bundle 同时含 `x-zcode-bot-secret` ×1（3.15 官方默认 webhook header，specs/drora-rename.md v3.15.1 豁免补记）与 `x-drora-bot-secret` ×1（本仓旧别名兼容，`packages/shared/src/bots.ts:39`）；原版 3.14.3 两者皆无 → **版本差（3.15 新增）+ 有意双读**，与 spec 记录一致。
- `packages/shared/src` 中常量值保留 zcode 前缀的外部契约：`DRORA_RPC_CLIENT_MODE_HEADER = "x-zcode-rpc-client-mode"`、`DRORA_RPC_HOST_CAPABILITY_HEADER = "x-zcode-rpc-host-capability"`（runtimeEnv 同文件 633/635 行附近）——属规则 0 同族的网关 wire 契约，有意保留。

## 4. contracts 键族定义梳理（单一出处验证）

- 聚合包：`apps/drora-cli/packages/contracts`（`@drora/contracts` 0.1.0），`src/index.ts:105` re-export `@drora/shared`——**实际常量定义主体在 `packages/shared/src`**（23 个文件含 `export const DRORA_*`），contracts 自身定义 2 个文件：`interfaces/mcp.port.ts`（NODE_REPL `drora/*` meta 键，即 spec 批 5 补记的浏览器 responseMeta 常量）与 `plugins/index.ts`（市场 id `drora-plugins-official`、`__drora-plugin-host` 等）。
- env 键族代表性出处：`packages/shared/src/runtimeEnv.ts`（`DRORA_RUNTIME_ENV_KEY`、`DRORA_CUA_BROKER_SOCKET_ENV_KEY`、`DRORA_CUA_BROKER_TOKEN_ENV_KEY` 等）；`DRORA_PLUGIN_ROOT` 无单点 const，散落于 `apps/drora-cli/packages/bootstrap/src/custom-command-shell-expansion.ts:179`、`apps/drora-cli/packages/core/src/hooks/configured-runner-input.ts:122` 等注入点（字面量本身两侧映射一致，不构成缺口；如需收紧可评估收敛到 runtimeEnv）。
- 链路符合 AGENTS.md"契约键单一出处、生产消费引用同一常量"的方向；bundle 证据（@1078576 导出表）显示 bundle 内生产/消费走同一常量。

## 5. 结论

1. **脚本退出码 0**，四键族（meta/env/permission/diag）归一化后集合完全一致，原版独有字面量 **0**。
2. 手动差分：原版 157 个 `ZCODE_*` env 键 **100% 有 DRORA_ 对应**，缺失 0；本仓独有 4 条均为标识符形态（3 自研 + 1 压缩产物），**gap = 0**。
3. 本仓残留 `ZCODE_` 均为官方锚点/兼容读（skill 变量三前缀、CUA 插件根双注入、3 个 `zcode.cua/*` wire 键逐字保留），与 `specs/drora-rename.md` 豁免区一致。
4. 无需 triage 的上游缺口；无需修改实现。脚本的 CRLF/带引号口径限制已在本报告记录，供后续批次复用。
