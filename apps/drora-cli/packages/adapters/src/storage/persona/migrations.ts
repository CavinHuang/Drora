import type { SqliteMigration } from "@drora/shared/sqlite-migrations";

/**
 * persona 独立库迁移（合同 §2：P0 只迁移 authority、core、mutation receipt 所需表；
 * P1a 才增加 policy/preferences，P1b 才增加 source/candidate/work）。
 *
 * schema 只由本仓储拥有，Host/UI 不执行 DDL（合同 §2）；迁移账本与 checksum 校验复用
 * @drora/shared/sqlite-migrations 体系（runner 按 checksum 记账，历史迁移发布后不可再改，
 * 只能追加新条目）。scope/result_code 的 CHECK 词汇对应 shared contracts 的
 * PERSONA_RECEIPT_SCOPES 与 PersonaReceiptResultCode，由 tests/persona 的 parity 测试钉住。
 */
export const PERSONA_MIGRATIONS: readonly SqliteMigration[] = [
  {
    id: "0001_persona_p0_base",
    appVersion: "3.16.1",
    touchedTables: ["persona_authority", "persona_core", "persona_mutation_receipt"],
    sql: `
      -- Authority/P0 单例：authorityId/personaId/schemaVersion/createdAt（合同 §1）。
      -- id=1 硬约束单例；schemaVersion 值为 shared 的 PERSONA_STORE_SCHEMA_VERSION，
      -- 遇到更大值视为未知新 schema，报 schema_incompatible 只停扩展（合同 §2）。
      create table if not exists persona_authority (
        id integer primary key check(id = 1),
        authority_id text not null,
        persona_id text not null,
        schema_version integer not null,
        time_created integer not null
      );

      -- Core/P0 当前值单例：coreRevision/templateVersion + 五个可编辑字段（合同 §1）。
      -- P0 不存无界历史：只保留当前一行（「当前与前一核心最多两份」的上界之下）。
      -- 表达枚举与 shared PersonaWarmth/PersonaDirectness/PersonaHumor 词汇一致。
      create table if not exists persona_core (
        id integer primary key check(id = 1),
        core_revision integer not null check(core_revision >= 0),
        template_version integer not null,
        display_name text not null,
        self_description text not null,
        warmth text not null check(warmth in ('restrained', 'balanced', 'warm')),
        directness text not null check(directness in ('gentle', 'balanced', 'direct')),
        humor text not null check(humor in ('off', 'light')),
        time_created integer not null,
        time_updated integer not null
      );

      -- MutationReceipt/P0（合同 §1/§2）：幂等键 (scope, mutation_id)；不含核心/偏好正文，
      -- 不是审计转录。result_revision 记录该变更终态时的 core revision，供同 ID 同摘要回放。
      create table if not exists persona_mutation_receipt (
        scope text not null check(scope in ('authority', 'core')),
        mutation_id text not null,
        request_digest text not null,
        result_code text not null check(result_code in ('created', 'saved', 'unchanged')),
        result_revision integer not null check(result_revision >= 0),
        time_created integer not null,
        primary key(scope, mutation_id)
      );

      -- 容量/清理路径按 scope+time_created 找过期项；不驱逐 7 天窗口内的幂等凭据。
      create index if not exists persona_mutation_receipt_scope_time_idx
        on persona_mutation_receipt(scope, time_created);
    `,
  },
  {
    id: "0002_persona_p1a_policy_preference",
    appVersion: "3.16.1",
    touchedTables: [
      "persona_policy",
      "persona_preference",
      "persona_mutation_receipt",
    ],
    sql: `
      -- Policy/P1a 单例（合同 §1）：policyRevision/policyEpoch/usePreferences。执行许可 E
      -- 不在这里（E 属原 Settings/runtime preferences，spec §5）。行缺席＝读侧默认
      -- （PERSONA_POLICY_DEFAULTS），首次 setPersonalPolicy 才创建，不做迁移回填。
      create table if not exists persona_policy (
        id integer primary key check(id = 1),
        use_preferences integer not null check(use_preferences in (0, 1)),
        policy_revision integer not null check(policy_revision >= 0),
        policy_epoch integer not null check(policy_epoch >= 0),
        time_updated integer not null
      );

      -- Preference/P1a 当前值槽（合同 §1：一个 authority＋key 只有一个槽；唯一键＝key）。
      -- forgotten 槽保留 keyGeneration/autoSuppressed 最小控制信息并清空 value（合同 §1.2），
      -- 不保留旧值；P1a 只有 settings/explicit 写入方，inferred 是 P1b 域，CHECK 词汇先行封闭。
      create table if not exists persona_preference (
        key text primary key,
        value text,
        revision integer not null check(revision >= 0),
        key_generation integer not null check(key_generation >= 0),
        provenance_kind text not null check(provenance_kind in ('settings')),
        epistemic_status text not null check(epistemic_status in ('explicit')),
        status text not null check(status in ('active', 'forgotten')),
        pinned integer not null check(pinned in (0, 1)),
        auto_suppressed integer not null check(auto_suppressed in (0, 1)),
        time_updated integer not null
      );

      -- P1a 扩展 receipt 词汇（scope += policy/preference；result_code += forgotten）。
      -- result_generation 记录该终态的屏障值：preference scope 存 keyGeneration、policy
      -- scope 存 policyEpoch、authority/core 恒 0——同 ID 同摘要回放需要完整终态形状
      -- （saved 带当时 revision+generation，合同 §2「同作用域同 ID 同摘要返回先前结果」）。
      -- 已发布迁移不可修改（0001 的 CHECK 冻结），按 SQLite 重建表搬迁历史行；容量索引
      -- 随重建补回。
      create table persona_mutation_receipt_p1a (
        scope text not null check(scope in ('authority', 'core', 'policy', 'preference')),
        mutation_id text not null,
        request_digest text not null,
        result_code text not null check(result_code in ('created', 'saved', 'unchanged', 'forgotten')),
        result_revision integer not null check(result_revision >= 0),
        result_generation integer not null default 0 check(result_generation >= 0),
        time_created integer not null,
        primary key(scope, mutation_id)
      );
      insert into persona_mutation_receipt_p1a
        select scope, mutation_id, request_digest, result_code, result_revision, 0, time_created
        from persona_mutation_receipt;
      drop table persona_mutation_receipt;
      alter table persona_mutation_receipt_p1a rename to persona_mutation_receipt;
      create index if not exists persona_mutation_receipt_scope_time_idx
        on persona_mutation_receipt(scope, time_created);
    `,
  },
  {
    id: "0003_persona_p1b_learning",
    appVersion: "3.16.1",
    touchedTables: [
      "persona_policy",
      "persona_preference",
      "persona_learning_evidence",
      "persona_learning_work",
      "persona_learning_candidate",
      "persona_learning_source",
      "persona_learning_budget_day",
    ],
    sql: `
      -- Policy/P1b（合同 §1）：并入 auto_learn/learning_generation。auto_learn 默认 false；
      -- learning_generation 是学习域单调屏障，在 autoLearn 真值变 false 的事务内递增。
      -- 预算配置不落列：首版为 shared contracts 的冻结常量（PERSONA_LEARNING_BUDGET），
      -- 本版没有预算 patch 路径，运行中不允许扩大预算（合同 §6）。已发布迁移不可修改
      -- （0002 的 CHECK 冻结），按 SQLite 重建表搬迁历史行；历史行 auto_learn=0 与
      -- P1b 默认一致，learning_generation 从 0 起算。
      create table persona_policy_p1b (
        id integer primary key check(id = 1),
        use_preferences integer not null check(use_preferences in (0, 1)),
        auto_learn integer not null default 0 check(auto_learn in (0, 1)),
        learning_generation integer not null default 0 check(learning_generation >= 0),
        policy_revision integer not null check(policy_revision >= 0),
        policy_epoch integer not null check(policy_epoch >= 0),
        time_updated integer not null
      );
      insert into persona_policy_p1b
        select id, use_preferences, 0, 0, policy_revision, policy_epoch, time_updated
        from persona_policy;
      drop table persona_policy;
      alter table persona_policy_p1b rename to persona_policy;

      -- Preference 槽 CHECK 词汇加宽（合同 §1.2：自动提交永远 extraction/inferred）并补
      -- disputed 列（合同 §6「不同 inferred 值使该键 disputed，下一轮停止注入」）。
      -- 抑制沿用 auto_suppressed；候选关联在 persona_learning_candidate 表（唯一 owner），
      -- 读侧 join，不在槽上冗余。同库单 authority，唯一键即 key（合同 §2 键族按
      -- 单 authority 物化，与 0001/0002 一致不另设 authority_id 列）。
      create table persona_preference_p1b (
        key text primary key,
        value text,
        revision integer not null check(revision >= 0),
        key_generation integer not null check(key_generation >= 0),
        provenance_kind text not null check(provenance_kind in ('settings', 'extraction')),
        epistemic_status text not null check(epistemic_status in ('explicit', 'inferred')),
        status text not null check(status in ('active', 'forgotten')),
        pinned integer not null check(pinned in (0, 1)),
        auto_suppressed integer not null check(auto_suppressed in (0, 1)),
        disputed integer not null default 0 check(disputed in (0, 1)),
        time_updated integer not null
      );
      insert into persona_preference_p1b
        select key, value, revision, key_generation, provenance_kind, epistemic_status,
               status, pinned, auto_suppressed, 0, time_updated
        from persona_preference;
      drop table persona_preference;
      alter table persona_preference_p1b rename to persona_preference;

      -- Evidence/P1b 接收记录（合同 §1/§6）：source_handle 是服务构造的可信 JSON（含
      -- authorityId/workspaceKey/sessionId/turn·command 定位/消息边界/活动分支证据/源版本
      -- 校验值/可信 origin/合格执行许可描述），本仓储不保存聊天原文；source_digest 是
      -- 幂等比较摘要（同 evidenceId 异内容拒绝）。policy_epoch/key_generations 是接收时
      -- 屏障快照，提交时复核。evidenceId 由服务对稳定源身份构造，模型不得生成。
      create table if not exists persona_learning_evidence (
        id integer primary key autoincrement,
        evidence_id text not null unique,
        source_handle text not null,
        source_digest text not null,
        workspace_key text not null,
        session_id text not null,
        policy_epoch integer not null check(policy_epoch >= 0),
        key_generations text not null,
        time_created integer not null
      );
      create index if not exists persona_learning_evidence_session_idx
        on persona_learning_evidence(session_id, time_created);

      -- Work/P1b 队列（合同 §1/§6）：accepted → running → applied/no_change/rejected/
      -- retry_wait；work_id 为仓储生成的 opaque ID；lease（owner+到期）与 fence（领取即
      -- 递增）支撑过期重领与旧 fence 提交拒绝；attempts 上限与 24 小时有效期由仓储执行；
      -- 终态保留最小 id/reason 7 天（fail_reason 只记固定类别，无正文）。
      create table if not exists persona_learning_work (
        id integer primary key autoincrement,
        work_id text not null unique,
        evidence_id text not null unique,
        state text not null check(state in ('accepted', 'running', 'applied', 'no_change', 'rejected', 'retry_wait')),
        lease_owner text,
        lease_expires_at integer,
        fence integer not null default 0 check(fence >= 0),
        attempts integer not null default 0 check(attempts >= 0),
        policy_epoch integer not null check(policy_epoch >= 0),
        key_generations text not null,
        fail_reason text,
        time_created integer not null,
        time_updated integer not null
      );
      create index if not exists persona_learning_work_state_idx
        on persona_learning_work(state, time_created);

      -- Candidate/P1b（合同 §1/§2：每键最多一项待确认；唯一键＝key）。待确认候选携带
      -- 模型抽取的 proposedValue 与 ≤4 条引用（无聊天原文）；被拒/被取代候选整行删除
      -- （被拒候选不留正文，合同 §6），所以没有 rejected 状态行。
      create table if not exists persona_learning_candidate (
        key text primary key,
        proposed_value text not null,
        evidence_id text not null,
        evidence_refs text not null,
        expected_generation integer not null check(expected_generation >= 0),
        expected_revision integer not null check(expected_revision >= 0),
        time_created integer not null,
        time_updated integer not null
      );

      -- 同值 inferred 槽合并的有界来源（合同 §6「最多 4」）：每键 ≤4 行，ordinal 0..3
      -- 即合并顺序（先到先保留）；来源是 evidence 定位与校验元数据，供来源/争议 UI 与
      -- 导出验证，不含正文。显式保存/忘记时随槽级联清除。
      create table if not exists persona_learning_source (
        key text not null,
        ordinal integer not null check(ordinal >= 0),
        evidence_id text not null,
        source_summary text not null,
        time_merged integer not null,
        primary key(key, ordinal)
      );

      -- 预算台账（合同 §6）：UTC 日窗口（day＝服务时间的 UTC 日期）记账；调用前预留
      -- 硬上界，失败计入不退尝试；已确认用量可退差额，崩溃不退（保守）。时钟倒退落到
      -- 既有 day 行继续记账＝不补额度；行不清理（每 authority 每天一行，无界增长不可达）。
      create table if not exists persona_learning_budget_day (
        day text primary key,
        attempts_used integer not null default 0 check(attempts_used >= 0),
        input_tokens_used integer not null default 0 check(input_tokens_used >= 0),
        output_tokens_used integer not null default 0 check(output_tokens_used >= 0),
        time_updated integer not null
      );
    `,
  },
];
