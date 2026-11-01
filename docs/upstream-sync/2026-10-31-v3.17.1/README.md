# ZCode v3.17.1 更新合并：调查证据与入口

2026-10-31（Asia/Shanghai）。交付状态：**方案和只读预演已完成，上游产品合并未开始**。本聊天只新增文档及清单，未主动切分支、未合并/推送 main、未修改产品实现。外部 PR/checkout 变化见下文与任务日志，不归因于本聊天操作。

## 从这里开始

1. 阅读 [完整合并方案](../../../specs/upstream-v3.17.1-migration.md)：固定基线、owner/时序、三方转换、删除/冲突裁决、分段门禁、PR/main 交付与回滚。
2. 阅读 [特性保护矩阵](feature-preservation.md)：17 类保留能力、24 组验收场景、独立目录与共享接线，以及原有未完成项。
3. 按 [任务记录](tasks.md) 执行并回填；S0 已完成，P0–S8 均未执行。所有产品项仍待处理。
4. 查询 [manifest.json](manifest.json) 与 [summary.json](summary.json) 获取输入 SHA、数据摘要、方法和机器清单 hash。

## 核心发现

- 官方 [U2 提交](https://github.com/zai-org/ZCode/commit/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1) 为 v3.17.1；上轮 B 为 v3.16.1，中间尚有 [v3.16.2 提交](https://github.com/zai-org/ZCode/commit/3c5b227649371507ddc4eb46ac5133afe6db1cab)。[官方 README](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/README.md)列明对应版本。
- `origin` 指官方，`drora` 指产品仓库。不能把 origin/main 作为 Drora main，更不能向 origin 推这次集成。
- 调查初期本地 main L 落后旧远端 C0 **132** 提交；F 领先 C0 **11** 个提交、**176** 个路径变化，其中 **41** 个路径与上游累计增量重叠。调查期间 [PR #32](https://github.com/CavinHuang/Drora/pull/32) 将 F 合入 main，当前 C=`66c9193fd`，L 落后 **144** 个提交。F 已是 C 的祖先，二者 tree 完全相同；实际执行从 C 起步，不重复合入 F。
- 官方累计 **5,548** 路径（A 1,263 / M 1,987 / D 2,298）。F 文本预演有 **149** 冲突、**367** 个“上游删、本地改”项、**314** 个文本 clean 但需要语义核查的合并。
- F 相对转换后 B 的本地差异 **10,164** 路径（A 7,465 / M 2,683 / D 16），其中 **845** 个被本轮上游增量触及。这是所有差异，不把文档/资产/生成物都称为自研功能。
- 自建 Relay 服务、来源切换与人格实现现均已进入 C。历史 10-22 删除 Relay 的决定已被后续实现/spec 更新，不能照旧方案将其删除。
- 上游将 App 业务 UT 退役、根测试改为工程清单。涉及 **2,259 个删除测试资产路径**，包含 helper/fixture/移动前旧路径，不是测试 case 数。Drora 自研及修改回归的去向必须先裁决。
- 终检观察到外部已将当前目录切到 `codex/upstream-v3.17.1-integration`，HEAD=C；与已审核 F 同树，输入证据仍有效。执行时先检查这个已有分支，不重复创建/重置，也不改动别的聊天 WIP。

## 两轮预演比较

| 预演结果 | C0：调查初期 main | 当前 C / F 同树：含 persona/Relay 切换 |
| --- | ---: | ---: |
| take-upstream | 1,519 | 1,506 |
| add | 1,262 | 1,262 |
| text-conflict | 140 | 149 |
| text-clean-needs-semantic-review | 310 | 314 |
| delete-review | 1,928 | 1,926 |
| delete-local-change-review | 365 | 367 |
| zone-decision | 17 | 17 |
| lockfile-regenerate | 2 | 2 |
| already-present | 1 | 1 |
| already-deleted | 4 | 4 |
| 总计 | 5,548 | 5,548 |

所有结果仅为预演分类。特别是 delete-review 也不授权直接删除；A/D 可能是移动的两端。`already-present/deleted` 同样需要最终证据。两轮对比表中的锁文件统一从 zone-decision 拆成 lockfile-regenerate，避免隐去依赖生成任务。

## 清单说明

| 文件 | 行数（不含表头） | 用途 |
| --- | ---: | --- |
| [upstream-ledger.tsv](upstream-ledger.tsv) | 5,548 | 上游累计每条 A/M/D、原路径/Drora 路径、各方 blob、C0/当前 C 预演结果、测试资产标记、最终裁决占位 |
| [local-preservation.tsv](local-preservation.tsv) | 10,164 | C/F 同树的每项真实本地差异、原/转换基线 hash、产品 blob、上游/历史分支交集、owner/结论占位 |
| [feature-branch-delta.tsv](feature-branch-delta.tsv) | 176 | 历史 C0→F 已有增量与 blob，作为新近并入 main 的人格/Relay 专项保留台账 |

TSV 使用 UTF-8、LF、首行列名；空值为单个 `-`；blob 为 Git SHA-1 对象 ID，不是工作区文件 SHA256。所有 `final_disposition` 初始为 **pending**，没有把预演的 clean 当最终结论。owner 初始 needs-owner-review 是明确的任务，不代表这些文件全部未受保护。

执行期更新最后几列：

- 上游：`applied` / `migrated` / `superseded` / `intentional-divergence`，填写 candidate_commit/evidence/reviewer。`migrated` 要同时关联旧/新路径；`superseded` 要给中间版本与终态证据。
- 本地：`unchanged` / `equivalent-migration` / `approved-removal`，补 owner、候选提交与保真/回归证据；approved-removal 必须明确已获相应产品规则授权，不能由执行者为了消冲突自行删除功能。
- 历史分支差异：标记升级后保留/等价迁移的对应 commit/证据；已入 main 的人格/Relay 接线不能在导入上游后消失。

清单改变后重新计算 manifest 的 SHA256/bytes/rows，追加检查点日志；输入 refs 不变时不要重排 ID。追加发现项使用新 ID，不能覆盖历史结论。

## 调查方法与可复核命令

这些只读命令在仓库根执行。SHA 名称已固定在迁移 spec/manifest；调查没有创建下述示例变量对应的 branch/tag。

```powershell
git status --short --branch
git remote -v
git worktree list --porcelain
git ls-remote --heads origin main
git ls-remote --heads drora main
git rev-list --left-right --count main...drora/main
git rev-list --left-right --count drora/main...HEAD
git merge-base drora/main origin/main
git diff --name-status --no-renames 0a1fc56d279fd1001f78387bd81aec1c26767411 a60ba6a7e5a06742270ca605f5d2cc2766afa7e1
git diff --name-status --no-renames 0a1fc56d279fd1001f78387bd81aec1c26767411 3c5b227649371507ddc4eb46ac5133afe6db1cab
git diff --name-status --no-renames 3c5b227649371507ddc4eb46ac5133afe6db1cab a60ba6a7e5a06742270ca605f5d2cc2766afa7e1
```

由于 origin fetch 首次 TLS 失败，本轮用 GitHub 连接器与 `ls-remote` 交叉确认最新 ref，并读取已经存在的固定对象；没有将 fetch 失败写成成功，也没有改 TLS 配置。Drora fetch 成功，当前分支 ref 未移动。

只读 harness 位于系统临时目录，不作为生产迁移工具提交。算法和复核依据：

1. 用 `git ls-tree -rz --full-tree` 读取 B/U2/C0/F；通过当前提交的 `mapRelPath` 与 `zoneOf` 对路径映射，原始 blob 保存在 ledger。发现 main 前进后，核对 C/F tree 相同，确认固定预演可复用至 C 内容。
2. 使用 `git cat-file --batch` 读取相关对象；普通区用当前 `transformContent`，CUA-limited 只改 `@zcode/` scope，verbatim 原样。二进制扩展集合、首 4,096 字节 NUL 检测和严格 UTF-8 解码与当前转换器一致。
3. 对转换内容按 Git blob 格式 `blob <byteLength>\0<bytes>` 计算 OID，比较 C0/F，去掉纯品牌机械变更；所有新增/删除/实际修改写本地保护清单。
4. 对 B→U2 的每个路径，用固定 ours 做存在性/相等判断；双方修改文本调用 `git merge-file -p --diff3`，输入文件仅位于专用临时目录。非零结果作为冲突/错误处理；本轮未出现被忽略的 merge error。
5. 所有上游删除保留 review，特殊区保留 zone-decision；锁文件独立归 regenerate。没有运行任何生成候选产品树的 apply 或 merge。
6. 最终导出为本目录 TSV，保存规则脚本的 Git blob/SHA256 和输入 tree SHA。C0 与当前 C 的结果分别位于 `previous_main_dryrun` / `current_main_dryrun`；blob 列同理。本地 `product_blob` 属 C/F 同树内容；历史分支清单的 `previous_main_blob` 属 C0。临时 harness 不作为已验收执行工具；P1 需建立可维护、可重放、有回归的工具入口。

边界：本轮没有整树 rename/目录移动推断，没有复现整套依赖/生成物/类型/打包/运行时的合并结果。可用 Git blob/tree 与转换器 hash 重建输入；判断行为等价仍须对应代码和运行证据。

### 输入与数据完整性复核

已检查 ledger 的路径与固定 Git 对象逐项一致、ID/路径唯一、分段总数/状态总数/两轮 outcome 总数都等于 5,548；local/feature 差异按固定对象可重建；manifest 的 SHA256 与实际文件一致。文档相对链接可解析，`git diff --check` 通过。所有最终裁决仍 pending，这是当前准确状态。

此目录已被现有 `.oxfmtrc.json` 的 `docs/upstream-sync/**` 排除，人工核对字段/字面量，不能将 formatter 的 ignored 算作格式通过。新增迁移 spec 单文件格式检查结果见下面验证记录。

## 当前基线验证记录

| 项目 | 实际结果 | 限制 |
| --- | --- | --- |
| `node scripts/check-workspace-freshness.mjs` | exit 0 | 当前 feature 与自己的 tracking branch 同步；不是 main 完成升级的证明 |
| Node/pnpm | 24.14.0 / 10.33.2 | 使用本机已存在固定 Node，未修改全局安装；初始 PATH 的 24.1.0 未用于门禁 |
| `pnpm typecheck` | exit 0 | F 当前基线，非候选合并产物 |
| `pnpm lint` | exit 0，395 warnings，0 errors | 保留既有 warnings，不宣称零 warning |
| `pnpm architecture:check --changed` | exit 0，0 violations | 调查初期干净工作区；后续需对 C..候选全差异检查 |
| 新迁移 spec 格式与文档/清单完整性 | 单文件 oxfmt exit 0；字面量/图代码保持；18 个相对链接、TSV/manifest、9 文件空白与末尾换行检查通过 | docs/upstream-sync 豁免文件人工核对；不代替产品验证 |
| `pnpm architecture:check --changed --base 66c9193fdd006df0bb30f0cc7c6ab316553d6052` | exit 0，0 violations | 最终文档范围检查；输出为 merge-base explicit C |
| 产品 E2E / 根全量 UT / CLI 全包 / bundle parity / 打包 | **未执行** | 列在 tasks.md 的相应门禁，未勾选 |

后续每段在当前输入/候选 SHA 上重新执行相关检查并保存详细日志。规划轮静态门通过不授权跳过执行期验收。
