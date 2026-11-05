# /mate 命令片段（P2 文档化交付）

- 机制：CLI 自定义命令=markdown+frontmatter（`apps/drora-cli/packages/adapters/src/commands/`
  的 `.drora/commands` 目录扫描；**非** config.json commands 键——02 详设 §7 定案）。
- 启用：把本目录 `mate-command.md` 复制为项目根 `.drora/commands/mate.md`（项目级）或
  `~/.drora/commands/mate.md`（用户级），重启 CLI 会话后 `/mate <请求>` 即生效。
- frontmatter 合法键（`SAFE_FRONTMATTER_KEYS`）：description / argument-hint / allowed-tools /
  disable-noninteractive / model / skills；未知键会报 custom_command_unknown_frontmatter 告警。
- P2 语义边界（诚实声明）：命令展开为**路由提示词**（点名=explicit 语境、只路由不执行、
  verbatim 不改写），配合人工在侧边栏「大副」tab 放行；「命令触发即开 UI 面板」未随
  P3 交付——host 进程→Main 导航回调通道 03 详设未定义，CLI 直达仍为遗留（05 报告
  §6 遗留 11）；P3 实际交付的是 rendererEvent 导航端口（tray「打开大副」直达复用），
  后续批次补 CLI 直达时可复用同一通道。
