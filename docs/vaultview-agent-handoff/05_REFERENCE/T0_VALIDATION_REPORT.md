# Drora VaultView 2.0 — T0 技术验证报告

> 2026-10-10；基于 Drora main tree `c1870c9c730975a02117e93e025ae486eb757cf1` 和已有 PRD v4.0 / R2 ADR。  
> **状态：独立 Spike 已验证；Drora 仓库集成、真实 Jev、真实 Agent admission 未验证。**  
> 所有数据是本包内的合成 Markdown，不读取用户真实 Obsidian 知识库。

## 1. 执行情况

环境：Linux；Node v22.16.0；Node 内建 `node:sqlite` / SQLite v3.49.1 / FTS5；无下载依赖。

执行命令：

```sh
cd spike
npm test
npm run demo
node scripts/evaluate.mjs
```

**本次结果：15/15 自动化测试通过**（原始输出 `test-results.log`）。示例执行输出见 `demo-output.txt`；词法检索试验见 `synthetic-eval.json`。

## 2. 分项结论

| 编号 | 项目 | 本次证据 | 当前判断 |
|---|---|---|---|
| S01 | SQLite FTS5 建表、增量维护 | 可索引、更新、删除 Markdown，删除 FTS 行，中文 bigram 搜索 | **Spike 通过** |
| S01 | 多个独立进程的 lease + fencing | `lease-worker.mjs` 各自打开同一数据库；B 接管，A 旧 token 写入被拒 | **Spike 通过** |
| S01 | Electron UtilityProcess、不同 OS、崩溃/长尾迁移 | 没有真实 Electron，未跑 Windows/macOS | **未验证** |
| S02 | `@Vault` 注入 Drora Agent Runtime | 已核对当前 composer `userselect` 仅 `{path,text}`；未有真实工作区环境 | **阻断、未验证** |
| S03 | 原生 Write/Edit 自动授权收窄 | 实验策略在隐藏目录、越界、非 md、软链、L2/L3 时拒绝自动放行 | **策略验证通过，仓库未接入** |
| S03 | Bash/MCP/脚本等所有写盘路径强制审核 | `PermissionRequest` 只匹配 `Write|Edit` | **阻断、未验证** |
| S04 | source epoch / 引用收敛 | epoch 改变拒旧查询、旧 receipt；会话绑定 opaque receipt；打开重读文件 SHA | **Spike 通过** |
| S04 | Vault 移动、重命名、权限/远端差异 | 仅在本地模拟 root fingerprint，未连接 Drora Profile 配置 | **未验证** |
| S05 | 中文索引可运行 | Han bigram token + `FTS5 unicode61` 检索（没有成熟中文分词） | **技术机制通过** |
| S05 | 真实中文笔记准确率 | 8 条合成语料，Hit@1=7/8、Hit@5=7/8 | **仅说明合成词法基线，非产品指标** |
| JEV | 出站授权/错误降级/重排契约 | 模拟 provider + consent scope + timeout/NaN/未知 ID 回退 | **模拟通过，真实 TypeSafe API 未验证** |
| EVIDENCE | Citation 来源核验 | opaque receipt ID + session + epoch + chunk ID + file SHA + 当前授权 root，改动/删除/伪造/TTL 测试 | **Spike 通过** |

## 3. 发现的重要问题

1. **只有词法召回，长时间的模糊记忆检索会漏。** 合成样本「隔了大半年还能保留我的工作偏好」无法找回语义上相关的记忆系统笔记。必须再做 Embedding 召回和真实用户标注数据集，不可用 Jev 重排补救零召回。
2. **现有 Hook 不是完整的写入防线。** `apps/drora-cli/packages/obsidian-plugin/.zcode-plugin/plugin.json` 的 matcher 是 `Write|Edit`；`allowAgentWrites=true` 的逻辑不能识别高风险文章重写意图。补丁只能减少“自动 allow”，不能阻止用户在 Runtime 弹窗中批准其他工具写入，更不能隔离 Bash/MCP。
3. **引用 ID 必须由可信服务端发放。** 本 Spike 从草案式 `{path,sha,quote}` 改成 `receiptId + sessionId` 绑定本地账本，并重读源文件。真正接入 Agent 时还须审查 Prompt/Tool 输出中伪造 receipt 的注入问题和队列等待期间的有效期。
4. **多进程协调的实验成功不等于生产安全。** 本测试证明 SQLite `BEGIN IMMEDIATE` + fence 对提交过程有效，未验证后台索引中的超长任务、Electron Host 关闭、不同平台的数据库锁、迁移和备份。
5. **Jev 模拟不是 TypeSafe 服务集成。** 本地 `rerankCandidates` 接收依赖注入的 provider 结果，没有请求 TypeSafe，没有真实 Noul/Choice API，也没有实测成本和延迟。
6. **真正的权限时序仍待明确。** 现有 `VaultView` 和 Agent Session 是不同代码域。`@Vault` 的预检索不等于 Runtime **admission 时点** 的来源有效性。必须验证 queued/busy turn 和手机远控恢复。

## 4. 本轮交付物与检验方式

- `spike/src/storage.mjs`：SQLite DB、Source epoch、lease/fence、Markdown chunk、FTS5、opaque Citation、原文重验。
- `spike/src/decision.mjs`：意图路由、受约束 Jev provider port（模拟）、出站 consent、降级、扩搜上限、文章聚合。
- `spike/src/permission.mjs`：Vault 自动 allow 路径决策原型。
- `spike/test/*.test.mjs`：15 项自动化测试，含真实子进程竞争。
- `patches/0001-narrow-obsidian-auto-allow.patch`：针对当前 Hook 的**候选最小安全补丁**。已经在与实际文件内容相同的隔离基线上进行 `git apply --check` 和 `git apply` 检查，**未在完整 Drora 仓库执行 typecheck/lint**。
- `specs/obsidian-knowledge-t0.md`：仓库适配与安全约束的建议 spec。
- `INTEGRATION_ROADMAP.md`：接下来进入仓库时的明确改动文件和阻断项。

## 5. 下一阶段阻断门槛

**M1/P0（最小只读智能问库）前必须完成：**

- 在完整 Drora 工程中跑 `node scripts/check-workspace-freshness.mjs`、`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`；本环境没有完整仓库，不能声称执行。
- 真实 `@Vault` Query/Evidence/Session 的排队与恢复闭环（T0/S02）。
- 验证现有 `getSummary` / source epoch、配置变更和跨窗口服务注册能正确接入现有 Host，而不引入另一份 Vault 配置。
- 用经过人工标注的中文文章查找问题集测试 lexical / semantic / local rerank / Jev A/B；产品阈值沿用 PRD v4.0，不能用本次合成测试当作达标证明。
- 如果准备开放自动知识写回，必须进一步找到 **Native Bash / Edit / Write / MCP / 脚本** 的程序级强制审核点，独立验证方案 C。无法做到就**保持 L2/L3 自动写回关闭**。

## 6. 当前结论

T0 在**独立最小可运行层**取得实证进展，但**整个 T0 尚未通过 Drora 集成门槛**。优先推进 T0/S02 真实 Agent admission 和 T0/S03 工具执行权限覆盖；随后再把 M1 只读搜索集成进 `VaultView`。