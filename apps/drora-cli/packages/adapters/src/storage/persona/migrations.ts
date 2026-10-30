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
];
