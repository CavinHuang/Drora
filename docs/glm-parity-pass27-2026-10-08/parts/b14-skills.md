# b14-skills 对拍报告（pass27 2026-10-08）

真值 = D:\software\zcode\resources\glm\zcode.cjs（0.16.9）+ resources/glm/packages/bundled-skills/（明文）。
我方 = D:\workspace\projects\Drora @ feat/migrate-remote-and-pet（基线新鲜：ahead 14 / behind 0）。
真值 bundle 取证以字节偏移 `@N` 标注；我方以 `文件:行` 标注。证据短摘 ≤20 字。

结论速览：skills 面为**高度忠实移植**，发现/解析/装配三条面逐点一致；差集仅 1 REAL-GAP（跨域）、2 EXTRA（死声明）、3 SHAPE-DIFF（品牌/打包形态）。历史基线 4 项全部重测关闭。

---

## §1 发现面

### 1.1 技能根全集与优先级 —— 一致
双方同构（真值 `@4120700` xHr vs 我方 `apps/drora-cli/packages/adapters/src/skills/roots.ts:20`）：

| 顺序 | 根 | scope/source | priority |
| --- | --- | --- | --- |
| 1 | config `skills.roots`（extraRoots） | project / drora（真值 zcode） | 10 |
| 2 | `~/.drora/skills`（真值 `~/.zcode/skills`） | user / drora | 20 |
| 3 | `~/.agents/skills` | user / agents | 30 |
| 4 | 工作区沿 .git worktree 根逐级向上：每级 `.drora/skills` + `.agents/skills` | project / drora+agents | 40+（步长 10） |
| 5 | 插件技能根（extraResolvedRoots 注入） | project / plugin | 1000 + 10n |
| 6 | 内置技能包 `skills/` | system / bundled | 1_000_000 |

- 常量逐一相等：步长 10、`.git` 探测、`~/` 展开（真值 `@4121771`：i3s=10；我方 roots.ts:8）。
- 插件优先级：真值 Gzs=1e3、Jzs=10（`@4282001`）= 我方 `adapters/src/plugins/index.ts:104-105`（1000/10）。
- bundled 根：真值 g9a=1e6（`@13881339`）= 我方 `bootstrap/src/app/bundled-skills.ts:49`。
- `.drora`+`.agents` 合并非 fallback、同级 .drora 优先：一致（roots.ts:94-105 vs 真值 wHr）。
- brand 差异仅 `.zcode`→`.drora`、source 名 `zcode`→`drora`（有意的品牌替换，非缺口）。

### 1.2 扫描规则 —— 一致
- 文件名 `SKILL.md`；根自身可为一技能，再扫一层子目录（真值 `@4121925` EHr/xOe vs 我方 `adapters/src/skills/scan.ts:43-99`，sync/async 双变体同构）。
- 目录过滤集完全相同 12 项：node_modules/dist/build/out/target/vendor/coverage/.cache/.next/.turbo/.venv/__pycache__；点目录仅放行 `.system`；递归上限 8（真值 `@986713`：Rfr/UXi=8/zXi=[".system"] = 我方 `packages/shared/src/skill-scan-policy.ts:21-50`）。
- symlink 策略一致：plugin 根一律不跟随（目录/文件/根三级全拒），用户级保持跟随（真值 `followSymbolicLinks:t.source!=="plugin"` @4128491 附近 = 我方 scan.ts:141-143）。
- 错误契约一致：ENOENT 吞、EACCES 等上抛发 `skill_scan_failed`（scan.ts:145-155）。
- 去重按解析后路径、输出按 name 排序（真值 `l.has(b.path)` @4127374 = 我方 index.ts:81-84）；同名跨根共存，qualifiedName 仅 plugin 根产生（`pluginName:skillName`，index.ts:250-263）。
- 禁用路径：config skillOverrides 的 enable=false，按 resolved+realpath 双形态比对（真值 isDisabledSkillPath = 我方 index.ts:239-248，含 symlink 绕过防护注释）。
- 诊断发射集双方均为且仅为 6 码：skill_scan_failed / skill_read_failed / skill_missing_name / skill_missing_description / skill_description_too_long / skill_invalid_frontmatter（真值 grep 计数与我方 index.ts 逐一对应）。
- 无 frontmatter 的手写技能按目录名加载：一致（index.ts:184 vs 真值 `a?void 0:basename(dirname(t))`）。

