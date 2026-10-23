// 设备注册表 DeviceStore（specs/relay-v2-server.md §5.1/§7，行为参照 fake-relay-v2.ts）。
// 状态所有者（spec §4）：本模块独占 SQLite devices 表；online/meta 不入库，
// 由 PairingRegistry 实时 join。删除三态由 HTTP 层用 get + 归属 + PairingRegistry.isDeviceOnline
// 组合映射：不存在=幂等 200 / 异账号=1006 / 在线=3005（spec §5.1 表）。
//
// 选型说明（spec §3 有意裁决，覆盖仓库通用异步 IO 纪律）：node:sqlite DatabaseSync 同步接口
// 单写者足够，全部写路径在请求线程同步完成，无后台合并、无多写者（spec §7）。
// 风险登记（spec §11 第 9 条）：node:sqlite 是 Node 实验特性（运行期输出 ExperimentalWarning，
// API 可能在 Node 非语义化版本内变更），本包只在仓库钉版工具链（mise.toml，Node 24.14.0）
// 下开发/测试/交付，不对其他 Node 版本做兼容承诺；node:sqlite 上游转正后按 §11 复核条件复查。

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { DeviceRecord, DeviceStore } from "./types.js";

/** §7 建表与索引（SQLite 不支持 CREATE TABLE 内联 INDEX，v1 语法错误已在该 spec 修正） */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS devices (
  device_sid  TEXT PRIMARY KEY,
  device_mid  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL   -- Unix 秒
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_mid  ON devices(device_mid);
`;

interface DeviceRow {
  device_sid: string;
  device_mid: string;
  user_id: string;
  created_at: number;
}

const toRecord = (row: DeviceRow): DeviceRecord => ({
  deviceSid: row.device_sid,
  deviceMid: row.device_mid,
  userId: row.user_id,
  createdAt: row.created_at,
});

export interface SqliteDeviceStore extends DeviceStore {
  /** 关闭底层 SQLite 连接（优雅停机 §5.3 由装配层调用；DeviceStore 接口只含状态操作） */
  close(): void;
  /** §9 /healthz DB 行数：非破坏性全表计数（仅具体存储类型提供，注入面 DeviceStore 不含） */
  count(): number;
  /**
   * §7 备份：VACUUM INTO 产出与源库一致的自包含快照（运行中直接 cp 在 WAL 下会撕裂）。
   * 目标文件必须不存在（SQLite 语义），存在或失败原样上抛；经装配层 RelayV2ServerHandle
   * .backupDevices 暴露为运维接缝（spec §7）。
   */
  backup(toPath: string): void;
}

export interface CreateSqliteDeviceStoreOptions {
  /** DB_PATH（spec §9）；测试可用 ":memory:" */
  dbPath: string;
  /** 可注入时钟（测试/对时）；默认 Date.now，created_at 取 Unix 秒 */
  now?: () => number;
}

export function createSqliteDeviceStore(
  options: CreateSqliteDeviceStoreOptions,
): SqliteDeviceStore {
  const db = new DatabaseSync(options.dbPath);
  // §7 备份论述的前提是 WAL 运行：打开即设，防「运行中直接 cp 拷出撕裂副本」；
  // :memory:（L0 测试）下 SQLite 忽略该 pragma（保持 memory journal），不影响语义。
  db.exec("PRAGMA journal_mode = WAL;");
  const now = options.now ?? Date.now;
  db.exec(SCHEMA_SQL);
  const insertBySid = db.prepare(
    "INSERT INTO devices (device_sid, device_mid, user_id, created_at) VALUES (?, ?, ?, ?)",
  );
  const selectBySid = db.prepare(
    "SELECT device_sid, device_mid, user_id, created_at FROM devices WHERE device_sid = ?",
  );
  const selectByUser = db.prepare(
    "SELECT device_sid, device_mid, user_id, created_at FROM devices WHERE user_id = ?",
  );
  const selectStaleByCutoff = db.prepare("SELECT device_sid FROM devices WHERE created_at < ?");
  const deleteBySid = db.prepare("DELETE FROM devices WHERE device_sid = ?");
  const countAll = db.prepare("SELECT COUNT(*) AS total FROM devices");
  // §7 备份：VACUUM INTO 的目标路径是 SQL 表达式，经参数绑定传入（不拼字符串，防路径转义问题）
  const vacuumInto = db.prepare("VACUUM INTO ?");
  return {
    register(userId, deviceMid) {
      // 每次同 MID 注册产生新 SID（格式 d_<uuid>），不接收 meta（spec §5.1 规则 3）
      const record: DeviceRecord = {
        deviceSid: `d_${randomUUID()}`,
        deviceMid,
        userId,
        createdAt: Math.floor(now() / 1000),
      };
      insertBySid.run(record.deviceSid, record.deviceMid, record.userId, record.createdAt);
      return record;
    },
    get(deviceSid) {
      const row = selectBySid.get(deviceSid) as DeviceRow | undefined;
      return row === undefined ? undefined : toRecord(row);
    },
    listByUser(userId) {
      // 按 userId 过滤（spec §5.1 规则 4）；跨用户记录不出现在结果里
      return (selectByUser.all(userId) as unknown as DeviceRow[]).map(toRecord);
    },
    delete(deviceSid) {
      // 物理删除且幂等：SID 不存在是无操作成功；删除后的 SID 无法再通过 auth_init 认证
      deleteBySid.run(deviceSid);
    },
    collectExpired(cutoffSeconds, isOnline) {
      // §7 GC：created_at 早于 cutoff 且当前离线才物理删除；在线行跳过，下轮再试。
      // 逐行判断而非单条 DELETE，因为在线事实在内存 PairingRegistry，SQL 里不可得。
      const stale = selectStaleByCutoff.all(cutoffSeconds) as unknown as Array<
        Pick<DeviceRow, "device_sid">
      >;
      let removed = 0;
      for (const row of stale) {
        if (isOnline(row.device_sid)) continue;
        deleteBySid.run(row.device_sid);
        removed += 1;
      }
      return removed;
    },
    close() {
      db.close();
    },
    count() {
      const row = countAll.get() as { total: number } | undefined;
      return row?.total ?? 0;
    },
    backup(toPath) {
      // §7：目标必须不存在（SQLite 语义），冲突/失败原样上抛——调用方（装配层）记日志，
      // 本层不吞错：备份失败被掩盖比失败本身更危险。
      vacuumInto.run(toPath);
    },
  };
}
