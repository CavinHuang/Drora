export const EXPLORATION_FORK_SOURCE_MIGRATION_SQL = `
  alter table session
    add column fork_source_message_id text;

  alter table session
    add column fork_source_label text;
`;