### 1.3 bundled 根解析 —— 一致
- 候选目录走 official-plugin 同款 walk（`packages/bundled-skills` 及上溯 3 层；真值 m9a @13881339 = 我方 bundled-skills.ts:34-39）。
- SEA：资产前缀 `drora-bundled-skills/`（真值 `zcode-bundled-skills/`）、manifest v1{files,hash,version}、目录名=内容 hash、写临时目录+rename、并发失败回退任一完整旧包、marker `.drora-bundled-skills-seed.json`（真值 HEn）——全部同构（bundled-skills.ts:122-218 vs 真值 y9a/VEn/v9a）。
- 必需资产三件套缺失即拒整包（bundled-skills.ts:27-31 = 真值 ekt 的 u9 列表）。
- 打包脚本：真值 `scripts/sea-bundled-skill-assets.mjs`、`scripts/prepare-prebuilds.mjs`；我方分别位于 `apps/drora-cli/packages/cli/scripts/sea-bundled-skill-assets.mjs`、`scripts/prepare-prebuilds.mjs`（均存在，位置差异见 §5）。

## §2 解析面

### 2.1 frontmatter —— 一致
- 块提取：BOM 剥离、首行 `---`、闭合行匹配（index.ts:280-297 = 真值 _3s/y3s）。
- 平铺 YAML：顶层 `key: value`；block scalar `>`/`|`（含 `+`/`-` chomp）折叠解析逐函数同构（真值 b3s/S3s/w3s/k3s @4124631/@4124972 = 我方 index.ts:342-404，含多行 description 折叠）。
- safe 键集 = {name, description, when_to_use, license, metadata}（真值 f3s @4126469 = 我方 SAFE_FRONTMATTER_KEYS index.ts:21-27）；未键不报错，仅影响 safeToAutoLoad（双方注释同义）。
- 校验：description ≤1024 否则 error；有 frontmatter 缺 name/description 为 error；行解析失败发 `skill_invalid_frontmatter` warning（码一致）。
- 输出 metadata 形状一致：name/description/whenToUse/pluginName/pluginId/qualifiedName/path/directory/rootPath/scope/source/safeToAutoLoad/frontmatterKeys/policy.allowImplicitInvocation=true（真值 @4129052 = 我方 index.ts:221-236）。
- manifest 别名向上搜 5 层找 `.zcode-plugin/.claude-plugin/.codex-plugin/.cursor-plugin/plugin.json`（真值 g3s=h3s=5 完全同串同值，含 `.zcode-plugin` 字面量；我方 index.ts:29-35）。

### 2.2 加载 —— 一致
- maxBytes 默认 100_000（真值 m3s=1e5）；超限截断并置 truncated，strip frontmatter 后 trim（index.ts:113-129 = 真值 loadSkill）。

## §3 装配面

### 3.1 Skill 工具 —— 一致
- 输入：`{skill, args?}` 现形 + `{name}` 旧形 union transform（真值 vvr/$os/UXt @1355005 = 我方 `contracts/src/tools/skill.ts:9-31`），描述文本同串："available-skills list. Do not guess names."
- handler：`<skill_content name>` 包裹、`# Skill:` 标题、`Base directory for this skill:` 尾注、`[Skill content truncated]`、变量替换 `${CLAUDE_SKILL_DIR|DRORA_SKILL_DIR}`（真值 Epa 为 `CLAUDE|ZCODE`）（我方 `core/src/tool/handlers/skill.ts:58-76`）。
- metadata：readOnly/timeoutMs 3e4/maxOutputBytes 1e5/riskLevel low/needsApproval false 全同（skill.ts:101-108）；telemetry 回传 qualifiedName/pluginId/source 同构（skill.ts:52-56 = 真值 Cpa）。
- 工具描述长文逐条同串（BLOCKING REQUIREMENT、command-name 已加载不重调等 9 条；skill.ts:82-100 = 真值 @7597396）。

