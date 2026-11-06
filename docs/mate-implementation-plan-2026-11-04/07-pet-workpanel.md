# 07 · 桌宠工作面板（2026-11-06 批）

## 0. 背景与范围

用户令「给大副在宠物面板增加大副工作内容展示，类似 TRAE宝 的面板」。现状（P3 桌宠接缝）：托盘速览已有待决策 Y/N + 进行中列表 + 最新汇报一行——与 TRAE宝 工作面板的差距：**没有工作历史**（done/failed 只剩最新一条），活动行**没有时刻/模式信息**。本批把速览升级为完整工作面板，三区结构对齐 TRAE宝 形态：

1. **待决策**（既有）：原文 + 档位 + Y/N。
2. **进行中**（增强）：状态 · 模式徽标（仅 B/C，A 缺省不显）· 目标 · **最近活动时刻 HH:mm**（静态文本，纯 DOM 无 tick——不做相对时长避免定时器）。
3. **最近完成**（新）：done/failed 终态最近 `recentMax=4` 条倒序（失败也是工作内容，诚实呈现）；行=brief 首行 + 状态 · 目标 · 时刻 · 摘要（done 取 output_summary、failed 取 fail_reason 首行；两者皆无则省略摘要——不伪造）；failed 行 meta 红；点行直达工单详情（复用既有 open-ticket 命令链）。

## 1. 契约（只加不破）

- `MATE_PET_PROJECTION_LIMITS.recentMax: 4`。
- `matePetActiveTicketSchema` 增可选 `updatedAtMs`（时刻）与 `mode`（"A"|"B"|"C"，发布方仅 B/C 下发）。
- 新 `matePetRecentTicketSchema`：{ticketId, status(done|failed), brief, targetWorkspaceIdentity, updatedAtMs, summary?}。
- `matePetProjectionSchema.recentTickets` 为**可选**数组（旧发布方帧缺席=速览区隐藏，Main 转发 safeParse 兼容旧进程）。

## 2. 数据流（既有链零改动）

发布方 `projectMatePet`（petProjection.ts）从快照终态工单倒序取前 4 条生产 recentTickets（首条与 latestReport 同源同票）；活动行填时刻/模式。投影经 `platform.publishMatePet` → Main 转发 → tray 窗 `desktopPetMateTrayDom` 渲染——Main 桥/命令链/防注入纪律全部复用既有（文本只经 textContent；动作只回传投影内 id）。

## 3. 验收

- petProjection 单测 +2：活动行时刻/模式透传矩阵（B 带/A 不带/缺省不带）；recentTickets 倒序/上限/failed 摘要/无摘要省略/与 latestReport 同源。
- desktopPetMateSeam +断言：recent 区渲染（done+failed 两行、failed 红、点行直达）、活动行 meta 格式、recentTickets 缺席（旧帧）安全隐藏。
- MSP07 资产：发布链端到端携带（投影 JSON 含 recentTickets，首条与 latestReport 同源同票、倒序）。
- 渲染层增强（活动行时刻格式）归 seam 单测；发布链归 MSP07——两层互补。

## 4. 不做

- 相对时长（"3 分钟前"）——需要 tick 定时器，速览纯 DOM 保持零定时器（绝对 HH:mm 够用）。
- 宠物窗（pet 文档）内嵌面板——速览 tray 即工作面板入口；宠物本体零改动纪律不变。
- 工作历史翻页/更多——有界 4 条（投影容量纪律），全量历史走主面板工单列表（点行直达）。
