/**
 * Vault 面板文案（specs/obsidian-vault-phase2-true-extraction.md §10-P5「i18n 键迁移
 * → 插件页面资源」）。页面自带 zh-CN/en 两份资源（语义对照本体 v4 vault 视图文案，
 * 本体 packages/ui/src/i18n/locales 的 vault.* 342 键×2 属 P7 清除/P8 迁移对账范围，
 * 本批不动本体键——双轨期旧面板仍引用）。
 */
const zh = {
  "vault.title": "Obsidian Vault",
  "vault.loading": "加载中…",
  "vault.retry": "重试",
  "vault.refresh": "刷新",
  "vault.loadMore": "加载更多",
  "vault.back": "返回",

  // 视图标签（四视图，§5c）
  "vault.view.notes": "笔记",
  "vault.view.ask": "检索",
  "vault.view.insights": "洞察",
  "vault.view.review": "审核",

  // 全局状态（D14 冲突 / 未配置 / 网络）
  "vault.conflict.title": "检测到两份知识库",
  "vault.conflict.body":
    "旧路径与插件数据目录各有一份索引库。请先取舍（保留一份并移除另一份）后重启；面板不做静默合并。",
  "vault.conflict.legacy": "旧路径",
  "vault.conflict.plugin": "插件目录",
  "vault.notConfigured.title": "尚未配置 Vault",
  "vault.notConfigured.body": "选择一个 Vault 根目录后即可浏览笔记、检索与洞察。",
  "vault.notConfigured.pick": "选择 Vault 根目录",
  "vault.notConfigured.picked": "已选择：{path}",
  "vault.notConfigured.configurePending":
    "根目录写入配置是写操作：审批豁免模型（g10）终裁前本面板只读，配置暂不可写入。",
  "vault.networkError": "读取失败，请重试。",

  // notes 视图
  "vault.notes.searchPlaceholder": "筛选笔记…",
  "vault.notes.empty": "Vault 内暂无 Markdown 笔记",
  "vault.notes.noMatch": "没有匹配的笔记",
  "vault.notes.newNote": "新建笔记",
  "vault.notes.related": "相关笔记",
  "vault.notes.relatedEmpty": "暂无相关笔记（需要索引与语义向量）",
  "vault.notes.linked": "已链接 {count}",
  "vault.notes.suggested": "建议链接",
  "vault.notes.insertLink": "插入 [[{target}]]",
  "vault.notes.unreadable": "笔记读取失败：{message}",
  "vault.notes.readMore": "继续读取（{offset}/{total} 字符）",
  "vault.notes.rename": "改名",
  "vault.notes.delete": "删除",
  "vault.notes.save": "保存",
  "vault.notes.citationTitle": "引用来源",

  // 只读降级提示（D13：写操作面待 g10 终裁后另批）
  "vault.degraded.write":
    "此操作是写操作：面板写操作审批豁免（g10）终裁前暂不开放，可在对话中让 Agent 经授权路径完成。",

  // ask 视图（N1 Smart Lookup：检索即终点）
  "vault.ask.placeholder": "检索 Vault 笔记（Smart Lookup）…",
  "vault.ask.submit": "检索",
  "vault.ask.clear": "清空",
  "vault.ask.searching": "检索中…",
  "vault.ask.results": "{count} 条结果",
  "vault.ask.open": "打开",
  "vault.ask.handoff": "交给 Agent",
  "vault.ask.handoffDone": "已加入当前会话输入框。",
  "vault.ask.handoffFailed": "投递失败：{message}",
  "vault.ask.jump": "定位",
  "vault.ask.rank": "#{rank}",
  "vault.ask.matchedChunks": "{count} 段命中",

  // ask 状态条（对照本体 knowledgeAsk 横幅语义）
  "vault.banner.noVault": "尚未配置 Vault。",
  "vault.banner.indexMissing": "索引为空：检索前需要建立索引。",
  "vault.banner.indexing": "索引建立中…",
  "vault.banner.indexPartial": "部分文件未纳入索引。",
  "vault.banner.semanticUnavailable": "语义检索不可用，已用词法检索。",
  "vault.banner.sourceStale": "索引过期：结果可能滞后于笔记现状。",
  "vault.banner.noAnswer": "没有命中的笔记。",
  "vault.banner.failed": "检索失败：{message}",

  // insights 视图（含 N4 健康体检）
  "vault.insights.coverage": "覆盖",
  "vault.insights.indexedFiles": "已索引 {indexed}/{total} 篇",
  "vault.insights.chunks": "索引块 {count}",
  "vault.insights.recentJobs": "最近索引作业",
  "vault.insights.noJobs": "暂无作业记录",
  "vault.insights.jobStatus": "{kind} · {status}",
  "vault.insights.rebuild": "重建索引",
  "vault.insights.reconcile": "增量更新",
  "vault.insights.health": "健康体检",
  "vault.insights.health.orphanNotes": "孤儿笔记",
  "vault.insights.health.brokenLinks": "断链",
  "vault.insights.health.emptyNotes": "空笔记",
  "vault.insights.health.more": "（共 {count} 条，仅列前 {shown} 条）",
  "vault.insights.health.empty": "体检通过：无孤儿/断链/空笔记。",

  // review 视图（L2 只读呈现）
  "vault.review.writeGate": "L2 写路径",
  "vault.review.writeGateOn": "已开启",
  "vault.review.writeGateOff": "已关闭（默认，S03 NO-GO）",
  "vault.review.writeGateActivation": "本 Host 开通资格：{value}",
  "vault.review.proposals": "提案",
  "vault.review.noProposals": "暂无提案",
  "vault.review.proposalRevision": "r{revision}",
  "vault.review.rejected": "已拒绝",
  "vault.review.approved": "已批准",
  "vault.review.approvalExpired": "批准已过期",
  "vault.review.changes": "变更",
  "vault.review.changeKind.create": "新建",
  "vault.review.changeKind.write": "覆盖",
  "vault.review.changeKind.delete": "删除",
  "vault.review.evidence": "证据",
  "vault.review.approve": "批准",
  "vault.review.reject": "拒绝",
  "vault.review.apply": "执行",
  "vault.review.open": "查看",
  "vault.review.reason": "理由",
  "vault.review.createdAt": "创建于 {time}",

  // g9 citation 回跳
  "vault.citation.locating": "正在定位引用原文…",
  "vault.citation.current": "已定位：{title}",
  "vault.citation.stale": "引用已过期（原文已修改），定位到当前文件。",
  "vault.citation.missing": "引用原文已不存在。",
  "vault.citation.unavailable": "引用解析不可用：{reason}",
} as const;

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  "vault.title": "Obsidian Vault",
  "vault.loading": "Loading…",
  "vault.retry": "Retry",
  "vault.refresh": "Refresh",
  "vault.loadMore": "Load more",
  "vault.back": "Back",

  "vault.view.notes": "Notes",
  "vault.view.ask": "Search",
  "vault.view.insights": "Insights",
  "vault.view.review": "Review",

  "vault.conflict.title": "Two knowledge databases detected",
  "vault.conflict.body":
    "Both the legacy path and the plugin data directory hold an index database. Resolve which one to keep (remove the other) and restart; the panel never merges silently.",
  "vault.conflict.legacy": "Legacy path",
  "vault.conflict.plugin": "Plugin directory",
  "vault.notConfigured.title": "No vault configured",
  "vault.notConfigured.body": "Pick a vault root directory to browse notes, search and insights.",
  "vault.notConfigured.pick": "Choose vault root",
  "vault.notConfigured.picked": "Selected: {path}",
  "vault.notConfigured.configurePending":
    "Writing the configuration is a write operation: until the panel tool-trust ruling (g10) lands, this panel is read-only and cannot persist it.",
  "vault.networkError": "Read failed, please retry.",

  "vault.notes.searchPlaceholder": "Filter notes…",
  "vault.notes.empty": "No Markdown notes in this vault yet",
  "vault.notes.noMatch": "No matching notes",
  "vault.notes.newNote": "New note",
  "vault.notes.related": "Related notes",
  "vault.notes.relatedEmpty": "No related notes yet (needs index and semantic vectors)",
  "vault.notes.linked": "Linked {count}",
  "vault.notes.suggested": "Suggested links",
  "vault.notes.insertLink": "Insert [[{target}]]",
  "vault.notes.unreadable": "Failed to read note: {message}",
  "vault.notes.readMore": "Continue reading ({offset}/{total} chars)",
  "vault.notes.rename": "Rename",
  "vault.notes.delete": "Delete",
  "vault.notes.save": "Save",
  "vault.notes.citationTitle": "Cited source",

  "vault.degraded.write":
    "This is a write operation: panel write actions stay unavailable until the tool-trust ruling (g10) lands; ask the Agent to do it through the authorized path instead.",

  "vault.ask.placeholder": "Search vault notes (Smart Lookup)…",
  "vault.ask.submit": "Search",
  "vault.ask.clear": "Clear",
  "vault.ask.searching": "Searching…",
  "vault.ask.results": "{count} results",
  "vault.ask.open": "Open",
  "vault.ask.handoff": "Send to Agent",
  "vault.ask.handoffDone": "Added to the current session composer.",
  "vault.ask.handoffFailed": "Delivery failed: {message}",
  "vault.ask.jump": "Locate",
  "vault.ask.rank": "#{rank}",
  "vault.ask.matchedChunks": "{count} matched chunks",

  "vault.banner.noVault": "No vault configured.",
  "vault.banner.indexMissing": "Index is empty: build the index before searching.",
  "vault.banner.indexing": "Indexing…",
  "vault.banner.indexPartial": "Some files are not indexed.",
  "vault.banner.semanticUnavailable": "Semantic search unavailable; used lexical search.",
  "vault.banner.sourceStale": "Index is stale: results may lag behind note edits.",
  "vault.banner.noAnswer": "No notes matched.",
  "vault.banner.failed": "Search failed: {message}",

  "vault.insights.coverage": "Coverage",
  "vault.insights.indexedFiles": "{indexed}/{total} notes indexed",
  "vault.insights.chunks": "{count} chunks",
  "vault.insights.recentJobs": "Recent index jobs",
  "vault.insights.noJobs": "No jobs yet",
  "vault.insights.jobStatus": "{kind} · {status}",
  "vault.insights.rebuild": "Rebuild index",
  "vault.insights.reconcile": "Incremental update",
  "vault.insights.health": "Health check",
  "vault.insights.health.orphanNotes": "Orphan notes",
  "vault.insights.health.brokenLinks": "Broken links",
  "vault.insights.health.emptyNotes": "Empty notes",
  "vault.insights.health.more": "({count} total, first {shown} shown)",
  "vault.insights.health.empty": "Health check passed: no orphans, broken links or empty notes.",

  "vault.review.writeGate": "L2 write path",
  "vault.review.writeGateOn": "Enabled",
  "vault.review.writeGateOff": "Disabled (default, S03 NO-GO)",
  "vault.review.writeGateActivation": "Activation allowed on this host: {value}",
  "vault.review.proposals": "Proposals",
  "vault.review.noProposals": "No proposals",
  "vault.review.proposalRevision": "r{revision}",
  "vault.review.rejected": "Rejected",
  "vault.review.approved": "Approved",
  "vault.review.approvalExpired": "Approval expired",
  "vault.review.changes": "Changes",
  "vault.review.changeKind.create": "Create",
  "vault.review.changeKind.write": "Overwrite",
  "vault.review.changeKind.delete": "Delete",
  "vault.review.evidence": "Evidence",
  "vault.review.approve": "Approve",
  "vault.review.reject": "Reject",
  "vault.review.apply": "Apply",
  "vault.review.open": "Open",
  "vault.review.reason": "Reason",
  "vault.review.createdAt": "Created {time}",

  "vault.citation.locating": "Locating cited source…",
  "vault.citation.current": "Located: {title}",
  "vault.citation.stale": "Citation is stale (source edited); located the current file.",
  "vault.citation.missing": "Cited source no longer exists.",
  "vault.citation.unavailable": "Citation unavailable: {reason}",
};

export type Locale = "en" | "zh-CN";

export function resolveLocale(locale: string | undefined): Locale {
  return locale?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const table = locale === "zh-CN" ? zh : en;
  return (key, vars) =>
    table[key].replace(/\{(\w+)\}/g, (match, name: string) =>
      vars && name in vars ? String(vars[name]) : match,
    );
}