### 3.2 技能清单注入 —— 一致
- section：`name:"Skills", source:"skills", injectionTarget:"meta_user", cacheHint:"dynamic"`，正文首行 "The following skills are available for use with the Skill tool:"，行格式 `- 限定名: 描述 - whenToUse (also loadable as 裸名) (file: 路径)`，描述截 250 字符，预算超限降级为仅文件名清单（真值 gNe/tKs/nKs/eKs/gno/bdt @4833986 = 我方 `core/src/context/sections/skills.ts` 逐行同构）；默认预算 20_000 = config skills.metadataBudget 默认值（真值 @1302149）。
- meta_user 以 system-reminder 包裹呈现（我方 builder.ts:175 注释与真值 Bmn 包装器语义一致）。

### 3.3 技能→slash 命令 —— 一致（历史基线关闭）
- 内置 `/workflow`：正文逐字节同串（"Use the `dynamic-workflows` skill to design and launch..." + $ARGUMENTS + 拓扑决策段），metadata 全同（frontmatterKeys ["description","argument-hint","skills"]、skills:[dynamic-workflows]、scope system、source drora/zcode、path builtin:workflow）（我方 `bootstrap/src/builtin-workflow-command.ts:29-63` = 真值 cHa @14071075）。
- help 表条目 summary/usage/details 同串（`packages/shared/src/drora-slash-command-help.ts:192-197` = 真值 @890204）。
- `/init`、保留名规则、`dynamicWorkflowEnabled===false` 时 `/workflow` 不展开：我方 `bootstrap/src/builtin-prompt-command.ts:39-44`、`drora-protocol/slash-commands.ts:29`，真值同规则。
- 模型侧：用户敲 `/<skill名>` 由 Skill 工具描述的 command-name 规则承接（§3.1），双方均无独立"技能→命令注册表"。

### 3.4 技能门 —— 一致（历史基线关闭）
- `sessionHasLoadedSkill`：认 `{skill}` 与旧形 `{name}`，要求成功 tool 结果（我方 `core/src/agent/loaded-skills.ts` = 真值 v2o @13204583）。
- 拒绝：errorCode 428、message 逐字同串（"needs the `dynamic-workflows` skill loaded in this session..."），saved-only 豁免 CreateWorkflow、path/script 判定 AmendWorkflow（我方 `core/src/tool/handlers/workflow-skill-gate.ts:17-55` = 真值 i_a/UJ/Sbo/wbo/o_a=428 @12471148-12471753）。

### 3.5 配置与开关 —— 一致
- `features.skill` + `skills.enabled` 双闸；`skills{enabled,includeInstructions,metadataBudget:20000,roots}`；`skillOverrides`（键=SKILL.md 绝对路径）；config `skills` 对象 catchall `{enable}` 兼作按技能开关（真值 tjs catchall Q6s @4083727 = 我方 `adapters/src/config/schema.ts:187-205,297-299`）。
- skillPort 装配：extraRoots=skills.roots、extraResolvedRoots=[插件根..., bundled 根...]、disabledPaths=skillOverrides+（dynamicWorkflow 关→bundled dynamic-workflows SKILL.md 进 disabled）——我方 `bootstrap/src/app/create-app.ts:745-760` = 真值 @14096264（含同语义中文注释）。
- 程序化 list/inspect：`"Skills are disabled."`、`"Skill not found: <n>"`、discover→find→load 三段式（我方 `bootstrap/src/skills.ts:28-73` = 真值 oTt/MZo/NZo @14540968；注意双方该 loader 均不注入 dynamic-workflow 禁用路径——一致）。
- CLI：`drora skills [list|inspect <name>]` 用法串、人类可读格式（`- 名 (scope/source; alias 裸名)` + 描述行 + 路径行）、JSON 形状（cwd/diagnostics/skills/totalDiscovered）均同（我方 `cli/src/skills-command.ts:26,127-205` = 真值 Aei/Ztc/Dnc @14747853-14746559）。
- `$` 引用面板 catalog：过滤 `source!=="bundled"`，entry `{id:glm:<scope>:<path>, name, description, path, scope(plugin|workspace|user), enabled:true, pluginName?}`，id 前缀 `glm:` 双方同串（我方 `bootstrap/src/drora-protocol/skill-reference-catalog.ts:38-65` = 真值 LZo/YXa @14542280）。

## §4 bundled-skills 逐文件对位表

真值包 = `resources/glm/packages/bundled-skills/`；我方 = `apps/drora-cli/packages/bundled-skills/`。

| 真值路径 | 我方路径 | 字节比对 | 结论 |
| --- | --- | --- | --- |
| README.md（包说明，136 行） | （无） | 缺 | SHAPE-DIFF P3（开发者文档，非运行时资产；真值 required paths 亦不含它） |
| skills/dynamic-workflows/SKILL.md（93907B） | 同路径（93907B） | 6 处品牌串差异：ZCODE_SKILL_DIR→DRORA_SKILL_DIR、.zcode→.drora、zcode-workflow→drora-workflow | 品牌替换，功能等价 |
| skills/dynamic-workflows/patterns.md（19542B） | 同路径 | byte-identical | 一致 |
| skills/dynamic-workflows/examples.md（36329B） | 同路径 | byte-identical | 一致 |

## §5 差集三分类表

| # | 分类 | 级别 | 内容 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | REAL-GAP | P2 | OpenAI 容器技能序列化：真值 provider 适配器把会话技能序列化进 container_reference 载荷（`{type:"skill_reference",skill_id,version}` 或 inline base64，含 code_interpreter/file_search 工具面）；我方无任何 container/code_interpreter 面板。属 provider/model 域，建议移交该域对拍员确认归属 | 真值 nEs/rEs @3541775；我方全仓无 container_reference（grep 0 命中） |
| 2 | EXTRA | P3 | contracts 诊断码联合多 7 个死成员：skill_root_not_found / skill_missing_frontmatter / skill_invalid_name / skill_unknown_frontmatter / skill_duplicate_name / skill_too_large / skill_not_found——全仓无发射点（loadSkill 缺失是 throw Error 而非诊断）。真值发射集与我方相同 6 码；其声明联合因混淆不可观测 | `contracts/src/skills/index.ts:13-26`；grep 仅命 contracts 与 node_modules |
| 3 | EXTRA | P3 | SkillScope 含 "admin" 死成员，无任何生产者；真值可观测 scope 值仅 user/project/system | `contracts/src/skills/index.ts:7`；真值 grep `"admin"` 无 skills 语境命中 |
| 4 | SHAPE-DIFF | P3 | bundled 包缺 README.md（真值包说明文档，讲三种分发形态） | §4 表 |
| 5 | SHAPE-DIFF | P3 | SEA 打包脚本位置：真值在 `scripts/`，我方在 `apps/drora-cli/packages/cli/scripts/`（sea-bundled-skill-assets.mjs、build-sea.mjs 存在且功能对应） | 双方目录清单 |
| 6 | SHAPE-DIFF | P3 | 品牌替换全集：`.zcode`→`.drora`、source 名 zcode→drora、SEA 前缀/种子 marker、SKILL.md 内 6 处串——均为有意迁移；`glm:` catalog id 前缀双方刻意同串保留 | §1/§3/§4 各处 |

### 历史基线重测（全部关闭）
1. `.js 说明符 FAIL` 案：examples/patterns byte-identical、SKILL.md 仅品牌串 → 不复现。
2. skills→slash 命令注入：`/workflow` 内置命令正文/metadata 同串；无独立技能命令注册表 → 一致。
3. SKILL.md frontmatter 键：safe 集 5 键同串同值 → 一致。
4. 发现顺序 user/project/plugin/bundled：优先级数值逐点相同（10/20/30…、1000+10n、1e6）→ 一致。

## §6 OPEN-QUESTION

1. #1（container skills）归属：skills 域还是 provider/model 域？我方 provider 层当前为 2 行 stub（`adapters/src/provider/index.ts`），可能整块由其他 G 覆盖。
2. 真值 SkillDiagnosticCode / SkillScope 的**声明联合**被 TS 擦除不可观测：EXTRA#2/#3 判定基于"发射集相等 + 我方成员无生产者"，若真值源码确有同名单纯未发射，则降级为注释级差异。
3. `safeToAutoLoad` / `allowImplicitInvocation`：双方均只见构造与遥测/CLI 展示，未见运行时消费点（如隐式自动加载）；是否有桌面域消费待桌面对拍员确认。
4. 桌面 skill-sync（`packages/services/src/skill-sync/` vs 真值 `skill-sync` 模块键）与 Settings 技能管理列表的启停/删除面：本报告只验到"共享扫描策略同源"，详细管理面属桌面域。
